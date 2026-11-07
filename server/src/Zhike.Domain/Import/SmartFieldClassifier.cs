using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Zhike.Domain.Import;

public sealed record ClassifiedField(string Role, string Value, double Confidence, int SourcePosition);
public sealed record ClassificationPreview(IReadOnlyList<IReadOnlyDictionary<string, ClassifiedField>> Rows, IReadOnlyList<string> Conflicts);

public static class SmartFieldClassifier
{
    private static readonly IReadOnlyDictionary<string, string[]> Aliases = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["name"] = ["姓名", "客户", "客户名称", "名字", "name", "customer"],
        ["phone"] = ["号码", "电话", "手机", "手机号", "phone", "mobile"],
        ["source"] = ["渠道", "来源", "客户来源", "channel", "source"],
        ["status"] = ["状态", "客户状态", "群状态", "status"],
        ["registeredDate"] = ["登记日期", "登记时间", "注册日期", "入群日期", "registered", "registrationdate"],
        ["nextFollowupDate"] = ["下次跟进", "下次跟进日期", "计划跟进", "跟进日期", "due", "nextfollowup"],
        ["businessDate"] = ["业务日期", "交易日期", "买入日期", "卖出日期", "businessdate", "transactiondate"],
        ["product"] = ["股票", "股票代码", "代码", "产品", "product", "symbol", "stockcode"],
        ["direction"] = ["买卖方向", "方向", "买卖", "direction"],
        ["recordType"] = ["业务类型", "记录类型", "类型", "recordtype", "type"],
        ["vipCode"] = ["vip", "vip编号", "vip号", "vipcode"],
        ["group"] = ["群组", "群", "group"],
        ["amount"] = ["金额", "入金金额", "amount"],
        ["currency"] = ["币种", "货币", "currency"],
    };

    public static ClassificationPreview Classify(IReadOnlyList<IReadOnlyDictionary<string, string>> rows)
    {
        var output = new List<IReadOnlyDictionary<string, ClassifiedField>>();
        var conflicts = new List<string>();
        foreach (var row in rows)
        {
            var classified = new Dictionary<string, ClassifiedField>(StringComparer.OrdinalIgnoreCase);
            var position = 0;
            foreach (var pair in row)
            {
                var header = Normalize(pair.Key);
                var role = ResolveRole(header);
                if (role is null && IsDate(pair.Value)) role = classified.ContainsKey("registeredDate") ? "nextFollowupDate" : "registeredDate";
                if (role is null && LooksLikePhone(pair.Value)) role = "phone";
                if (role is null && LooksLikeDirection(pair.Value)) role = "direction";
                if (role is null && LooksLikeStatus(pair.Value)) role = "status";
                if (role is null && LooksLikeSource(pair.Value)) role = "source";
                if (role is null && LooksLikeRecordType(pair.Value)) role = "recordType";
                if (role is null) { position++; continue; }
                var value = pair.Value?.Trim() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(value)) { position++; continue; }
                if (classified.TryGetValue(role, out var existing) && !string.Equals(existing.Value, value, StringComparison.OrdinalIgnoreCase)) conflicts.Add($"{role}: {existing.Value} / {value}");
                else classified[role] = new ClassifiedField(role, NormalizeValue(role, value), HeaderConfidence(header, role), position);
                position++;
            }
            output.Add(classified);
        }
        return new ClassificationPreview(output, conflicts);
    }

    private static string? ResolveRole(string header)
    {
        var match = Aliases.FirstOrDefault(pair => pair.Value.Any(alias => Normalize(alias) == header));
        return string.IsNullOrWhiteSpace(match.Key) ? null : match.Key;
    }

    private static string Normalize(string value) => (value ?? string.Empty).Normalize(NormalizationForm.FormKC).Trim().ToLowerInvariant().Replace(" ", string.Empty).Replace("_", string.Empty).Replace("-", string.Empty);
    private static string NormalizeValue(string role, string value)
        => role.EndsWith("Date", StringComparison.Ordinal) ? NormalizeDate(value)
            : role.Equals("direction", StringComparison.OrdinalIgnoreCase) ? NormalizeDirection(value)
            : role.Equals("source", StringComparison.OrdinalIgnoreCase) ? NormalizeSource(value)
            : role.Equals("status", StringComparison.OrdinalIgnoreCase) ? NormalizeStatus(value)
            : role.Equals("recordType", StringComparison.OrdinalIgnoreCase) ? NormalizeRecordType(value)
            : value;
    private static bool IsDate(string? value) => !string.IsNullOrWhiteSpace(NormalizeDate(value));
    private static string NormalizeDate(string? value)
    {
        var text = (value ?? string.Empty).Normalize(NormalizationForm.FormKC).Trim().Replace("年", "-").Replace("月", "-").Replace("日", string.Empty).Replace('/', '-').Replace('.', '-');
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
            try { return DateTime.UnixEpoch.AddDays(serial - 25569).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
            catch (ArgumentOutOfRangeException) { return string.Empty; }
        }
        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var parsed)) return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return string.Empty;
    }

    private static bool TryCreateDate(string yearText, string monthText, string dayText, out DateTime date)
        => DateTime.TryParseExact($"{yearText}-{monthText}-{dayText}", "yyyy-M-d", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static bool LooksLikePhone(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length is >= 7 and <= 15;
    }

    private static bool LooksLikeDirection(string? value)
        => new[] { "买入", "买", "购买", "卖出", "卖", "buy", "sell", "关注", "观察", "持有", "watch", "hold" }.Contains((value ?? string.Empty).Trim(), StringComparer.OrdinalIgnoreCase);

    private static bool LooksLikeStatus(string? value)
        => new[] { "已进群", "进群", "在群", "未进群", "未进", "退群", "已退群", "重粉", "无效", "joined", "left", "duplicate", "invalid" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeSource(string? value)
        => new[] { "群粉", "群导", "群组", "微信群", "社群", "单导", "私聊", "广告", "落地页", "自然流量", "whatsapp", "telegram", "direct" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeRecordType(string? value)
        => new[] { "入金", "充值", "付款", "deposit", "payment", "跟票", "股票", "买卖", "ticket", "报名", "registration", "跟进", "followup", "客户", "customer" }.Any(item => (value ?? string.Empty).Contains(item, StringComparison.OrdinalIgnoreCase));

    private static string NormalizeDirection(string value)
        => value.Trim().ToLowerInvariant() switch
        {
            "买入" or "买" or "购买" or "购入" or "buy" or "b" => "买入",
            "卖出" or "卖" or "sell" or "s" => "卖出",
            "关注" or "观察" or "持有" or "watch" or "hold" or "h" => "关注",
            _ => value.Trim(),
        };

    private static string NormalizeSource(string value)
    {
        var text = value.Trim();
        var lower = text.ToLowerInvariant();
        return lower.Contains("单导") || lower.Contains("私聊") || lower.Contains("广告") || lower.Contains("落地页") || lower.Contains("自然") || lower.Contains("direct") || lower.Contains("advert") || lower.Equals("ad", StringComparison.Ordinal) ? "单导"
            : lower.Contains("群") || lower.Contains("社群") || lower.Contains("group") || lower.Contains("whatsapp") ? "群粉"
            : text;
    }

    private static string NormalizeStatus(string value)
    {
        var text = value.Trim();
        var lower = text.ToLowerInvariant();
        return lower.Contains("退群") || lower.Contains("left") || lower.Contains("quit") ? "已退群"
            : lower.Contains("未进") || lower.Contains("未入") || lower.Contains("not in") || lower.Contains("not_joined") ? "未进群"
            : lower.Contains("进群") || lower.Contains("已进") || lower.Contains("在群") || lower.Contains("joined") || lower.Contains("in group") ? "已进群"
            : lower.Contains("重粉") || lower.Contains("duplicate") ? "重粉"
            : lower.Contains("无效") || lower.Contains("invalid") ? "无效" : text;
    }

    private static string NormalizeRecordType(string value)
    {
        var text = value.Trim().ToLowerInvariant();
        return text.Contains("入金") || text.Contains("deposit") || text.Contains("充值") || text.Contains("付款") || text.Contains("payment") ? "deposit"
            : text.Contains("报名") || text.Contains("registration") || text.Contains("register") ? "registration"
            : text.Contains("跟进") || text.Contains("回访") || text.Contains("follow") ? "followup"
            : text.Contains("客户") || text.Contains("customer") ? "customer" : "ticket";
    }
    private static double HeaderConfidence(string header, string role) => Aliases[role].Any(alias => Normalize(alias) == header) ? 0.98 : 0.65;
}
