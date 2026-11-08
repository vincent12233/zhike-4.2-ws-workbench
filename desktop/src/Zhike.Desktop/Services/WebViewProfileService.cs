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

    public async Task<bool> ClearProfileAsync(string accountId)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrWhiteSpace(safeId)) return false;
        var profilePath = Path.Combine(_root, safeId);
        if (!Directory.Exists(profilePath)) return true;
        // WebView2 may release profile files slightly after Close(). Retry a
        // bounded number of times and report failure to the caller so the UI
        // cannot claim that a session was cleared when it was not.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                Directory.Delete(profilePath, true);
                return true;
            }
            catch (IOException) when (attempt < 4)
            {
                await Task.Delay(100 * (attempt + 1));
            }
            catch (UnauthorizedAccessException) when (attempt < 4)
            {
                await Task.Delay(100 * (attempt + 1));
            }
        }
        return !Directory.Exists(profilePath);
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
