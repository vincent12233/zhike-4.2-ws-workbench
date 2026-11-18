using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record WorkerRuntimeStatus(
    bool Enabled,
    bool Running,
    string State,
    long Generation,
    int RecoveryCount,
    DateTimeOffset? LastHeartbeatUtc,
    long? WorkerPid,
    long? WorkerWorkingSetBytes,
    string? LastError,
    WorkerSupervisorStatus Supervisor);

/// <summary>
/// Controlled lifecycle boundary for an isolated Worker. It owns exactly one
/// supervisor, starts only when the explicit runtime gate is enabled, and
/// keeps health/recovery work outside the WinUI UI thread.
/// </summary>
public sealed class WorkerRuntimeController : IAsyncDisposable
{
#if WORKER_LIFECYCLE_DIAGNOSTICS
    internal Action<string>? TestTrace { get; set; }
    private int _testTraceErrors;
    internal int TestTraceErrors => _testTraceErrors;
#endif
    [System.Diagnostics.Conditional("WORKER_LIFECYCLE_DIAGNOSTICS")]
    private void Trace(string phase)
    {
#if WORKER_LIFECYCLE_DIAGNOSTICS
        try { TestTrace?.Invoke(phase); }
        catch { Interlocked.Increment(ref _testTraceErrors); }
#endif
    }
    private readonly WorkerSupervisor _supervisor;
    private readonly WorkerFeatureFlagsSnapshot _flags;
    private readonly TimeSpan _heartbeatInterval;
    private readonly TimeSpan _heartbeatTimeout;
    private readonly int _maxRecoveryAttempts;
    private readonly SemaphoreSlim _operationGate = new(1, 1);
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _statusGate = new();
    private CancellationTokenSource? _monitorCts;
    private Task? _monitorTask;
    private WorkerRuntimeStatus _status;
    private bool _disposed;

    public WorkerRuntimeController(
        WorkerSupervisor supervisor,
        WorkerFeatureFlagsSnapshot flags,
        TimeSpan? heartbeatInterval = null,
        TimeSpan? heartbeatTimeout = null,
        int maxRecoveryAttempts = 2)
    {
        _supervisor = supervisor ?? throw new ArgumentNullException(nameof(supervisor));
        _flags = flags ?? throw new ArgumentNullException(nameof(flags));
        _heartbeatInterval = heartbeatInterval ?? TimeSpan.FromSeconds(5);
        _heartbeatTimeout = heartbeatTimeout ?? TimeSpan.FromSeconds(3);
        _maxRecoveryAttempts = Math.Max(0, maxRecoveryAttempts);
        _status = Snapshot("disabled", null, 0, null);
    }

    public WorkerFeatureFlagsSnapshot Flags => _flags;
    public WorkerRuntimeStatus Status { get { lock (_statusGate) return _status; } }
    public bool IsRunning => Status.Running;

    public async Task<WorkerRuntimeStatus> StartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        if (!_flags.WorkerRuntimeEnabled)
        {
            SetStatus("disabled", null, Status.RecoveryCount, Status.LastHeartbeatUtc);
            return Status;
        }

        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!_supervisor.Enabled)
                    throw new InvalidOperationException("Worker runtime is enabled but its supervisor is disabled.");
                if (_supervisor.IsRunning)
                {
                    EnsureMonitorStarted();
                    return SetStatus("running", null, Status.RecoveryCount, Status.LastHeartbeatUtc);
                }

                SetStatus("starting", null, Status.RecoveryCount, Status.LastHeartbeatUtc);
                await _supervisor.StartAsync(cancellationToken).ConfigureAwait(false);
                EnsureMonitorStarted();
                return SetStatus("running", null, Status.RecoveryCount, DateTimeOffset.UtcNow);
            }
            catch (Exception error)
            {
                SetStatus("faulted", Sanitize(error), Status.RecoveryCount, Status.LastHeartbeatUtc);
                throw;
            }
            finally { _lifecycleGate.Release(); }
        }
        finally { _operationGate.Release(); }
    }

    public async Task<WorkerRuntimeStatus> StopAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // Cancel the monitor before taking the lifecycle gate. A monitor
            // recovering on that gate observes cancellation and exits.
            await StopMonitorAsync().ConfigureAwait(false);
            await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await _supervisor.StopAsync(cancellationToken).ConfigureAwait(false);
                return SetStatus(_flags.WorkerRuntimeEnabled ? "stopped" : "disabled", null, Status.RecoveryCount, Status.LastHeartbeatUtc);
            }
            finally { _lifecycleGate.Release(); }
        }
        finally { _operationGate.Release(); }
    }

    public async Task<WorkerRuntimeStatus> RestartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await StopMonitorAsync().ConfigureAwait(false);
            await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!_flags.WorkerRuntimeEnabled)
                    return SetStatus("disabled", null, Status.RecoveryCount, Status.LastHeartbeatUtc);
                await _supervisor.RestartAsync(cancellationToken).ConfigureAwait(false);
                EnsureMonitorStarted();
                return SetStatus("running", null, Status.RecoveryCount, DateTimeOffset.UtcNow);
            }
            finally { _lifecycleGate.Release(); }
        }
        catch (Exception error)
        {
            SetStatus("faulted", Sanitize(error), Status.RecoveryCount, Status.LastHeartbeatUtc);
            throw;
        }
        finally { _operationGate.Release(); }
    }

    public async Task<JsonDocument> RequestAsync(
        string kind,
        JsonElement? payload = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        if (!_flags.WorkerRuntimeEnabled)
            throw new InvalidOperationException("Worker runtime is disabled.");
        return await _supervisor.RequestAsync(kind, payload, timeout, cancellationToken).ConfigureAwait(false);
    }

    public async Task<WorkerSupervisorRotation> RotateTokenAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        if (!_flags.WorkerRuntimeEnabled)
            throw new InvalidOperationException("Worker runtime is disabled.");
        // Rotation changes the process/session boundary. Serialize it with
        // every other lifecycle operation before cancelling/restarting the
        // monitor, then serialize the supervisor transition with the fencing
        // gate.
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await StopMonitorAsync().ConfigureAwait(false);
            await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var rotation = await _supervisor.RotateTokenAsync(cancellationToken).ConfigureAwait(false);
                EnsureMonitorStarted();
                SetStatus(_supervisor.IsRunning ? "running" : "stopped", null, Status.RecoveryCount, DateTimeOffset.UtcNow);
                return rotation;
            }
            finally { _lifecycleGate.Release(); }
        }
        finally { _operationGate.Release(); }
    }

    private void EnsureMonitorStarted()
    {
        if (_monitorTask is { IsCompleted: false }) return;
        _monitorCts?.Dispose();
        _monitorCts = new CancellationTokenSource();
        _monitorTask = MonitorAsync(_monitorCts.Token);
    }

    private async Task MonitorAsync(CancellationToken cancellationToken)
    {
        Trace("monitor.begin");
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(_heartbeatInterval, cancellationToken).ConfigureAwait(false);
                if (cancellationToken.IsCancellationRequested) break;
                if (!_supervisor.IsRunning)
                {
                    await RecoverAsync(cancellationToken).ConfigureAwait(false);
                    continue;
                }

                try
                {
                    Trace("heartbeat.begin");
                    using var heartbeat = await _supervisor.RequestAsync("heartbeat", timeout: _heartbeatTimeout, cancellationToken: cancellationToken).ConfigureAwait(false);
                    Trace("heartbeat.end");
                    var process = _supervisor.WorkerProcess;
                    long? workingSet = null;
                    try { if (process is { HasExited: false }) workingSet = process.WorkingSet64; } catch { }
                    SetStatus("running", null, Status.RecoveryCount, DateTimeOffset.UtcNow, workingSet);
                }
                catch (Exception error) when (error is IOException or TimeoutException or WorkerIpcProtocolException or InvalidOperationException)
                {
                    await RecoverAsync(cancellationToken, error).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error) { SetStatus("faulted", Sanitize(error), Status.RecoveryCount, Status.LastHeartbeatUtc); }
        finally { Trace("monitor.end"); }
    }

    private async Task RecoverAsync(CancellationToken cancellationToken, Exception? cause = null)
    {
        var recoveryCount = Status.RecoveryCount;
        if (recoveryCount >= _maxRecoveryAttempts)
        {
            SetStatus("faulted", Sanitize(cause ?? new IOException("Worker exited unexpectedly.")), recoveryCount, Status.LastHeartbeatUtc);
            return;
        }

        recoveryCount++;
        SetStatus("recovering", cause is null ? null : Sanitize(cause), recoveryCount, Status.LastHeartbeatUtc);
        try
        {
            await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try { await _supervisor.RestartAsync(cancellationToken).ConfigureAwait(false); }
            finally { _lifecycleGate.Release(); }
            SetStatus("running", null, recoveryCount, DateTimeOffset.UtcNow);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            SetStatus("faulted", Sanitize(error), recoveryCount, Status.LastHeartbeatUtc);
        }
    }

    private async Task StopMonitorAsync()
    {
        var cts = _monitorCts;
        var task = _monitorTask;
        _monitorCts = null;
        _monitorTask = null;
        if (cts is null) return;
        Trace("monitor.cancel.begin");
        cts.Cancel();
        Trace("monitor.cancel.end");
        Trace("monitor.await.begin");
        try { if (task is not null) await task.ConfigureAwait(false); } catch { }
        Trace("monitor.await.end");
        cts.Dispose();
    }

    private WorkerRuntimeStatus SetStatus(string state, string? error, int recoveryCount, DateTimeOffset? heartbeat, long? workingSet = null)
    {
        lock (_statusGate)
        {
            _status = Snapshot(state, error, recoveryCount, heartbeat, workingSet);
            return _status;
        }
    }

    private WorkerRuntimeStatus Snapshot(string state, string? error, int recoveryCount, DateTimeOffset? heartbeat, long? workingSet = null)
        => new(_flags.WorkerRuntimeEnabled, _supervisor.IsRunning, state, _supervisor.Status.Generation,
            recoveryCount, heartbeat, _supervisor.WorkerProcess?.Id, workingSet, error, _supervisor.Status);

    private static string Sanitize(Exception? error) => error switch
    {
        null => "UNKNOWN",
        WorkerIpcProtocolException protocol => protocol.Code,
        UnauthorizedAccessException => "AUTH_REVOKED",
        TimeoutException => "TIMEOUT",
        OperationCanceledException => "CANCELLED",
        IOException => "DISCONNECTED",
        _ => error.GetType().Name,
    };

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(WorkerRuntimeController));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try { await StopAsync().ConfigureAwait(false); } catch { }
        _disposed = true;
        _operationGate.Dispose();
        _lifecycleGate.Dispose();
    }
}
