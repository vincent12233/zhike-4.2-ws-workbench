using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Npgsql;
using NpgsqlTypes;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record AiFollowupInput(string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority);
public sealed record AiAnalysisInput(
    string Id,
    string JobId,
    string AccountId,
    string ConversationId,
    string? SourceMessageId,
    string? CustomerId,
    string Summary,
    string Intent,
    double? IntentScore,
    string Emotion,
    string Urgency,
    string Language,
    IReadOnlyList<string> ProductInterest,
    string Budget,
    JsonElement Contact,
    JsonElement Profile,
    double Confidence,
    JsonElement Raw,
    AiFollowupInput? Followup);

public sealed record AiSyncResult(string? CustomerId, bool CustomerCreated, IReadOnlyList<string> AppliedFields, IReadOnlyList<string> Conflicts, bool FollowupCreated);

public sealed class AiAnalysisRepository(PostgresConnectionFactory connections)
{
    public async Task<AiSyncResult> SaveAndSyncAsync(AiAnalysisInput input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input.JobId)) throw new ArgumentException("jobId is required", nameof(input));
        if (string.IsNullOrWhiteSpace(input.ConversationId)) throw new ArgumentException("conversationId is required", nameof(input));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var analysisId = input.Id;
        await using (var analysis = new NpgsqlCommand("""
            INSERT INTO ai_analysis_results(id, job_id, account_id, conversation_id, source_message_id, summary, intent, intent_score, emotion, urgency, language, product_interest, budget, contact, profile, confidence, raw_json)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (job_id) DO UPDATE SET updated_at = now()
            RETURNING id
            """, connection, transaction))
        {
            analysis.Parameters.AddWithValue(input.Id);
            analysis.Parameters.AddWithValue(input.JobId);
            analysis.Parameters.AddWithValue(input.AccountId);
            analysis.Parameters.AddWithValue(input.ConversationId);
            analysis.Parameters.AddWithValue((object?)input.SourceMessageId ?? DBNull.Value);
            analysis.Parameters.AddWithValue(input.Summary ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Intent ?? string.Empty);
            analysis.Parameters.AddWithValue((object?)input.IntentScore ?? DBNull.Value);
            analysis.Parameters.AddWithValue(input.Emotion ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Urgency ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Language ?? string.Empty);
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(input.ProductInterest ?? []) });
            analysis.Parameters.AddWithValue(input.Budget ?? string.Empty);
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Contact.ValueKind == JsonValueKind.Undefined ? "{}" : input.Contact.GetRawText() });
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Profile.ValueKind == JsonValueKind.Undefined ? "{}" : input.Profile.GetRawText() });
            analysis.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Raw.ValueKind == JsonValueKind.Undefined ? "{}" : input.Raw.GetRawText() });
            analysisId = Convert.ToString(await analysis.ExecuteScalarAsync(cancellationToken)) ?? input.Id;
        }

        var contact = ObjectMap(input.Contact);
        var profile = ObjectMap(input.Profile);
        var phone = Digits(Value(contact, "phone", "number", "account"));
        var customerId = await ResolveCustomerAsync(input.CustomerId, input.ConversationId, phone, connection, transaction, cancellationToken);
        var created = false;
        if (string.IsNullOrWhiteSpace(customerId))
        {
            // A conversation is the stable fallback identity when AI cannot
            // extract a phone number. This prevents concurrent retries from
            // creating a new customer for every analysis of the same chat.
            customerId = $"cust-ws-{ShortHash($"{input.AccountId}\u001f{input.ConversationId}")}";
            await using var create = new NpgsqlCommand("INSERT INTO customers(id, name, phone, country, language, source, stage, intent_level, occupation, age, budget, product_interest, ai_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING", connection, transaction);
            create.Parameters.AddWithValue(customerId);
            create.Parameters.AddWithValue(Value(contact, "name", "customerName"));
            create.Parameters.AddWithValue(phone);
            create.Parameters.AddWithValue(Value(contact, "country", "countryCode"));
            create.Parameters.AddWithValue(input.Language ?? string.Empty);
            create.Parameters.AddWithValue(Value(profile, "origin", "source"));
            create.Parameters.AddWithValue(Value(profile, "customerStage", "stage"));
            create.Parameters.AddWithValue(input.Intent ?? string.Empty);
            create.Parameters.AddWithValue(Value(profile, "occupation", "job"));
            create.Parameters.AddWithValue(ParseAge(Value(profile, "age")) is int age ? age : DBNull.Value);
            create.Parameters.AddWithValue(input.Budget ?? string.Empty);
            create.Parameters.AddWithValue(string.Join(", ", input.ProductInterest ?? []));
            create.Parameters.AddWithValue(input.Summary ?? string.Empty);
            created = await create.ExecuteNonQueryAsync(cancellationToken) > 0;
        }

        if (!string.IsNullOrWhiteSpace(phone))
        {
            await using var identity = new NpgsqlCommand("""
                INSERT INTO customer_identities(customer_id, identity_type, normalized_value, raw_value, source, is_primary)
                VALUES ($1, 'phone', $2, $2, 'ai', true)
                ON CONFLICT (identity_type, normalized_value) DO NOTHING
                """, connection, transaction);
            identity.Parameters.AddWithValue(customerId);
            identity.Parameters.AddWithValue(phone);
            await identity.ExecuteNonQueryAsync(cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(input.ConversationId) && !string.IsNullOrWhiteSpace(customerId))
        {
            await using var link = new NpgsqlCommand("UPDATE conversations SET customer_id = COALESCE(customer_id, $2), updated_at = now() WHERE id = $1", connection, transaction);
            link.Parameters.AddWithValue(input.ConversationId);
            link.Parameters.AddWithValue(customerId);
            await link.ExecuteNonQueryAsync(cancellationToken);
        }

        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["name"] = Value(contact, "name", "customerName"),
            ["phone"] = phone,
            ["country"] = Value(contact, "country", "countryCode"),
            ["language"] = input.Language ?? string.Empty,
            ["source"] = Value(profile, "origin", "source"),
            ["stage"] = Value(profile, "customerStage", "stage"),
            ["intent_level"] = input.Intent ?? string.Empty,
            ["occupation"] = Value(profile, "occupation", "job"),
            ["age"] = ParseAge(Value(profile, "age"))?.ToString() ?? string.Empty,
            ["budget"] = input.Budget ?? string.Empty,
            ["product_interest"] = string.Join(", ", input.ProductInterest ?? []),
            ["ai_summary"] = input.Summary ?? string.Empty,
        };
        var applied = new List<string>();
        var conflicts = new List<string>();
        foreach (var field in fields.Where(item => !string.IsNullOrWhiteSpace(item.Value)))
        {
            var sql = field.Key.Equals("age", StringComparison.OrdinalIgnoreCase)
                ? "UPDATE customers SET age = CASE WHEN age IS NULL THEN NULLIF($2, '')::integer ELSE age END, updated_at = now() WHERE id = $1 RETURNING age"
                : $"UPDATE customers SET {field.Key} = CASE WHEN NULLIF(BTRIM({field.Key}), '') IS NULL THEN $2 ELSE {field.Key} END, updated_at = now() WHERE id = $1 RETURNING {field.Key}";
            await using var update = new NpgsqlCommand(sql, connection, transaction);
            update.Parameters.AddWithValue(customerId);
            update.Parameters.AddWithValue(field.Value);
            var existing = Convert.ToString(await update.ExecuteScalarAsync(cancellationToken)) ?? string.Empty;
            var status = string.Equals(existing, field.Value, StringComparison.Ordinal) ? "applied" : "conflict";
            if (status == "applied") applied.Add(field.Key);
            else conflicts.Add(field.Key);
            await using var evidence = new NpgsqlCommand("INSERT INTO ai_field_observations(analysis_id, customer_id, field_name, value_json, confidence, source_message_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (analysis_id, field_name) DO UPDATE SET value_json = EXCLUDED.value_json, confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = now()", connection, transaction);
            evidence.Parameters.AddWithValue(analysisId);
            evidence.Parameters.AddWithValue(customerId);
            evidence.Parameters.AddWithValue(field.Key);
            evidence.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(field.Value) });
            evidence.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            evidence.Parameters.AddWithValue((object?)input.SourceMessageId ?? DBNull.Value);
            evidence.Parameters.AddWithValue(status);
            await evidence.ExecuteNonQueryAsync(cancellationToken);
        }

        var followupCreated = false;
        if (input.Followup is not null && !string.IsNullOrWhiteSpace(input.Followup.ReasonKey))
        {
            var dedupe = $"{customerId}:{input.Followup.ReasonKey.Trim()}";
            await using var followup = new NpgsqlCommand("""
                INSERT INTO followup_tasks(id, customer_id, reason_key, title, detail, due_at, priority, source_message_id, dedupe_key)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                ON CONFLICT (dedupe_key) DO NOTHING
                """, connection, transaction);
            followup.Parameters.AddWithValue($"followup-{Guid.NewGuid():N}");
            followup.Parameters.AddWithValue(customerId);
            followup.Parameters.AddWithValue(input.Followup.ReasonKey.Trim());
            followup.Parameters.AddWithValue(input.Followup.Title ?? string.Empty);
            followup.Parameters.AddWithValue(input.Followup.Detail ?? string.Empty);
            followup.Parameters.AddWithValue((object?)input.Followup.DueAt ?? DBNull.Value);
            followup.Parameters.AddWithValue(input.Followup.Priority ?? "normal");
            followup.Parameters.AddWithValue((object?)input.SourceMessageId ?? DBNull.Value);
            followup.Parameters.AddWithValue(dedupe);
            followupCreated = await followup.ExecuteNonQueryAsync(cancellationToken) > 0;
        }
        await AuditWriter.AppendAsync(connection, transaction, "ai", input.AccountId, "ai.analysis.synced", "customer", customerId, new { analysisId, input.JobId, applied, conflicts, followupCreated }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AiSyncResult(customerId, created, applied, conflicts, followupCreated);
    }

    private static async Task<string?> ResolveCustomerAsync(string? explicitId, string conversationId, string phone, NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using (var conversationLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('conversation:' || $1, 0))", connection, transaction))
        {
            conversationLock.Parameters.AddWithValue(conversationId);
            await conversationLock.ExecuteNonQueryAsync(cancellationToken);
        }
        if (!string.IsNullOrWhiteSpace(phone))
        {
            await using var lockCommand = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('phone:' || $1, 0))", connection, transaction);
            lockCommand.Parameters.AddWithValue(phone);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var command = new NpgsqlCommand("""
            SELECT c.customer_id FROM conversations c
            JOIN customers linked ON linked.id = c.customer_id AND linked.deleted_at IS NULL
            WHERE c.id = $1 AND c.customer_id IS NOT NULL
            UNION ALL SELECT i.customer_id FROM customer_identities i
            JOIN customers by_identity ON by_identity.id = i.customer_id AND by_identity.deleted_at IS NULL
            WHERE i.identity_type = 'phone' AND $2 <> '' AND i.normalized_value = $2
            UNION ALL SELECT id FROM customers WHERE deleted_at IS NULL AND $2 <> '' AND regexp_replace(phone, '\D', '', 'g') = $2
            UNION ALL SELECT id FROM customers WHERE deleted_at IS NULL AND id = NULLIF($3, '')
            LIMIT 1
            """, connection, transaction);
        command.Parameters.AddWithValue(conversationId);
        command.Parameters.AddWithValue(phone);
        command.Parameters.AddWithValue(explicitId?.Trim() ?? string.Empty);
        return Convert.ToString(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static Dictionary<string, string> ObjectMap(JsonElement element)
        => element.ValueKind == JsonValueKind.Object ? element.EnumerateObject().ToDictionary(item => item.Name, item => item.Value.ToString(), StringComparer.OrdinalIgnoreCase) : new(StringComparer.OrdinalIgnoreCase);

    private static string Value(IReadOnlyDictionary<string, string> map, params string[] keys)
        => keys.Select(key => map.TryGetValue(key, out var value) ? value : string.Empty).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;

    private static string Digits(string value) => new(value.Where(char.IsDigit).ToArray());
    private static int? ParseAge(string value) => int.TryParse(value, out var age) && age is >= 0 and <= 120 ? age : null;
    private static string ShortHash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty))).ToLowerInvariant()[..24];
}
