using System.Text.Json;
using System.Text;

namespace Zhike.Desktop.Services;

public sealed record QueueItem(string Id, string Route, string PayloadJson, DateTimeOffset CreatedAt, int Attempts = 0);

public sealed class LocalQueue
{
    private const int MaxItems = 5000;
    private const int MaxItemBytes = 2 * 1024 * 1024;
    private const long MaxQueueBytes = 64L * 1024 * 1024;
    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);
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
            if (Encoding.UTF8.GetByteCount(json) > MaxItemBytes) throw new InvalidOperationException("离线队列单条数据超过 2 MB，已拒绝写入。");
            items.Add(new QueueItem(Guid.NewGuid().ToString("N"), route, json, DateTimeOffset.UtcNow));
            items = Trim(items);
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
        try
        {
            await using var stream = File.OpenRead(_path);
            var items = await JsonSerializer.DeserializeAsync<List<QueueItem>>(stream, _options, cancellationToken) ?? [];
            return Trim(items);
        }
        catch (JsonException)
        {
            // Do not retry a permanently malformed queue forever.  Preserve
            // the original file for diagnostics and let the app continue;
            // newly captured data can still be queued normally.
            try
            {
                var preserved = $"{_path}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.json";
                File.Move(_path, preserved, false);
            }
            catch { /* another process may be repairing it; keep running */ }
            return [];
        }
    }

    private async Task WriteAsync(List<QueueItem> items, CancellationToken cancellationToken)
    {
        var temp = $"{_path}.{Guid.NewGuid():N}.tmp";
        await using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, items, _options, cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(flushToDisk: true);
        }
        File.Move(temp, _path, true);
    }

    private static List<QueueItem> Trim(IEnumerable<QueueItem> source)
    {
        var now = DateTimeOffset.UtcNow;
        var items = source
            .Where(item => !string.IsNullOrWhiteSpace(item.Id) && !string.IsNullOrWhiteSpace(item.Route) && now - item.CreatedAt <= MaxAge)
            .OrderBy(item => item.CreatedAt)
            .ToList();
        while (items.Count > MaxItems || items.Sum(item => (long)Encoding.UTF8.GetByteCount(item.PayloadJson ?? string.Empty)) > MaxQueueBytes)
            items.RemoveAt(0);
        return items;
    }
}
