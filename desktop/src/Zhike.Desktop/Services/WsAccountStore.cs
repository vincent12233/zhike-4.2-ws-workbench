using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record StoredWsAccount(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen = null);

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
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike", "ws-accounts");
        Directory.CreateDirectory(basePath);
        _path = Path.Combine(basePath, "accounts.json");
    }

    public async Task<IReadOnlyList<StoredWsAccount>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path)) return [];
            await using var stream = File.OpenRead(_path);
            return await JsonSerializer.DeserializeAsync<List<StoredWsAccount>>(stream, _options, cancellationToken) ?? [];
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
        try
        {
            var unique = accounts
                .Where(item => !string.IsNullOrWhiteSpace(item.Id))
                .GroupBy(item => item.Id.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(group => group.Last() with { Id = group.Key })
                .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(unique, _options), cancellationToken);
            File.Move(temporary, _path, true);
        }
        finally { _gate.Release(); }
    }
}
