namespace Zhike.Domain.Business;

public sealed record CustomerIdentity(string Kind, string Value)
{
    public string Key => $"{Kind}:{Value}";

    public static CustomerIdentity Resolve(string? wsContactId, string? phone, string? accountId, string? sessionId)
    {
        if (!string.IsNullOrWhiteSpace(wsContactId)) return new("ws", wsContactId.Trim());
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (!string.IsNullOrWhiteSpace(digits)) return new("phone", digits);
        if (!string.IsNullOrWhiteSpace(accountId)) return new("account", accountId.Trim());
        if (!string.IsNullOrWhiteSpace(sessionId)) return new("session", sessionId.Trim());
        return new("unknown", string.Empty);
    }
}
