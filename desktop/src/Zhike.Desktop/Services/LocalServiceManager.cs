using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record LocalServiceInfo(Uri BaseAddress, string ApiToken, int Port);

/// <summary>
/// Owns the desktop-local SQLite service. It deliberately has no Docker or
/// remote-server branch: the WinUI shell always talks to this loopback service.
/// </summary>
public sealed class LocalServiceManager : IAsyncDisposable
{
    private static readonly string ExpectedAppVersion =
        (typeof(LocalServiceManager).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? typeof(LocalServiceManager).Assembly.GetName().Version?.ToString(3)
            ?? "6.1.0").Split('+', 2)[0];
    private readonly string _resourceRoot;
    private readonly string _dataRoot;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly StringBuilder _outputTail = new();
    private Process? _process;
    private LocalServiceInfo? _info;
    // Host-memory capability. Never include it in LocalServiceInfo, connection files or logs.
    private readonly string _nativeWriteToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private volatile bool _ready;
    private string? _healthVersionMismatch;

    public LocalServiceManager(string resourceRoot, string dataRoot)
    {
        _resourceRoot = Path.GetFullPath(resourceRoot);
        _dataRoot = Path.GetFullPath(dataRoot);
#if STAGE51_ISOLATED_UI
        // Fail closed before StartAsync can create any caller-supplied path.
        _dataRoot = Stage51Isolation.MapDataPath(_dataRoot);
#endif
    }

    public LocalServiceInfo? Info => _ready ? _info : null;
    public bool IsRunning => _ready && _process is { HasExited: false } && _info is not null;
    /// <summary>Data directory the sidecar was pointed at, for diagnostics only.</summary>
    public string DataRoot => _dataRoot;
    /// <summary>Last sidecar failure with its own stderr excerpt, never a token.</summary>
    public string? LastFailure { get; private set; }
    /// <summary>Bounded tail of sidecar stdout/stderr, used to explain a failed start.</summary>
    public string OutputTail { get { lock (_outputTail) return _outputTail.ToString(); } }

    public async Task<LocalServiceInfo> StartAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (IsRunning) return _info!;
            Directory.CreateDirectory(_dataRoot);
            EnsureResources();

            // Finding a free port and then starting Node is inherently racy: another
            // process can claim the port in between.  The sidecar deliberately fails
            // fast on EADDRINUSE (rather than silently moving to another port), so the
            // owner must retry the complete start/health handshake with a fresh port.
            Exception? lastError = null;
            const int maxAttempts = 3;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var port = FindFreePort();
                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                try
                {
                    return await StartProcessAsync(port, token, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    lastError = error;
                    LastFailure = error.Message;
                    await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
                    if (attempt == maxAttempts) throw;
                    await Task.Delay(TimeSpan.FromMilliseconds(150 * attempt), cancellationToken).ConfigureAwait(false);
                }
            }

            throw lastError ?? new InvalidOperationException("无法启动本机数据服务。");
        }
        finally { _gate.Release(); }
    }

    public async Task<LocalServiceInfo> RestartAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var previous = _info;
            if (previous is null) throw new InvalidOperationException("本机数据服务尚未启动。");
            using var stopTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            stopTimeout.CancelAfter(TimeSpan.FromSeconds(5));
            await StopCoreAsync(stopTimeout.Token);
            EnsureResources();
            // Prefer the previous endpoint for existing clients, then retry
            // the complete process/health handshake with a fresh port if a
            // competing local process wins the race during restart. The token
            // remains stable so the recovered client keeps the same session.
            Exception? lastError = null;
            for (var attempt = 0; attempt < 3; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var port = attempt == 0 ? previous.Port : FindFreePort();
                try { return await StartProcessAsync(port, previous.ApiToken, cancellationToken); }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    lastError = error;
                    await StopCoreAsync(CancellationToken.None);
                    if (attempt < 2) await Task.Delay(TimeSpan.FromMilliseconds(150 * (attempt + 1)), cancellationToken);
                }
            }
            throw lastError ?? new InvalidOperationException("无法恢复本机数据服务。");
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> HealthAsync(CancellationToken cancellationToken = default)
    {
        var info = _info;
        if (info is null || _process is null || _process.HasExited) return false;
        try
        {
            using var response = await _http.GetAsync(new Uri(info.BaseAddress, "api/health"), cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return false;
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            using var document = JsonDocument.Parse(payload);
            var actual = document.RootElement.TryGetProperty("appVersion", out var version) ? version.GetString() : null;
            if (!string.Equals(actual, ExpectedAppVersion, StringComparison.Ordinal))
            {
                _healthVersionMismatch = $"桌面程序 {ExpectedAppVersion} 与本机资源 {actual ?? "未知"} 不一致";
                return false;
            }
            _healthVersionMismatch = null;
            return true;
        }
        catch { return false; }
    }

    public ApiClient CreateApiClient()
    {
        var info = Info ?? throw new InvalidOperationException("本机数据服务尚未启动。");
        var client = new ApiClient(new HttpClient
        {
            BaseAddress = info.BaseAddress,
            Timeout = TimeSpan.FromMinutes(5.5),
        });
        client.SetSessionToken(info.ApiToken);
        client.ConfigureNativeWriteAuthority(_nativeWriteToken);
        client.ConfigureLocalSidecar();
        return client;
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { await StopCoreAsync(cancellationToken); }
        finally { _gate.Release(); }
    }

    private async Task StopCoreAsync(CancellationToken cancellationToken)
    {
        var process = _process;
        var info = _info;
        _ready = false;
        _process = null;
        _info = null;
        if (process is null) return;
        using var stopBudget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        stopBudget.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            if (info is not null && !process.HasExited)
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(info.BaseAddress, "api/shutdown"));
                request.Headers.Add("X-Zhike-Api-Token", info.ApiToken);
                request.Headers.Add("X-Zhike-Shutdown-Token", info.ApiToken);
                using var response = await _http.SendAsync(request, stopBudget.Token).ConfigureAwait(false);
            }
        }
        catch { }
        try
        {
            await process.WaitForExitAsync(stopBudget.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The process reference was created and retained by this owner;
            // never look up or terminate a different process by name or port.
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            using var killBudget = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await process.WaitForExitAsync(killBudget.Token).ConfigureAwait(false);
        }
        finally { process.Dispose(); }
        cancellationToken.ThrowIfCancellationRequested();
    }

    private void AppendTail(string line)
    {
        lock (_outputTail)
        {
            if (_outputTail.Length > 0) _outputTail.Append('\n');
            _outputTail.Append(line.Length > 500 ? line[..500] : line);
            // Keep the most recent ~3 KB so a long-running sidecar cannot grow it.
            if (_outputTail.Length > 3072) _outputTail.Remove(0, _outputTail.Length - 3072);
        }
    }

    private string WithTail(string message)
    {
        var tail = OutputTail.Trim();
        if (tail.Length == 0) return message;
        var lines = tail.Split('\n');
        var last = lines[^1].Trim();
        return $"{message}（本机服务最后输出：{last}）";
    }

    private async Task WaitForHealthAsync(LocalServiceInfo info, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_process?.HasExited == true) throw new InvalidOperationException(WithTail("本机数据服务启动后立即退出，请检查安装资源或数据目录权限。"));
            if (await HealthAsync(cancellationToken).ConfigureAwait(false)) return;
            if (!string.IsNullOrWhiteSpace(_healthVersionMismatch))
                throw new InvalidOperationException($"检测到知客安装文件混装：{_healthVersionMismatch}。请使用同一版本的安装包修复安装，程序不会回退到旧资源。");
            await Task.Delay(150, cancellationToken).ConfigureAwait(false);
        }
        throw new TimeoutException(WithTail("本机数据服务启动超时，请重试或检查本机数据目录。"));
    }

    private void EnsureResources()
    {
        if (!File.Exists(Path.Combine(_resourceRoot, "node.exe")) || !File.Exists(Path.Combine(_resourceRoot, "server.mjs")))
            throw new InvalidOperationException("本机数据服务资源不完整，请重新安装知客。");
    }

    private async Task<LocalServiceInfo> StartProcessAsync(int port, string token, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(_resourceRoot, "node.exe"),
            WorkingDirectory = _resourceRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add(Path.Combine(_resourceRoot, "server.mjs"));
        // Environment variables are configuration input, not authority. Normal
        // builds must never inherit development/test gates from the parent.
        // Retain Windows/runtime environment; rebuild only our own namespace.
        foreach (var key in startInfo.Environment.Keys.Where(key =>
                     key.StartsWith("ZHIKE_", StringComparison.OrdinalIgnoreCase)).ToArray())
            startInfo.Environment.Remove(key);
        startInfo.Environment["ZHIKE_DATA_DIR"] = _dataRoot;
        startInfo.Environment["ZHIKE_PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["ZHIKE_API_TOKEN"] = token;
        startInfo.Environment["ZHIKE_NATIVE_WRITE_TOKEN"] = _nativeWriteToken;
        startInfo.Environment["ZHIKE_SHUTDOWN_TOKEN"] = token;
        startInfo.Environment["ZHIKE_PARENT_PID"] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["ZHIKE_STORAGE_MODE"] = "local";
#if STAGE51_ISOLATED_UI
        if (!string.Equals(Path.GetFullPath(_dataRoot), Stage51Isolation.DataRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Isolated sidecar data root mismatch.");
        startInfo.Environment["ZHIKE_GROUP_MANAGER_MODE"] = "isolated";
        startInfo.Environment["ZHIKE_STAGE3_MOCK"] = "1";
        startInfo.Environment["ZHIKE_FENCING_MODE"] = "isolated";
        startInfo.Environment["ZHIKE_AI_PIPELINE_MODE"] = "isolated";
        startInfo.Environment["ZHIKE_STAGE4_MOCK"] = "1";
#endif
        var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动本机数据服务。");
        _process = process;
        _info = new LocalServiceInfo(new Uri($"http://127.0.0.1:{port}/"), token, port);
        _healthVersionMismatch = null;
        try
        {
            process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) { Debug.WriteLine($"[ZhikeLocal] {e.Data}"); AppendTail(e.Data); } };
            process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) { Debug.WriteLine($"[ZhikeLocal:error] {e.Data}"); AppendTail(e.Data); } };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
#if STAGE51_ISOLATED_UI
            Stage51Isolation.PublishConnection(_info);
#endif
            await WaitForHealthAsync(_info, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _ready = true;
#if STAGE51_ISOLATED_UI
            Stage51Isolation.Record("sidecar-ready", new { _info.Port });
#endif
            return _info;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A startup cancelled before health must not leave an owned process
            // published as the next attempt's endpoint.
            try { await StopCoreAsync(CancellationToken.None).ConfigureAwait(false); }
            catch (Exception error) { Debug.WriteLine($"[ZhikeLocal] Cancelled startup cleanup failed: {error.GetType().Name}"); }
            throw;
        }
    }

    private static int FindFreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    public async ValueTask DisposeAsync()
    {
        try { await StopAsync(); } catch { }
        _http.Dispose();
        _gate.Dispose();
    }
}
