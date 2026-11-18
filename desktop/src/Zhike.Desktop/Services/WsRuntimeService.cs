using Microsoft.UI.Dispatching;

namespace Zhike.Desktop.Services;

/// <summary>
/// Process-level owner of the finite WebView session pool and its scheduler.
/// A XAML host supplies only UI-thread factories/heartbeat adapters; account
/// selection, foreground protection, LRU rotation and lifetime live here.
/// </summary>
public sealed class WsRuntimeService
{
    private readonly WsRuntimeCoordinator _coordinator;
    private readonly WsWebViewSessionPool _pool;
    private readonly SemaphoreSlim _tickGate = new(1, 1);
    private Func<string, long, CancellationToken, Task<WsWebViewSessionRegistration>>? _factory;
    private Func<WsWebViewSession, bool, CancellationToken, Task>? _heartbeat;
    private Func<CancellationToken, Task>? _flush;
    private DispatcherQueueTimer? _timer;
    private string _activeAccountId = string.Empty;

    public WsRuntimeService(WsRuntimeCoordinator coordinator, WsWebViewSessionPool pool)
    {
        _coordinator = coordinator ?? throw new ArgumentNullException(nameof(coordinator));
        _pool = pool ?? throw new ArgumentNullException(nameof(pool));
    }

    public string ActiveAccountId => _activeAccountId;
    public WsWebViewSession? ActiveSession
        => _pool.TryGet(_activeAccountId, out var session) ? session : null;

    public event EventHandler? SessionsChanged;

    public void BindHost(
        DispatcherQueue dispatcher,
        Func<string, long, CancellationToken, Task<WsWebViewSessionRegistration>> factory,
        Func<WsWebViewSession, bool, CancellationToken, Task> heartbeat,
        Func<CancellationToken, Task> flush)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        _factory = factory ?? throw new ArgumentNullException(nameof(factory));
        _heartbeat = heartbeat ?? throw new ArgumentNullException(nameof(heartbeat));
        _flush = flush ?? throw new ArgumentNullException(nameof(flush));
        if (_timer is not null) return;
        _timer = dispatcher.CreateTimer();
        _timer.Interval = TimeSpan.FromSeconds(10);
        // DispatcherQueueTimer has an async-void event surface. Never allow a
        // transient WebView/service exception to escape the event handler and
        // tear down the dispatcher pump (which used to look like periodic WS
        // flicker or a frozen workbench).
        _timer.Tick += async (_, _) =>
        {
            try { await TickAsync(); }
            catch (OperationCanceledException) { }
            catch (Exception error)
            {
                System.Diagnostics.Debug.WriteLine($"WS runtime tick failed: {error.GetType().Name}: {error.Message}");
            }
        };
        _timer.Start();
    }

    public async Task<WsWebViewSessionAcquireResult> ShowAccountAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var factory = _factory ?? throw new InvalidOperationException("WS runtime host is not bound.");
        _coordinator.RegisterAccount(accountId, accountId, WsAccountRuntimeState.Connecting);
        // An explicit Close WS disables background recreation. Opening the
        // same account is the equally explicit resume boundary.
        _coordinator.SetAccountEnabled(accountId, true);
        var previous = _coordinator.Snapshot().ForegroundAccountId;
        _coordinator.SetForegroundAccount(accountId);
        try
        {
            var result = await _pool.GetOrCreateAsync(accountId, factory, cancellationToken);
            if (result.Created)
            {
#if STAGE51_ISOLATED_UI
                // This build has no WS authorization. A local blank entry is
                // not a failed network login and must not enter recovery.
                result.Session.View.Source = new Uri("about:blank");
#else
                result.Session.View.Source = new Uri("https://web.whatsapp.com/");
#endif
            }
            _activeAccountId = accountId;
            SessionsChanged?.Invoke(this, EventArgs.Empty);
            return result;
        }
        catch
        {
            _coordinator.SetForegroundAccount(previous);
            throw;
        }
    }

    public void HideForeground()
    {
        _coordinator.SetForegroundAccount(null);
        SessionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task<bool> CloseAccountAsync(string accountId, CancellationToken cancellationToken = default)
    {
        // Disable before releasing the WebView so the next scheduler tick
        // cannot immediately lease and recreate an account the user just
        // closed. HideForeground is the non-destructive route-change path.
        _coordinator.SetAccountEnabled(accountId, false);
        var removed = await _pool.RemoveAsync(accountId, cancellationToken);
        if (string.Equals(_activeAccountId, accountId, StringComparison.OrdinalIgnoreCase))
        {
            _activeAccountId = string.Empty;
            _coordinator.SetForegroundAccount(null);
        }
        if (removed) SessionsChanged?.Invoke(this, EventArgs.Empty);
        return removed;
    }

    public async Task TickAsync(CancellationToken cancellationToken = default)
    {
#if STAGE51_ISOLATED_UI
        // The native UI acceptance process never drives a WhatsApp collector.
        await Task.CompletedTask;
        return;
#else
        if (!await _tickGate.WaitAsync(0, cancellationToken)) return;
        try
        {
            var factory = _factory;
            var heartbeat = _heartbeat;
            if (factory is null || heartbeat is null) return;
            var snapshot = _coordinator.Snapshot();
            if (!string.IsNullOrWhiteSpace(snapshot.ForegroundAccountId)
                && _pool.TryGet(snapshot.ForegroundAccountId, out var foreground)
                && foreground is not null)
                await RunHeartbeatAsync(foreground, false, heartbeat, cancellationToken).ConfigureAwait(false);

            // RD02: no automatic background lease, WebView creation, profile
            // preparation or collection heartbeat. Manual foreground selection
            // is the only account creation boundary.
            if (_flush is not null) await _flush(cancellationToken).ConfigureAwait(false);
        }
        finally { _tickGate.Release(); }
#endif
    }

    public async Task ShutdownAsync(CancellationToken cancellationToken = default)
    {
        _timer?.Stop();
        _timer = null;
        _coordinator.SetForegroundAccount(null);
        await _pool.ReleaseAllAsync(cancellationToken);
        _activeAccountId = string.Empty;
        SessionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Abort()
    {
        _timer?.Stop();
        _timer = null;
        _coordinator.SetForegroundAccount(null);
        _pool.ReleaseAll();
        _activeAccountId = string.Empty;
        SessionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public IReadOnlyList<WsWebViewSession> Sessions() => _pool.Sessions();
    public bool TryGetSession(string accountId, out WsWebViewSession? session) => _pool.TryGet(accountId, out session);

    private async Task RunHeartbeatAsync(
        WsWebViewSession session,
        bool driveCollection,
        Func<WsWebViewSession, bool, CancellationToken, Task> heartbeat,
        CancellationToken cancellationToken)
    {
        try
        {
            await heartbeat(session, driveCollection, cancellationToken);
            _coordinator.RecordHeartbeat(session.AccountId);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            _coordinator.RecordFailure(session.AccountId, error.Message);
        }
    }
}
