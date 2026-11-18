using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record WorkerSupervisorOptions(
    string WorkspaceRoot,
    string? WorkerExecutablePath = null,
    IReadOnlyList<string>? WorkerArguments = null,
    bool Enabled = false,
    TimeSpan? StartupTimeout = null,
    TimeSpan? RequestTimeout = null);

public sealed record WorkerSupervisorStatus(
    bool Enabled, bool Running, string PipeName, string SessionId, string CurrentSid,
    string? PeerSid, int? WorkerPid, long Generation, string State, string? LastError);

public sealed record WorkerSupervisorRotation(string PreviousToken, string CurrentToken, long Generation);

/// <summary>
/// Owns the desktop-side Worker Named Pipe lifecycle. Production startup stays
/// disabled until the feature gate is approved; isolation tests enable this
/// same class with a temporary child process.
/// </summary>
public sealed class WorkerSupervisor : IAsyncDisposable
{
#if WORKER_LIFECYCLE_DIAGNOSTICS
    internal Action<string>? TestTrace { get; set; }
    private int _testTraceErrors;
    internal int TestTraceErrors => _testTraceErrors;
#endif
    [Conditional("WORKER_LIFECYCLE_DIAGNOSTICS")]
    private void Trace(string phase)
    {
#if WORKER_LIFECYCLE_DIAGNOSTICS
        try { TestTrace?.Invoke(phase); }
        catch { Interlocked.Increment(ref _testTraceErrors); }
#endif
    }
    private readonly WorkerSupervisorOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _requestGate = new(1, 1);
    private Process? _worker;
    private NamedPipeServerStream? _pipe;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private string _token = string.Empty;
    private string _sessionId = string.Empty;
    private string _pipeName = string.Empty;
    private string? _peerSid;
    private string? _lastError;
    private long _generation;
    private string _state = "disabled";
    private int? _workerPid;
    private bool _disposed;

    public WorkerSupervisor(WorkerSupervisorOptions options)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        if (string.IsNullOrWhiteSpace(options.WorkspaceRoot))
            throw new ArgumentException("WorkspaceRoot is required.", nameof(options));
    }

    public bool Enabled => _options.Enabled;
    public bool IsRunning => _worker is { HasExited: false } && _pipe?.IsConnected == true && _writer is not null;
    public string CurrentSid => OperatingSystem.IsWindows() ? WindowsIdentity.GetCurrent().User?.Value ?? string.Empty : string.Empty;
    public string PipeName => _pipeName;
    public string SessionId => _sessionId;
    public string CurrentToken => _token;
    public string? PeerSid => _peerSid;
    public Process? WorkerProcess => _worker;

    public WorkerSupervisorStatus Status => new(
        Enabled, IsRunning, _pipeName, _sessionId, CurrentSid, _peerSid, _workerPid,
        _generation, _state, _lastError);

    public async Task<WorkerSupervisorStatus> StartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!_options.Enabled) { _state = "disabled"; return Status; }
            if (IsRunning) return Status;
            if (!OperatingSystem.IsWindows())
                throw new PlatformNotSupportedException("Named Pipe ACL requires Windows.");
            if (string.IsNullOrWhiteSpace(_options.WorkerExecutablePath) || !File.Exists(_options.WorkerExecutablePath))
                throw new InvalidOperationException("Worker executable is not configured for the enabled supervisor.");

            await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
            _lastError = null;
            _state = "starting";
            _generation++;
            _sessionId = Guid.NewGuid().ToString("N");
            _token = NewToken();
            _pipeName = BuildPipeName(_options.WorkspaceRoot, _sessionId);
            _pipe = CreateSecurePipe(_pipeName, CurrentSid);

            var startInfo = new ProcessStartInfo
            {
                FileName = _options.WorkerExecutablePath,
                WorkingDirectory = Path.GetDirectoryName(_options.WorkerExecutablePath) ?? AppContext.BaseDirectory,
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            foreach (var argument in _options.WorkerArguments ?? Array.Empty<string>())
                startInfo.ArgumentList.Add(argument);
            startInfo.Environment["ZHIKE_WORKER_PIPE"] = _pipeName;
            startInfo.Environment["ZHIKE_WORKER_TOKEN"] = _token;
            startInfo.Environment["ZHIKE_WORKER_SESSION"] = _sessionId;
            startInfo.Environment["ZHIKE_WORKER_SCHEMA"] = WorkerIpcProtocol.CurrentSchemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture);
            startInfo.Environment["ZHIKE_WORKER_PARENT_PID"] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动隔离 Worker。");
            _worker = process;
            _workerPid = process.Id;
            var processGeneration = _generation;
            process.EnableRaisingEvents = true;
            process.Exited += (_, _) =>
            {
                Trace("process.exited");
                // A process exit callback can be delivered after RestartAsync
                // has installed the next process. Fence the callback by both
                // object identity and generation before touching live state.
                if (!ReferenceEquals(_worker, process) || _generation != processGeneration) return;
                _state = "exited";
                _reader = null;
                _writer = null;
                _peerSid = null;
            };
            _ = DrainOutputAsync(process.StandardOutput);
            _ = DrainOutputAsync(process.StandardError);

            using var startup = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            startup.CancelAfter(_options.StartupTimeout ?? TimeSpan.FromSeconds(15));
            await _pipe.WaitForConnectionAsync(startup.Token).ConfigureAwait(false);
            _reader = new StreamReader(_pipe, new UTF8Encoding(false), false, leaveOpen: true);
            _writer = new StreamWriter(_pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            // Impersonation is available after the first pipe frame is read.
            var hello = await ReadEnvelopeAsync(_reader, startup.Token).ConfigureAwait(false);
            _peerSid = ReadPeerSid(_pipe);
            if (!string.Equals(_peerSid, CurrentSid, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException("Worker pipe peer SID does not match the current desktop SID.");
            ValidateHandshake(hello);
            _state = "running";
            return Status;
        }
        catch (Exception error)
        {
            _lastError = SanitizeError(error);
            _state = "faulted";
            await StopCoreAsync(CancellationToken.None).ConfigureAwait(false);
            throw;
        }
        finally { _gate.Release(); }
    }

    public async Task<WorkerSupervisorRotation> RotateTokenAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        string previous;
        bool restart;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            previous = _token;
            // An owned process with a failed/invalidated pipe still requires
            // a real new authenticated session; changing only its token
            // would leave the runtime permanently disconnected.
            restart = _options.Enabled && _worker is not null;
            if (restart) await StopCoreAsync(cancellationToken).ConfigureAwait(false);
            else { _token = NewToken(); _generation++; _state = _options.Enabled ? "token-rotated" : _state; }
        }
        finally { _gate.Release(); }
        if (restart) await StartAsync(cancellationToken).ConfigureAwait(false);
        return new WorkerSupervisorRotation(previous, _token, _generation);
    }

    public async Task<JsonDocument> RequestAsync(
        string kind, JsonElement? payload = null, TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var duration = timeout ?? _options.RequestTimeout ?? TimeSpan.FromSeconds(30);
        if (duration <= TimeSpan.Zero) duration = TimeSpan.FromMilliseconds(1);
        var deadline = DateTimeOffset.UtcNow.Add(duration);
        using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        requestCts.CancelAfter(duration);
        StreamWriter? writer = null;
        StreamReader? reader = null;
        NamedPipeServerStream? pipe = null;
        var token = string.Empty;
        var sessionId = string.Empty;
        var gateOwned = false;
        var writeStarted = false;
        var requestWritten = false;
        var requestId = Guid.NewGuid().ToString("N");
        try
        {
            Trace(kind + ".gate.wait");
            await _requestGate.WaitAsync(requestCts.Token).ConfigureAwait(false);
            gateOwned = true;
            Trace(kind + ".gate.acquired");
            // Copy one authenticated generation while lifecycle changes are
            // excluded; all waits and IO share the original request deadline.
            await _gate.WaitAsync(requestCts.Token).ConfigureAwait(false);
            try
            {
                writer = _writer; reader = _reader; pipe = _pipe;
                token = _token; sessionId = _sessionId;
                if (!IsRunning || writer is null || reader is null || pipe is null)
                    throw new InvalidOperationException("Worker IPC is not connected.");
            }
            finally { _gate.Release(); }
            var envelope = new WorkerIpcEnvelope(
                WorkerIpcProtocol.CurrentSchemaVersion, kind, requestId, sessionId,
                Guid.NewGuid().ToString("N"), WorkerIpcProtocol.ComputeProof(token, requestId, sessionId),
                Payload: payload, DeadlineUnixMs: deadline.ToUnixTimeMilliseconds());
            Trace(kind + ".write.begin");
            writeStarted = true;
            await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(envelope).AsMemory(), requestCts.Token).ConfigureAwait(false);
            requestWritten = true;
            Trace(kind + ".write.end");
            Trace(kind + ".read.begin");
            var response = await ReadEnvelopeAsync(reader, requestCts.Token).ConfigureAwait(false);
            Trace(kind + ".read.end");
            ValidateResponse(response, requestId, sessionId);
            return JsonDocument.Parse(WorkerIpcProtocol.Serialize(response));
        }
        catch (OperationCanceledException)
        {
            Trace(kind + ".cancel.begin");
            if (requestWritten && writer is not null && reader is not null)
            {
                // The previous 750ms drain allowance also bounds the cancel
                // write. A partial frame/absent acknowledgement cannot leave
                // this session available to a later request.
                using var cleanup = new CancellationTokenSource(TimeSpan.FromMilliseconds(750));
                var sent = await TrySendCancelAsync(writer, token, sessionId, requestId, cleanup.Token).ConfigureAwait(false);
                Trace(kind + ".cancel.write-ended");
                var drained = sent && await DrainCancelledResponseAsync(reader, requestId, sessionId, cleanup.Token).ConfigureAwait(false);
                if (!drained) InvalidateCapturedConnection(pipe);
                Trace(kind + ".cancel.cleanup-ended");
            }
            else if (writeStarted) InvalidateCapturedConnection(pipe);
            if (!cancellationToken.IsCancellationRequested) throw new TimeoutException("Worker IPC request timed out.");
            throw;
        }
        catch (IOException) { InvalidateCapturedConnection(pipe); throw; }
        catch (ObjectDisposedException) { InvalidateCapturedConnection(pipe); throw; }
        finally { if (gateOwned) _requestGate.Release(); }
    }

    public async Task<WorkerSupervisorStatus> RestartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { await StopCoreAsync(cancellationToken).ConfigureAwait(false); }
        finally { _gate.Release(); }
        return await StartAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { await StopCoreAsync(cancellationToken).ConfigureAwait(false); }
        finally { _gate.Release(); }
    }

    private async Task StopCoreAsync(CancellationToken cancellationToken)
    {
        _state = "stopping";
        var process = _worker;
        _worker = null; _workerPid = null; _reader = null; _writer = null; _peerSid = null;
        try { _pipe?.Dispose(); } catch { }
        _pipe = null;
        if (process is null) { _state = _options.Enabled ? "stopped" : "disabled"; return; }
        try
        {
            using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            wait.CancelAfter(TimeSpan.FromSeconds(3));
            await process.WaitForExitAsync(wait.Token).ConfigureAwait(false);
        }
        catch { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { } }
        process.Dispose();
        _state = _options.Enabled ? "stopped" : "disabled";
    }

    private static async Task<WorkerIpcEnvelope> ReadEnvelopeAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
        if (line is null) throw new IOException("Worker IPC peer disconnected.");
        return WorkerIpcProtocol.Deserialize(line);
    }

    private static void InvalidateCapturedConnection(NamedPipeServerStream? pipe)
    {
        // Dispose exactly the captured handle, never _pipe: a concurrent
        // rotation may already own a different authenticated generation.
        try { pipe?.Dispose(); } catch { }
    }

    private static async Task<bool> TrySendCancelAsync(StreamWriter writer, string token, string sessionId, string requestId, CancellationToken cancellationToken)
    {
        try
        {
            var cancel = new WorkerIpcEnvelope(
                WorkerIpcProtocol.CurrentSchemaVersion, "cancel", requestId, sessionId,
                Guid.NewGuid().ToString("N"), WorkerIpcProtocol.ComputeProof(token, requestId, sessionId));
            await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(cancel).AsMemory(), cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch { return false; }
    }

    // Keep the single-reader stream aligned after timeout/caller cancellation.
    // The Worker acknowledges a cancel asynchronously; releasing _requestGate
    // before consuming that acknowledgement would let the next request read a
    // stale response and fail its request-id check.
    private static async Task<bool> DrainCancelledResponseAsync(StreamReader reader, string requestId, string sessionId, CancellationToken cancellationToken)
    {
        try
        {
            while (true)
            {
                var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
                if (line is null) return false;
                WorkerIpcEnvelope response;
                try { response = WorkerIpcProtocol.Deserialize(line); }
                catch (WorkerIpcProtocolException) { return false; }
                if (response.SchemaVersion != WorkerIpcProtocol.CurrentSchemaVersion || !string.Equals(response.SessionId, sessionId, StringComparison.Ordinal)) return false;
                if (string.Equals(response.RequestId, requestId, StringComparison.Ordinal)) return true;
            }
        }
        catch { return false; }
    }

    private void ValidateHandshake(WorkerIpcEnvelope hello)
    {
        if (hello.SchemaVersion != WorkerIpcProtocol.CurrentSchemaVersion)
            throw new WorkerIpcProtocolException("UNSUPPORTED_SCHEMA", "Worker IPC schema is not supported.");
        if (!string.Equals(hello.Kind, "hello", StringComparison.Ordinal))
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "Worker IPC handshake kind is invalid.");
        if (string.IsNullOrWhiteSpace(hello.RequestId) || string.IsNullOrWhiteSpace(hello.TraceId))
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "Worker IPC handshake identifiers are missing.");
        if (!string.Equals(hello.SessionId, _sessionId, StringComparison.Ordinal))
            throw new WorkerIpcProtocolException("AUTH_REVOKED", "Worker IPC session is invalid.");
        if (!WorkerIpcProtocol.VerifyProof(_token, hello))
            throw new WorkerIpcProtocolException("AUTH_REVOKED", "Worker IPC token proof is invalid.");
    }

    private static void ValidateResponse(WorkerIpcEnvelope response, string requestId, string sessionId)
    {
        if (response.SchemaVersion != WorkerIpcProtocol.CurrentSchemaVersion)
            throw new WorkerIpcProtocolException("UNSUPPORTED_SCHEMA", "Worker IPC response schema is not supported.");
        if (!string.Equals(response.RequestId, requestId, StringComparison.Ordinal))
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "Worker IPC response request id mismatch.");
        if (!string.Equals(response.SessionId, sessionId, StringComparison.Ordinal))
            throw new WorkerIpcProtocolException("AUTH_REVOKED", "Worker IPC response session mismatch.");
        if (response.Error is not null) throw new WorkerIpcProtocolException(response.Error, "Worker IPC request failed.");
        if (!string.Equals(response.Kind, "response", StringComparison.Ordinal))
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "Worker IPC response kind is invalid.");
    }

    private static NamedPipeServerStream CreateSecurePipe(string name, string currentSid)
    {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(currentSid), PipeAccessRights.FullControl, AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(
            name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous,
            0, 0, security, HandleInheritability.None, PipeAccessRights.ChangePermissions);
    }

    private static string? ReadPeerSid(NamedPipeServerStream pipe)
    {
        var userName = pipe.GetImpersonationUserName();
        if (string.IsNullOrWhiteSpace(userName)) return null;
        try { return new NTAccount(userName).Translate(typeof(SecurityIdentifier)).Value; }
        catch (IdentityNotMappedException) { return null; }
    }

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    private static string BuildPipeName(string workspaceRoot, string sessionId)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(workspaceRoot)))).ToLowerInvariant()[..16];
        return $"Zhike6-{hash}-{sessionId}";
    }

    private static async Task DrainOutputAsync(StreamReader reader)
    {
        try { while (await reader.ReadLineAsync().ConfigureAwait(false) is not null) { } } catch { }
    }

    private static string SanitizeError(Exception error) => error switch
    {
        WorkerIpcProtocolException protocol => protocol.Code,
        UnauthorizedAccessException => "AUTH_REVOKED",
        TimeoutException => "TIMEOUT",
        OperationCanceledException => "CANCELLED",
        IOException => "DISCONNECTED",
        _ => error.GetType().Name,
    };

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(WorkerSupervisor));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try { await StopAsync().ConfigureAwait(false); } catch { }
        _disposed = true;
        _gate.Dispose();
        _requestGate.Dispose();
    }
}
