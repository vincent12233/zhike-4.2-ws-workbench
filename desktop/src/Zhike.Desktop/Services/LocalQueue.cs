using System.Text.Json;
using System.Text;
using System.Text.Encodings.Web;
using System.Collections.Concurrent;

namespace Zhike.Desktop.Services;

public sealed record QueueItem(string Id, string Route, string PayloadJson, DateTimeOffset CreatedAt, int Attempts = 0, DateTimeOffset? LastAttemptAt = null, string LastError = "");

public sealed class LocalQueue
{
    private const int MaxItems = 5000;
    private const int MaxAttempts = 8;
    private const int MaxItemBytes = 2 * 1024 * 1024;
    private const long MaxQueueBytes = 64L * 1024 * 1024;
    private readonly string _path;
    private readonly string _deadLetterPath;
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> SharedGates = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _gate;
    // Queue files are private local JSON, not HTML. Avoid expanding every CJK
    // character to a six-byte \uXXXX escape; otherwise a bridge packet that is
    // safely below WebView2's limit can unexpectedly exceed the disk-item cap.
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    private readonly JsonSerializerOptions _options = PayloadJsonOptions;

    public LocalQueue(string? root = null)
    {
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "queue");
        Directory.CreateDirectory(basePath);
        _path = Path.Combine(basePath, "pending.json");
        _deadLetterPath = Path.Combine(basePath, "dead-letter.json");
        _gate = SharedGates.GetOrAdd(Path.GetFullPath(_path), _ => new SemaphoreSlim(1, 1));
    }

    public async Task EnqueueAsync(string route, object payload, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var items = await ReadAsync(cancellationToken);
            var json = JsonSerializer.Serialize(payload, _options);
            var itemBytes = Encoding.UTF8.GetByteCount(json);
            if (itemBytes > MaxItemBytes) throw new InvalidOperationException("离线队列单条数据超过 2 MB，已拒绝写入；原有待同步数据未受影响。");
            if (items.Count >= MaxItems || QueueSizeBytes(items) + itemBytes > MaxQueueBytes)
                throw new InvalidOperationException("离线队列容量已满，未写入本次数据；请先恢复本机服务完成同步，原有待同步数据已完整保留。");
            items.Add(new QueueItem(Guid.NewGuid().ToString("N"), route, json, DateTimeOffset.UtcNow));
            await WriteAsync(items, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    /// <summary>
    /// Reads an application payload using the exact Web JSON contract used by
    /// <see cref="EnqueueAsync"/>. QueueItem.PayloadJson is camelCase; using
    /// the parameterless JsonSerializer overload here silently constructs
    /// records with null/default members because that overload is
    /// case-sensitive.
    /// </summary>
    public static T? DeserializePayload<T>(string payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
            throw new InvalidDataException("离线队列数据为空。");
        return JsonSerializer.Deserialize<T>(payloadJson, PayloadJsonOptions);
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

    /// <summary>
    /// Records a failed delivery without losing ordering. Callers stop their
    /// current flush after this method; the next timer retries the same head
    /// item. After repeated failures it is moved to a recoverable dead-letter
    /// file so one permanently malformed packet cannot block every later WS
    /// message forever.
    /// </summary>
    public async Task MarkFailureAsync(string id, Exception error, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var items = await ReadAsync(cancellationToken);
            var index = items.FindIndex(item => item.Id == id);
            if (index < 0) return;
            var current = items[index];
            var updated = current with
            {
                Attempts = current.Attempts + 1,
                LastAttemptAt = DateTimeOffset.UtcNow,
                LastError = SanitizeError(error),
            };
            if (updated.Attempts >= MaxAttempts)
            {
                var deadLetters = await ReadFileAsync(_deadLetterPath, cancellationToken);
                deadLetters.RemoveAll(item => item.Id == updated.Id);
                deadLetters.Add(updated);
                await WriteFileAsync(_deadLetterPath, deadLetters, cancellationToken);
                items.RemoveAt(index);
            }
            else items[index] = updated;
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
            return await JsonSerializer.DeserializeAsync<List<QueueItem>>(stream, _options, cancellationToken) ?? [];
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

    private async Task<List<QueueItem>> ReadFileAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return [];
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<List<QueueItem>>(stream, _options, cancellationToken) ?? [];
        }
        catch (JsonException)
        {
            try
            {
                var preserved = $"{path}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.json";
                File.Move(path, preserved, false);
            }
            catch { }
            return [];
        }
    }

    private async Task WriteAsync(List<QueueItem> items, CancellationToken cancellationToken)
    {
        var temp = $"{_path}.{Guid.NewGuid():N}.tmp";
        await SerializeFileAsync(temp, items, cancellationToken);
        File.Move(temp, _path, true);
    }

    private async Task WriteFileAsync(string path, List<QueueItem> items, CancellationToken cancellationToken)
    {
        var temp = $"{path}.{Guid.NewGuid():N}.tmp";
        await SerializeFileAsync(temp, items, cancellationToken);
        File.Move(temp, path, true);
    }

    private async Task SerializeFileAsync(string temp, List<QueueItem> items, CancellationToken cancellationToken)
    {
        await using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, items, _options, cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(flushToDisk: true);
        }
    }

    private static string SanitizeError(Exception error)
    {
        var value = String.Join(" ", (error.Message ?? error.GetType().Name).Split(new[] { '\r', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries));
        return value.Length <= 500 ? value : value[..500];
    }

    private static long QueueSizeBytes(IEnumerable<QueueItem> source)
        => source.Sum(item => (long)Encoding.UTF8.GetByteCount(item.PayloadJson ?? string.Empty));
}
