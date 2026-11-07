using System.Text.RegularExpressions;

namespace Zhike.Infrastructure.Secrets;

public static partial class SecretRedactor
{
    public static string Redact(string? value)
    {
        var text = value ?? string.Empty;
        text = KeyValue().Replace(text, "$1[REDACTED]");
        return Bearer().Replace(text, "Bearer [REDACTED]");
    }

    [GeneratedRegex("((?:password|passwd|token|cookie|api[-_]?key|secret|qr(?:code)?|authorization)\\s*[=:]\\s*)([^\\s,;]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex KeyValue();

    [GeneratedRegex("Bearer\\s+[^\\s]+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Bearer();
}
