using Microsoft.Web.WebView2.Core;

namespace Zhike.Desktop.Services;

public sealed class WebViewProfileService(string? root = null)
{
    private readonly string _root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike", "ws-profiles");

    public async Task<CoreWebView2Environment> GetOrCreateProfileAsync(string accountId)
    {
        var safeId = string.Concat((accountId ?? string.Empty).Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_'));
        if (string.IsNullOrWhiteSpace(safeId)) throw new ArgumentException("accountId is required", nameof(accountId));
        var profilePath = Path.Combine(_root, safeId);
        Directory.CreateDirectory(profilePath);
        return await CoreWebView2Environment.CreateWithOptionsAsync(null, profilePath, new CoreWebView2EnvironmentOptions());
    }

    public Task ClearProfileAsync(string accountId)
    {
        var safeId = string.Concat((accountId ?? string.Empty).Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_'));
        if (string.IsNullOrWhiteSpace(safeId)) return Task.CompletedTask;
        var profilePath = Path.Combine(_root, safeId);
        if (Directory.Exists(profilePath)) Directory.Delete(profilePath, true);
        return Task.CompletedTask;
    }
}
