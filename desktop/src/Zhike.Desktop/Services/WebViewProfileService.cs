using Microsoft.Web.WebView2.Core;
using System.Security.Cryptography;
using System.Text;

namespace Zhike.Desktop.Services;

public sealed class WebViewProfileService(string? root = null)
{
    private readonly string _root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike", "ws-profiles");

    public async Task<CoreWebView2Environment> GetOrCreateProfileAsync(string accountId)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrWhiteSpace(safeId)) throw new ArgumentException("accountId is required", nameof(accountId));
        var profilePath = Path.Combine(_root, safeId);
        Directory.CreateDirectory(profilePath);
        return await CoreWebView2Environment.CreateWithOptionsAsync(null, profilePath, new CoreWebView2EnvironmentOptions());
    }

    public Task ClearProfileAsync(string accountId)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrWhiteSpace(safeId)) return Task.CompletedTask;
        var profilePath = Path.Combine(_root, safeId);
        if (Directory.Exists(profilePath)) Directory.Delete(profilePath, true);
        return Task.CompletedTask;
    }

    private static string SafeId(string? accountId)
    {
        var raw = (accountId ?? string.Empty).Trim();
        if (raw.Length == 0) return string.Empty;
        var normalized = string.Concat(raw.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_'));
        if (normalized == raw && raw.Length <= 64) return normalized;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant()[..10];
        return $"{normalized[..Math.Min(normalized.Length, 52)]}-{hash}";
    }
}
