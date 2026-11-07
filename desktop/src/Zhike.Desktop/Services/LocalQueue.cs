using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record QueueItem(string Id, string Route, string PayloadJson, DateTimeOffset CreatedAt, int Attempts = 0);

public sealed class LocalQueue
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _options = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public LocalQueue(string? root = null)
    {
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike", "queue");
        Directory.CreateDirectory(basePath);
        _path = Path.Combine(basePath, "pending.json");
    }

    public async Task EnqueueAsync(string route, object payload, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var items = await ReadAsync(cancellationToken);
            var json = JsonSerializer.Serialize(payload, _options);
            items.Add(new QueueItem(Guid.NewGuid().ToString("N"), route, json, DateTimeOffset.UtcNow));
            await WriteAsync(items, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<QueueItem>> PeekAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { return await ReadAsync(cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task RemoveAsync(string id, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var items = (await ReadAsync(cancellationToken)).Where(item => item.Id != id).ToList();
            await WriteAsync(items, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    private async Task<List<QueueItem>> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return [];
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<List<QueueItem>>(stream, _options, cancellationToken) ?? [];
    }

    private async Task WriteAsync(List<QueueItem> items, CancellationToken cancellationToken)
    {
        var temp = $"{_path}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(items, _options), cancellationToken);
        File.Move(temp, _path, true);
    }
}
