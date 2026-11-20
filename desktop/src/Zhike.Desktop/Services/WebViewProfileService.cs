using Microsoft.Web.WebView2.Core;
using System.Security.Cryptography;
using System.Text;
using System.Collections.Concurrent;

namespace Zhike.Desktop.Services;

public sealed class WebViewProfileService(string? root = null)
{
#if STAGE51_ISOLATED_UI
    private readonly string _root = Stage51Isolation.MapDataPath(root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "ws-profiles"));
#else
    private readonly string _root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "ws-profiles");
#endif
    // Foreground accounts retain their existing account-scoped environment.
    // Collector profiles are independently signed in by the user and never
    // read, clone or bootstrap from the foreground or historical collector.
    private readonly ConcurrentDictionary<string, Lazy<Task<CoreWebView2Environment>>> _environments = new(StringComparer.OrdinalIgnoreCase);

    public async Task<CoreWebView2Environment> GetOrCreateProfileAsync(string accountId)
        => await GetOrCreateEnvironmentAsync(accountId).ConfigureAwait(true);

    /// <summary>Independent profile; authentication requires its own user login.</summary>
    public Task<CoreWebView2Environment> GetOrCreateCollectorProfileAsync(string accountId)
        => GetOrCreateEnvironmentAsync(accountId, collector: true);

    /// <summary>The retired authenticated-copy API remains permanently denied.</summary>
    public Task PrepareCollectorProfileAsync(string accountId, CancellationToken cancellationToken = default)
        => Task.FromException(WsCollectionCapability.Denied());

    private async Task<CoreWebView2Environment> GetOrCreateEnvironmentAsync(string accountId, bool collector = false)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrWhiteSpace(safeId)) throw new ArgumentException("accountId is required", nameof(accountId));
        // A reserved directory/cache namespace prevents account "a-collector-v2"
        // from sharing foreground authentication with collector "a".
        var profileId = collector ? $"collector:{safeId}" : safeId;
        var profilePath = collector ? CollectorPath(safeId) : Path.Combine(_root, safeId);
        var lazy = _environments.GetOrAdd(profileId, id => new Lazy<Task<CoreWebView2Environment>>(
            () => CreateEnvironmentAsync(profilePath), LazyThreadSafetyMode.ExecutionAndPublication));
        try { return await lazy.Value.ConfigureAwait(true); }
        catch
        {
            _environments.TryRemove(new KeyValuePair<string, Lazy<Task<CoreWebView2Environment>>>(profileId, lazy));
            throw;
        }
    }

    private string CollectorPath(string safeId)
        => Path.Combine(_root, ".independent-collectors-v2", $"{safeId}-collector-v2");

    // Directory metadata only. Do not initialize an environment or inspect
    // cookies, databases or any other authentication contents for metrics.
    public long? GetProfileDirectoryStamp(string accountId, bool collector)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrEmpty(safeId)) return null;
        try
        {
            var path = collector ? CollectorPath(safeId) : Path.Combine(_root, safeId);
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0) return null;
            return Directory.GetCreationTimeUtc(path).Ticks;
        }
        catch (DirectoryNotFoundException) { return 0; }
        catch (FileNotFoundException) { return 0; }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    private static async Task<CoreWebView2Environment> CreateEnvironmentAsync(string profilePath)
    {
        Directory.CreateDirectory(profilePath);
        return await CoreWebView2Environment.CreateWithOptionsAsync(null, profilePath, new CoreWebView2EnvironmentOptions());
    }

    public async Task<bool> ClearProfileAsync(string accountId)
    {
        var safeId = SafeId(accountId);
        if (string.IsNullOrWhiteSpace(safeId)) return false;
        var profileIds = new[] { safeId, $"{safeId}-collector", $"collector:{safeId}" };
        foreach (var profileId in profileIds) _environments.TryRemove(profileId, out _);
        var profilePaths = new[] { Path.Combine(_root, safeId), Path.Combine(_root, $"{safeId}-collector"), CollectorPath(safeId) };
        if (profilePaths.All(path => !Directory.Exists(path))) return true;
        // WebView2 may release profile files slightly after Close(). Retry a
        // bounded number of times and report failure to the caller so the UI
        // cannot claim that a session was cleared when it was not.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                foreach (var profilePath in profilePaths)
                    if (Directory.Exists(profilePath)) Directory.Delete(profilePath, true);
                if (profilePaths.All(path => !Directory.Exists(path))) return true;
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
        return profilePaths.All(path => !Directory.Exists(path));
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
