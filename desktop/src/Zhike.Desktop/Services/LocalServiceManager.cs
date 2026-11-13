using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Reflection;
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
            ?? "6.0.0").Split('+', 2)[0];
    private readonly string _resourceRoot;
    private readonly string _dataRoot;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Process? _process;
    private LocalServiceInfo? _info;
    private string? _healthVersionMismatch;

    public LocalServiceManager(string resourceRoot, string dataRoot)
    {
        _resourceRoot = Path.GetFullPath(resourceRoot);
        _dataRoot = Path.GetFullPath(dataRoot);
    }

    public LocalServiceInfo? Info => _info;
    public bool IsRunning => _process is { HasExited: false } && _info is not null;

    public async Task<LocalServiceInfo> StartAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
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
                    return await StartProcessAsync(port, token, cancellationToken);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    lastError = error;
                    await StopCoreAsync(CancellationToken.None);
                    if (attempt == maxAttempts) throw;
                    await Task.Delay(TimeSpan.FromMilliseconds(150 * attempt), cancellationToken);
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
            // Keep the same loopback endpoint and session token so existing
            // WebView/API clients recover without switching data sources.
            return await StartProcessAsync(previous.Port, previous.ApiToken, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> HealthAsync(CancellationToken cancellationToken = default)
    {
        var info = _info;
        if (info is null || _process is null || _process.HasExited) return false;
        try
        {
            using var response = await _http.GetAsync(new Uri(info.BaseAddress, "api/health"), cancellationToken);
            if (!response.IsSuccessStatusCode) return false;
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
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
        var info = _info ?? throw new InvalidOperationException("本机数据服务尚未启动。");
        var client = new ApiClient(new HttpClient
        {
            BaseAddress = info.BaseAddress,
            Timeout = TimeSpan.FromMinutes(5.5),
        });
        client.SetSessionToken(info.ApiToken);
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
        _process = null;
        _info = null;
        if (process is null) return;
        try
        {
            if (info is not null && !process.HasExited)
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(info.BaseAddress, "api/shutdown"));
                request.Headers.Add("X-Zhike-Shutdown-Token", info.ApiToken);
                using var response = await _http.SendAsync(request, cancellationToken);
            }
        }
        catch { }
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
        }
        process.Dispose();
    }

    private async Task WaitForHealthAsync(LocalServiceInfo info, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_process?.HasExited == true) throw new InvalidOperationException("本机数据服务启动后立即退出，请检查安装资源或数据目录权限。");
            if (await HealthAsync(cancellationToken)) return;
            if (!string.IsNullOrWhiteSpace(_healthVersionMismatch))
                throw new InvalidOperationException($"检测到知客安装文件混装：{_healthVersionMismatch}。请使用同一份 6.0 安装包修复安装，程序不会回退到旧资源。");
            await Task.Delay(150, cancellationToken);
        }
        throw new TimeoutException("本机数据服务启动超时，请重试或检查本机数据目录。");
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
        startInfo.Environment["ZHIKE_DATA_DIR"] = _dataRoot;
        startInfo.Environment["ZHIKE_PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["ZHIKE_API_TOKEN"] = token;
        startInfo.Environment["ZHIKE_SHUTDOWN_TOKEN"] = token;
        startInfo.Environment["ZHIKE_PARENT_PID"] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["ZHIKE_STORAGE_MODE"] = "local";
        var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动本机数据服务。");
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) Debug.WriteLine($"[ZhikeLocal] {e.Data}"); };
        process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) Debug.WriteLine($"[ZhikeLocal:error] {e.Data}"); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _process = process;
        _info = new LocalServiceInfo(new Uri($"http://127.0.0.1:{port}/"), token, port);
        await WaitForHealthAsync(_info, cancellationToken);
        return _info;
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
