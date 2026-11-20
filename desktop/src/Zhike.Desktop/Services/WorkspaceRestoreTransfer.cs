using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

internal sealed class WorkspaceRestoreRejectedException(string message) : Exception(message);

// WebView messages stay bounded. Only the completed file is submitted to SQLite.
internal sealed class WorkspaceRestoreTransfer(string? tempDirectory = null)
{
    internal const int ChunkChars = 1024 * 1024;
    private const long MaxBytes = 250L * 1024 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private readonly object _gate = new();
    private string? _transferId;
    private string? _version;
    private int _nextOffset;
    private FileStream? _file;
    private Timer? _timer;
    private DateTime _expires;

    public async Task<JsonElement> ReceiveAsync(JsonElement part, Func<Stream, string, CancellationToken, Task<JsonElement>> submit, CancellationToken token)
    {
        var id = part.GetProperty("transferId").GetString();
        if (!Guid.TryParse(id, out _)) throw new InvalidDataException("恢复传输编号无效。");
        if (part.TryGetProperty("discard", out var discard) && discard.ValueKind == JsonValueKind.True)
        {
            lock (_gate) { if (id == _transferId) CloseStaging(); }
            return JsonSerializer.SerializeToElement(new { discarded = true });
        }
        var chunk = part.GetProperty("chunk").GetString();
        var offset = part.GetProperty("offset").GetInt32();
        if (!part.TryGetProperty("version", out var value) || value.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("恢复传输缺少数据版本。");
        // A fresh database has the explicit empty state version.
        var version = value.GetString()!;
        var last = part.GetProperty("last").GetBoolean();
        if (chunk is null || chunk.Length is 0 or > ChunkChars || offset < 0 || version.Length > 128)
            throw new InvalidDataException("恢复分段或版本无效。");
        token.ThrowIfCancellationRequested();
        FileStream completed;
        lock (_gate)
        {
            if (_file is null)
            {
                if (offset != 0) throw new InvalidDataException("恢复传输已失效，请重新读取备份。");
                var path = Path.Combine(tempDirectory ?? Path.GetTempPath(), Path.GetRandomFileName());
                _file = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 65536, FileOptions.DeleteOnClose | FileOptions.SequentialScan);
                _transferId = id;
                _version = version;
                _nextOffset = 0;
            }
            if (_transferId != id || _version != version || _nextOffset != offset)
                throw new InvalidDataException("恢复传输与当前分段不匹配。");
            try
            {
                var bytes = Utf8.GetBytes(chunk);
                if (_file.Length + bytes.Length > MaxBytes) throw new InvalidDataException("恢复数据超过 250 MB 上限。");
                _file.Write(bytes);
                _nextOffset += chunk.Length;
                if (!last)
                {
                    _expires = DateTime.UtcNow.AddMinutes(2);
                    _timer ??= new Timer(_ => { lock (_gate) { if (DateTime.UtcNow >= _expires) CloseStaging(); } });
                    _timer.Change(TimeSpan.FromMinutes(2), Timeout.InfiniteTimeSpan);
                    return JsonSerializer.SerializeToElement(new { nextOffset = _nextOffset });
                }
                _file.Position = 0;
                completed = _file;
                _file = null;
                CloseStaging();
            }
            catch { CloseStaging(); throw; }
        }
        using (completed) return await submit(completed, version, token);
    }

    public void Reset() { lock (_gate) CloseStaging(); }

    private void CloseStaging()
    {
        _timer?.Dispose();
        _timer = null;
        _file?.Dispose();
        _file = null;
        _transferId = null;
        _version = null;
    }

    internal static async Task<JsonElement> PostAsync(HttpClient client, Stream body, string version, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/workspace/restore");
        request.Headers.Add("X-State-Version", version);
        request.Content = new StreamContent(body);
        request.Content.Headers.ContentType = new("application/json") { CharSet = "utf-8" };
        using var response = await client.SendAsync(request, token);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        var value = document.RootElement;
        if (!response.IsSuccessStatusCode && value.TryGetProperty("code", out var code) && code.GetString() == "WORKSPACE_RESTORE_REJECTED")
            throw new WorkspaceRestoreRejectedException(value.TryGetProperty("error", out var error) ? error.GetString() ?? "工作区恢复被拒绝。" : "工作区恢复被拒绝。");
        response.EnsureSuccessStatusCode();
        return value.Clone();
    }
}
