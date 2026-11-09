using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Globalization;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;
using Zhike.Domain.Business;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record ImportPreviewRow(int RowNumber, JsonElement Raw, JsonElement Classified, double Confidence, IReadOnlyList<string> Conflicts);
public sealed record ImportBatchPreview(string Id, string SourceHash, IReadOnlyList<ImportPreviewRow> Rows, string DuplicateOf = "");

public sealed class ImportRepository(
    PostgresConnectionFactory connections,
    CustomerRepository customers,
    BusinessRecordRepository businessRecords)
{
    public async Task<ImportBatchPreview> CreatePreviewAsync(string sourceName, IReadOnlyList<JsonElement> rows, CancellationToken cancellationToken = default)
    {
        var batchId = $"batch-{Guid.NewGuid():N}";
        var sourceHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(rows)))).ToLowerInvariant();
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var duplicateOf = string.Empty;
        await using (var duplicate = new NpgsqlCommand("SELECT id FROM import_batches WHERE source_hash=$1 AND state='committed' ORDER BY committed_at DESC NULLS LAST, created_at DESC LIMIT 1", connection, transaction))
        {
            duplicate.Parameters.AddWithValue(sourceHash);
            duplicateOf = Convert.ToString(await duplicate.ExecuteScalarAsync(cancellationToken)) ?? string.Empty;
        }
        await using (var batch = new NpgsqlCommand("INSERT INTO import_batches(id, source_name, source_hash, state, row_count, duplicate_of) VALUES ($1, $2, $3, 'preview', $4, $5)", connection, transaction))
        {
            batch.Parameters.AddWithValue(batchId);
            batch.Parameters.AddWithValue(sourceName?.Trim() ?? string.Empty);
            batch.Parameters.AddWithValue(sourceHash);
            batch.Parameters.AddWithValue(rows.Count);
            batch.Parameters.AddWithValue(duplicateOf);
            await batch.ExecuteNonQueryAsync(cancellationToken);
        }
        var preview = new List<ImportPreviewRow>();
        var rowNumber = 0;
        foreach (var row in rows)
        {
            rowNumber++;
            var classified = Classify(row);
            var conflicts = new List<string>();
            if (classified.TryGetProperty("registeredDate", out var registered) && classified.TryGetProperty("nextFollowupDate", out var followup) && registered.ValueKind == JsonValueKind.String && followup.ValueKind == JsonValueKind.String && registered.GetString() == followup.GetString() && !string.IsNullOrWhiteSpace(registered.GetString())) conflicts.Add("登记日期与下次跟进日期相同，请确认");
            var confidence = conflicts.Count == 0 ? 0.9 : 0.65;
            await using var insert = new NpgsqlCommand("INSERT INTO import_rows(batch_id, row_number, raw_json, classified_json, confidence, state) VALUES ($1, $2, $3, $4, $5, 'pending')", connection, transaction);
            insert.Parameters.AddWithValue(batchId);
            insert.Parameters.AddWithValue(rowNumber);
            insert.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = row.GetRawText() });
            insert.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = classified.GetRawText() });
            insert.Parameters.AddWithValue(confidence);
            await insert.ExecuteNonQueryAsync(cancellationToken);
            preview.Add(new ImportPreviewRow(rowNumber, row, classified, confidence, conflicts));
        }
        await transaction.CommitAsync(cancellationToken);
        return new ImportBatchPreview(batchId, sourceHash, preview, duplicateOf);
    }

    public async Task<int> CommitAsync(string batchId, CancellationToken cancellationToken = default)
    {
        var normalizedBatchId = batchId?.Trim() ?? string.Empty;
        if (normalizedBatchId.Length == 0) throw new ArgumentException("导入批次编号不能为空", nameof(batchId));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        // A commit can be retried after a process crash. Serialize commits
        // for the same batch so two desktop windows cannot race the row-level
        // idempotent upserts; already committed rows remain safely resumable.
        await using var batchLock = new NpgsqlCommand("SELECT pg_advisory_lock(hashtextextended('import:' || $1, 0))", connection);
        batchLock.Parameters.AddWithValue(normalizedBatchId);
        await batchLock.ExecuteNonQueryAsync(cancellationToken);
        try
        {
            await using var batchCommand = new NpgsqlCommand("SELECT state FROM import_batches WHERE id = $1", connection);
            batchCommand.Parameters.AddWithValue(normalizedBatchId);
            var state = Convert.ToString(await batchCommand.ExecuteScalarAsync(cancellationToken));
            if (string.Equals(state, "committed", StringComparison.OrdinalIgnoreCase)) return 0;
            if (!string.Equals(state, "preview", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("导入批次不存在或状态不可提交");

            // Keep the customer, business-record, row-state and audit writes in
            // one transaction. A retry after a process crash is still safe because
            // the advisory lock serializes this batch and all upserts are keyed.
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                var rows = new List<(long Id, int Number, JsonElement Classified)>();
                await using (var rowCommand = new NpgsqlCommand("SELECT id, row_number, classified_json FROM import_rows WHERE batch_id = $1 AND state = 'pending' ORDER BY row_number", connection, transaction))
                {
                    rowCommand.Parameters.AddWithValue(normalizedBatchId);
                    await using var reader = await rowCommand.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        using var rowDocument = JsonDocument.Parse(reader.GetFieldValue<string>(2));
                        rows.Add((reader.GetInt64(0), reader.GetInt32(1), rowDocument.RootElement.Clone()));
                    }
                }

                var committed = 0;
                foreach (var row in rows)
                {
                    var fields = row.Classified;
                    var phone = Value(fields, "phone");
                    var explicitCustomerId = Value(fields, "customerId");
                    if (string.IsNullOrWhiteSpace(explicitCustomerId)) explicitCustomerId = $"cust-import-{normalizedBatchId}-{row.Number}";
                    var customer = await customers.UpsertFillEmptyAsync(connection, transaction, new CustomerInput(
                        explicitCustomerId, Value(fields, "name"), phone,
                        Value(fields, "country"), Value(fields, "language"), Value(fields, "source"),
                        Value(fields, "stage"), Value(fields, "status"), Value(fields, "intentLevel"),
                        Value(fields, "occupation"), IntValue(fields, "age"), Value(fields, "budget"),
                        Value(fields, "productInterest"), Value(fields, "note"), Value(fields, "aiSummary"),
                        "phone", phone), cancellationToken);
                    if (customer is null) throw new InvalidOperationException($"第 {row.Number} 行客户保存失败");

                    var recordType = Value(fields, "recordType");
                    var product = Value(fields, "product");
                    var direction = Value(fields, "direction");
                    var tradeRef = Value(fields, "tradeRef");
                    var registered = DateValue(fields, "registeredDate");
                    var businessDate = DateValue(fields, "businessDate");
                    var followup = DateValue(fields, "nextFollowupDate");
                    if (string.IsNullOrWhiteSpace(recordType)) recordType = string.IsNullOrWhiteSpace(product) && string.IsNullOrWhiteSpace(direction) ? "customer" : "ticket";
                    if (!recordType.Equals("customer", StringComparison.OrdinalIgnoreCase))
                    {
                        var note = Value(fields, "note");
                        var amount = Value(fields, "amount");
                        var currency = Value(fields, "currency");
                        var key = recordType.Equals("deposit", StringComparison.OrdinalIgnoreCase)
                            ? BusinessRecordKey.Deposit(customer.Id, businessDate?.ToString("yyyy-MM-dd") ?? registered?.ToString("yyyy-MM-dd") ?? string.Empty, amount, currency, note)
                            : BusinessRecordKey.Ticket(customer.Id, (businessDate ?? registered)?.ToString("yyyy-MM-dd") ?? string.Empty, product, direction, note, tradeRef);
                        await businessRecords.UpsertAsync(connection, transaction, new BusinessRecordInput(
                            null, customer.Id, recordType, product, direction, registered, businessDate, followup,
                            Value(fields, "channel"), Value(fields, "status"), Value(fields, "vipCode"), note, key, normalizedBatchId, tradeRef), cancellationToken);
                    }

                    await using var mark = new NpgsqlCommand("UPDATE import_rows SET state = 'committed', error_message = '' WHERE id = $1", connection, transaction);
                    mark.Parameters.AddWithValue(row.Id);
                    await mark.ExecuteNonQueryAsync(cancellationToken);
                    committed++;
                }

                await using var finish = new NpgsqlCommand("UPDATE import_batches SET state = 'committed', committed_at = now() WHERE id = $1 AND state = 'preview'", connection, transaction);
                finish.Parameters.AddWithValue(normalizedBatchId);
                await finish.ExecuteNonQueryAsync(cancellationToken);
                await AuditWriter.AppendAsync(connection, transaction, "system", "api", "import.commit", "import_batch", normalizedBatchId, new { committed }, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return committed;
            }
            catch
            {
                await transaction.RollbackAsync(CancellationToken.None);
                throw;
            }
        }
        finally
        {
            await using var unlock = new NpgsqlCommand("SELECT pg_advisory_unlock(hashtextextended('import:' || $1, 0))", connection);
            unlock.Parameters.AddWithValue(normalizedBatchId);
            await unlock.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    private static JsonElement Classify(JsonElement row)
    {
        using var document = JsonDocument.Parse(row.GetRawText());
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        var context = document.RootElement.TryGetProperty("__context", out var contextValue) ? contextValue.ToString() : string.Empty;
        var isTicketContext = context.Contains("跟票", StringComparison.OrdinalIgnoreCase)
            || context.Contains("股票", StringComparison.OrdinalIgnoreCase)
            || context.Contains("ticket", StringComparison.OrdinalIgnoreCase)
            || context.Contains("stock", StringComparison.OrdinalIgnoreCase);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            var key = property.Name.Trim().ToLowerInvariant();
            if (key.Equals("__context", StringComparison.OrdinalIgnoreCase)) continue;
            var value = property.Value.ValueKind == JsonValueKind.String ? property.Value.GetString() : property.Value.ToString();
            if (key.Contains("登记") || key.Contains("注册") || key.Contains("registered")) result["registeredDate"] = NormalizeDate(value);
            else if (key.Contains("跟进") || key.Contains("到期") || key.Contains("follow")) result["nextFollowupDate"] = NormalizeDate(value);
            else if (key.Contains("业务日期") || key.Contains("交易日期") || key.Contains("businessdate") || key.Contains("transactiondate")) result["businessDate"] = NormalizeDate(value);
            else if (!result.ContainsKey("registeredDate") && IsDate(value)) result["registeredDate"] = NormalizeDate(value);
            else if (!result.ContainsKey("nextFollowupDate") && IsDate(value)) result["nextFollowupDate"] = NormalizeDate(value);
            else if (key.Contains("股票") || key.Contains("代码") || key.Contains("product") || key.Contains("symbol")) result["product"] = value;
            else if (key.Contains("方向") || key.Contains("买卖") || key.Contains("direction")) result["direction"] = NormalizeDirection(value);
            else if (key.Contains("渠道") || key.Contains("channel")) { result["channel"] = value; result["source"] = NormalizeSource(value); }
            else if (key.Contains("来源") || key.Contains("source")) result["source"] = NormalizeSource(value);
            else if (key.Contains("状态") || key.Contains("status")) result["status"] = NormalizeStatus(value);
            else if (key.Contains("vip")) result["vipCode"] = value;
            else if (key.Contains("流水") || key.Contains("批次号") || key.Contains("成交编号") || key.Contains("traderef") || key.Contains("orderid")) result["tradeRef"] = value;
            else if (key.Contains("电话") || key.Contains("手机") || key.Contains("phone")) result["phone"] = value;
            else if (key.Contains("姓名") || key.Contains("客户") || key.Contains("name")) result["name"] = value;
            else if (key.Contains("类型") || key.Contains("recordtype") || key.Contains("业务类型")) result["recordType"] = NormalizeRecordType(value);
            else if (key.Contains("金额") || key.Contains("amount")) result["amount"] = value;
            else if (key.Contains("币种") || key.Contains("currency")) result["currency"] = value;
            else if (key.Contains("客户编号") || key.Contains("customerid") || key.Equals("id")) result["customerId"] = value;
            else if (!result.ContainsKey("phone") && LooksLikePhone(value)) result["phone"] = value;
            else if (!result.ContainsKey("direction") && LooksLikeDirection(value)) result["direction"] = NormalizeDirection(value);
            else if (!result.ContainsKey("status") && LooksLikeStatus(value)) result["status"] = NormalizeStatus(value);
            else if (!result.ContainsKey("source") && LooksLikeSource(value)) { result["source"] = NormalizeSource(value); result["channel"] = value; }
            else if (!result.ContainsKey("recordType") && LooksLikeRecordType(value)) result["recordType"] = NormalizeRecordType(value);
            else if (isTicketContext && !result.ContainsKey("product") && LooksLikeProduct(value)) result["product"] = value;
        }
        if (!result.ContainsKey("recordType"))
        {
            if (context.Contains("入金", StringComparison.OrdinalIgnoreCase) || context.Contains("deposit", StringComparison.OrdinalIgnoreCase)) result["recordType"] = "deposit";
            else if (context.Contains("跟票", StringComparison.OrdinalIgnoreCase) || context.Contains("ticket", StringComparison.OrdinalIgnoreCase)) result["recordType"] = "ticket";
            else if (result.ContainsKey("amount") || result.ContainsKey("currency")) result["recordType"] = "deposit";
            else if (result.ContainsKey("product") || result.ContainsKey("direction")) result["recordType"] = "ticket";
        }
        return JsonSerializer.SerializeToElement(result);
    }

    private static string Value(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined ? value.ToString().Trim() : string.Empty;

    private static int? IntValue(JsonElement element, string name) => int.TryParse(Value(element, name), out var value) ? value : null;
    private static DateOnly? DateValue(JsonElement element, string name) => DateOnly.TryParse(Value(element, name), CultureInfo.InvariantCulture, DateTimeStyles.None, out var value) ? value : null;
    private static string NormalizeRecordType(string? value)
    {
        var text = (value ?? string.Empty).Trim().ToLowerInvariant();
        return text.Contains("入金") || text.Contains("deposit") || text.Contains("充值") || text.Contains("付款") || text.Contains("payment") ? "deposit"
            : text.Contains("报名") || text.Contains("registration") || text.Contains("register") ? "registration"
            : text.Contains("跟进") || text.Contains("回访") || text.Contains("follow") ? "followup"
            : text.Contains("客户") || text.Contains("customer") ? "customer" : "ticket";
    }

    private static string NormalizeDirection(string? value)
    {
        var text = (value ?? string.Empty).Trim().ToLowerInvariant();
        return text switch
        {
            "买入" or "买" or "购买" or "购入" or "buy" or "b" => "买入",
            "卖出" or "卖" or "sell" or "s" => "卖出",
            "关注" or "观察" or "持有" or "watch" or "hold" or "h" => "关注",
            _ => (value ?? string.Empty).Trim(),
        };
    }

    private static string NormalizeSource(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        var lower = text.ToLowerInvariant();
        // A label such as “单导群组” describes the acquisition channel first;
        // the trailing group marker must not turn it into a群粉 record.
        if (lower.Contains("单导") || lower.Contains("私聊") || lower.Contains("广告") || lower.Contains("落地页") || lower.Contains("自然") || lower.Contains("direct") || lower.Contains("advert") || lower.Equals("ad", StringComparison.Ordinal)) return "单导";
        if (lower.Contains("群") || lower.Contains("社群") || lower.Contains("group") || lower.Contains("whatsapp")) return "群粉";
        return text;
    }

    private static string NormalizeStatus(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        var lower = text.ToLowerInvariant();
        if (lower.Contains("退群") || lower.Contains("left") || lower.Contains("quit")) return "已退群";
        if (lower.Contains("未进") || lower.Contains("未入") || lower.Contains("not in") || lower.Contains("not_joined")) return "未进群";
        if (lower.Contains("进群") || lower.Contains("已进") || lower.Contains("在群") || lower.Contains("joined") || lower.Contains("in group")) return "已进群";
        if (lower.Contains("重粉") || lower.Contains("duplicate")) return "重粉";
        if (lower.Contains("无效") || lower.Contains("invalid")) return "无效";
        return text;
    }

    private static bool LooksLikePhone(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length is >= 7 and <= 15 && (value ?? string.Empty).Trim().Any(char.IsDigit);
    }

    private static bool LooksLikeDirection(string? value)
        => new[] { "买入", "买", "购买", "卖出", "卖", "buy", "sell", "关注", "观察", "持有", "watch", "hold" }.Contains((value ?? string.Empty).Trim(), StringComparer.OrdinalIgnoreCase);

    private static bool LooksLikeStatus(string? value)
        => new[] { "已进群", "进群", "在群", "未进群", "未进", "退群", "已退群", "重粉", "无效", "joined", "left", "duplicate", "invalid" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeSource(string? value)
        => new[] { "群粉", "群导", "群组", "微信群", "社群", "单导", "私聊", "广告", "落地页", "自然流量", "whatsapp", "telegram", "direct" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeRecordType(string? value)
        => new[] { "入金", "充值", "付款", "deposit", "payment", "跟票", "股票", "买卖", "ticket", "报名", "registration", "跟进", "followup", "客户", "customer" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeProduct(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length is >= 1 and <= 32 && Regex.IsMatch(text, "^[A-Za-z0-9][A-Za-z0-9._-]*$");
    }

    private static bool IsDate(string? value) => !string.IsNullOrWhiteSpace(NormalizeDate(value));
    private static string NormalizeDate(string? value)
    {
        var text = (value ?? string.Empty).Trim().Replace("年", "-").Replace("月", "-").Replace("日", string.Empty).Replace('/', '-').Replace('.', '-');
        text = Regex.Replace(text, "[Tt].*$", string.Empty).Trim();
        var iso = Regex.Match(text, "^(?<year>\\d{4})-(?<month>\\d{1,2})-(?<day>\\d{1,2})$");
        if (iso.Success && TryCreateDate(iso.Groups["year"].Value, iso.Groups["month"].Value, iso.Groups["day"].Value, out var isoDate)) return isoDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var dmy = Regex.Match(text, "^(?<first>\\d{1,2})-(?<second>\\d{1,2})-(?<year>\\d{4})$");
        if (dmy.Success)
        {
            var first = int.Parse(dmy.Groups["first"].Value, CultureInfo.InvariantCulture);
            var second = int.Parse(dmy.Groups["second"].Value, CultureInfo.InvariantCulture);
            var day = first > 12 ? first : second > 12 ? second : first;
            var month = first > 12 ? second : second > 12 ? first : second;
            if (TryCreateDate(dmy.Groups["year"].Value, month.ToString(CultureInfo.InvariantCulture), day.ToString(CultureInfo.InvariantCulture), out var dmyDate)) return dmyDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (Regex.IsMatch(text, "^\\d{8}$"))
        {
            var yearFirst = int.Parse(text[..4], CultureInfo.InvariantCulture);
            if (yearFirst >= 1900 && TryCreateDate(text[..4], text[4..6], text[6..], out var compactYmd)) return compactYmd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var yearLast = int.Parse(text[4..], CultureInfo.InvariantCulture);
            if (yearLast >= 1900 && TryCreateDate(text[4..], text[2..4], text[..2], out var compactDmy)) return compactDmy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (double.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var serial) && serial is >= 1 and <= 2958465)
        {
            try
            {
                var excelDate = DateTime.UnixEpoch.AddDays(serial - 25569d);
                return excelDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            catch (ArgumentOutOfRangeException) { return string.Empty; }
        }
        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var date)) return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return string.Empty;
    }

    private static bool TryCreateDate(string yearText, string monthText, string dayText, out DateTime date)
        => DateTime.TryParseExact($"{yearText}-{monthText}-{dayText}", "yyyy-M-d", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
}
