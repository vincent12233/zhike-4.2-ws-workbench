using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record StoredWsAccount(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen = null, string? LastKnownStatus = null, string WorkspaceMode = "ordinary");

/// <summary>
/// Small local account index used before/without the API.  It stores only
/// display metadata and profile ids; WebView2 owns the actual session data in
/// its account-scoped profile directory.
/// </summary>
public sealed class WsAccountStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _options = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public WsAccountStore(string? root = null)
    {
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "ws-accounts");
#if STAGE51_ISOLATED_UI
        basePath = Stage51Isolation.MapDataPath(basePath);
#endif
        Directory.CreateDirectory(basePath);
        _path = Path.Combine(basePath, "accounts.json");
    }

    public async Task<IReadOnlyList<StoredWsAccount>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await ReadAsync(cancellationToken);
        }
        catch (JsonException)
        {
            // Keep a corrupt file for diagnostics rather than deleting a
            // user's account index or profile data.
            return [];
        }
        finally { _gate.Release(); }
    }

    public async Task SaveAsync(IEnumerable<StoredWsAccount> accounts, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { await WriteAsync(Normalize(accounts), cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<StoredWsAccount>> UpdateAsync(
        Func<IReadOnlyList<StoredWsAccount>, IEnumerable<StoredWsAccount>> change,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            // Keep read, mutation, and atomic replacement within the same gate.
            // Invalid JSON propagates instead of replacing the unreadable index.
            var current = await ReadAsync(cancellationToken);
            var updated = Normalize(change(current));
            if (!current.SequenceEqual(updated)) await WriteAsync(updated, cancellationToken);
            return updated;
        }
        finally { _gate.Release(); }
    }

    private async Task<IReadOnlyList<StoredWsAccount>> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return [];
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<List<StoredWsAccount>>(stream, _options, cancellationToken) ?? [];
    }

    private static StoredWsAccount[] Normalize(IEnumerable<StoredWsAccount> accounts) => accounts
        .Where(item => !string.IsNullOrWhiteSpace(item.Id))
        .GroupBy(item => item.Id.Trim(), StringComparer.OrdinalIgnoreCase)
        .Select(group => group.Last() with { Id = group.Key })
        .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private async Task WriteAsync(StoredWsAccount[] accounts, CancellationToken cancellationToken)
    {
        var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(accounts, _options), cancellationToken);
        File.Move(temporary, _path, true);
    }
}
