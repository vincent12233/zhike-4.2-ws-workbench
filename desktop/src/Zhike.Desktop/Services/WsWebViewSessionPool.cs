using Microsoft.UI.Xaml.Controls;

namespace Zhike.Desktop.Services;

public sealed record WsWebViewSessionRegistration(
    WebView2 View,
    Action<WebView2>? Release = null,
    WebView2? CollectorView = null);

public sealed class WsWebViewSession
{
    internal WsWebViewSession(
        string accountId,
        long generation,
        WsWebViewSessionRegistration registration,
        DateTimeOffset createdAt)
    {
        AccountId = accountId;
        Generation = generation;
        View = registration.View;
        CollectorView = registration.CollectorView;
        Release = registration.Release;
        CreatedAt = createdAt;
        LastUsedAt = createdAt;
    }

    public string AccountId { get; }
    public long Generation { get; }
    public WebView2 View { get; }
    /// <summary>
    /// Independent collector view with its own user-authenticated profile.
    /// The host initializes it only after an explicit collector action;
    /// foreground connectivity cannot authenticate or activate this surface.
    /// </summary>
    public WebView2? CollectorView { get; }
    public string CollectorState { get; internal set; } = "not-started";
    public string CollectorLoginStatus { get; internal set; } = "";
    public string CollectorDetail { get; internal set; } = "";
    internal bool StartAfterPairing { get; set; }
    internal bool ShouldResumeAfterLogin(bool collectorSignedIn, bool showingLogin)
    {
        if (!collectorSignedIn || CollectorState != "login-visible" || showingLogin && !StartAfterPairing) return false;
        StartAfterPairing = false;
        return true;
    }
    public bool IsCollectorReady => CollectorView?.CoreWebView2 is not null;
    internal string? VisibleDirectoryWorkspaceMode { get; set; }
    public DateTimeOffset CreatedAt { get; }
    public DateTimeOffset LastUsedAt { get; internal set; }
    public bool IsReady => View.CoreWebView2 is not null;
    internal Action<WebView2>? Release { get; }
}

public sealed record WsWebViewSessionAcquireResult(
    WsWebViewSession Session,
    bool Created,
    string? RetiredAccountId);

public sealed record WsWebViewSessionSnapshot(
    string AccountId,
    long Generation,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastUsedAt,
    bool IsReady,
    bool IsForeground,
    bool IsBackgroundLease,
    string CollectorState = "not-started");

/// <summary>
/// Process-owned finite pool for isolated WhatsApp WebView2 sessions.
///
/// WebView2 controls must be created and released on the WinUI dispatcher, so
/// the host supplies the factory and release callback.  Ownership, account
/// identity, generation fencing, capacity and LRU retirement stay here in the
/// application runtime rather than in a route/page.  Each session is backed by
/// its own CoreWebView2Environment/profile directory.
/// </summary>
public sealed class WsWebViewSessionPool
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _mutationGate = new(1, 1);
    private readonly Dictionary<string, WsWebViewSession> _sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly WsRuntimeCoordinator _runtime;
    private readonly int _capacity;
    private long _generation;

    public WsWebViewSessionPool(WsRuntimeCoordinator runtime, int capacity = 3)
    {
        _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
        if (capacity < 2) throw new ArgumentOutOfRangeException(nameof(capacity), "WS session capacity must allow a foreground and a background account.");
        _capacity = capacity;
    }

    public int Capacity => _capacity;

    public async Task<WsWebViewSessionAcquireResult> GetOrCreateAsync(
        string accountId,
        Func<string, long, CancellationToken, Task<WsWebViewSessionRegistration>> factory,
        CancellationToken cancellationToken = default)
    {
        ValidateAccountId(accountId);
        ArgumentNullException.ThrowIfNull(factory);
        var normalizedId = accountId.Trim();
        await _mutationGate.WaitAsync(cancellationToken);
        try
        {
            lock (_sync)
            {
                if (_sessions.TryGetValue(normalizedId, out var existing))
                {
                    existing.LastUsedAt = DateTimeOffset.UtcNow;
                    return new WsWebViewSessionAcquireResult(existing, false, null);
                }
            }

            WsWebViewSession? retired = null;
            lock (_sync)
            {
                if (_sessions.Count >= _capacity)
                {
                    var runtime = _runtime.Snapshot();
                    var protectedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    if (!string.IsNullOrWhiteSpace(runtime.ForegroundAccountId)) protectedIds.Add(runtime.ForegroundAccountId);
                    if (!string.IsNullOrWhiteSpace(runtime.BackgroundAccountId)) protectedIds.Add(runtime.BackgroundAccountId);
                    var victimId = SelectLruVictim(
                        _sessions.Values.Select(item => new WsSessionLruEntry(item.AccountId, item.LastUsedAt)),
                        protectedIds,
                        normalizedId);
                    if (victimId is null)
                        throw new InvalidOperationException("WS session pool is busy with protected foreground/background accounts; retry after the current lease.");
                    retired = _sessions[victimId];
                }
            }
            var generation = Interlocked.Increment(ref _generation);
            WsWebViewSessionRegistration? registration = null;
            var published = false;
            try
            {
                // Build the replacement before releasing the LRU victim. A
                // failed WebView2 environment/navigation must not destroy a
                // healthy account session and leave the pool with less
                // capacity than before.
                registration = await factory(normalizedId, generation, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                if (registration.View is null) throw new InvalidOperationException("WS session factory returned no WebView2 instance.");
                var now = DateTimeOffset.UtcNow;
                var created = new WsWebViewSession(normalizedId, generation, registration, now);
                if (retired is not null)
                {
                    // Keep the victim addressable while the replacement is
                    // being built. This prevents foreground callbacks from
                    // observing a transient "account missing" state during
                    // the asynchronous WebView factory/navigation step.
                    var removed = false;
                    lock (_sync)
                    {
                        if (_sessions.TryGetValue(retired.AccountId, out var current)
                            && ReferenceEquals(current, retired))
                        {
                            _sessions.Remove(retired.AccountId);
                            removed = true;
                        }
                    }
                    if (removed) ReleaseSession(retired);
                }
                lock (_sync) _sessions[normalizedId] = created;
                published = true;
                return new WsWebViewSessionAcquireResult(created, true, retired?.AccountId);
            }
            catch
            {
                if (!published && registration is not null)
                    ReleaseRegistration(registration.View, registration.CollectorView, registration.Release);
                // The victim remains in the dictionary until the registration
                // succeeds, so a transient factory failure leaves the healthy
                // account session untouched and retryable.
                throw;
            }
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public bool TryGet(string accountId, out WsWebViewSession? session)
    {
        session = null;
        if (string.IsNullOrWhiteSpace(accountId)) return false;
        lock (_sync)
        {
            if (!_sessions.TryGetValue(accountId.Trim(), out var found)) return false;
            found.LastUsedAt = DateTimeOffset.UtcNow;
            session = found;
            return true;
        }
    }

    public bool IsCurrent(string accountId, long generation, WebView2? view = null)
    {
        if (string.IsNullOrWhiteSpace(accountId)) return false;
        lock (_sync)
            return _sessions.TryGetValue(accountId.Trim(), out var current)
                && current.Generation == generation
                && (view is null || ReferenceEquals(current.View, view) || ReferenceEquals(current.CollectorView, view));
    }

    public IReadOnlyList<WsWebViewSession> Sessions()
    {
        lock (_sync) return _sessions.Values.OrderBy(item => item.AccountId, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public IReadOnlyList<WsWebViewSessionSnapshot> Snapshot()
    {
        var runtime = _runtime.Snapshot();
        lock (_sync)
            return _sessions.Values
                .OrderBy(item => item.AccountId, StringComparer.OrdinalIgnoreCase)
                .Select(item => new WsWebViewSessionSnapshot(
                    item.AccountId,
                    item.Generation,
                    item.CreatedAt,
                    item.LastUsedAt,
                    item.IsReady,
                    string.Equals(runtime.ForegroundAccountId, item.AccountId, StringComparison.OrdinalIgnoreCase),
                    string.Equals(runtime.BackgroundAccountId, item.AccountId, StringComparison.OrdinalIgnoreCase),
                    item.CollectorState))
                .ToArray();
    }

    public async Task<bool> RemoveAsync(string accountId, CancellationToken cancellationToken = default)
    {
        ValidateAccountId(accountId);
        await _mutationGate.WaitAsync(cancellationToken);
        try
        {
            WsWebViewSession? removed;
            lock (_sync)
            {
                if (!_sessions.Remove(accountId.Trim(), out removed)) return false;
            }
            ReleaseSession(removed);
            return true;
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public async Task ReleaseAllAsync(CancellationToken cancellationToken = default)
    {
        await _mutationGate.WaitAsync(cancellationToken);
        try
        {
            WsWebViewSession[] released;
            lock (_sync)
            {
                released = _sessions.Values.ToArray();
                _sessions.Clear();
            }
            foreach (var session in released) ReleaseSession(session);
        }
        finally
        {
            _mutationGate.Release();
        }
    }

    public void ReleaseAll()
    {
        WsWebViewSession[] released;
        lock (_sync)
        {
            released = _sessions.Values.ToArray();
            _sessions.Clear();
        }
        foreach (var session in released) ReleaseSession(session);
    }

    internal static string? SelectLruVictim(
        IEnumerable<WsSessionLruEntry> entries,
        ISet<string> protectedAccountIds,
        string requestedAccountId)
        => entries
            .Where(item => !string.Equals(item.AccountId, requestedAccountId, StringComparison.OrdinalIgnoreCase)
                && !protectedAccountIds.Contains(item.AccountId))
            .OrderBy(item => item.LastUsedAt)
            .ThenBy(item => item.AccountId, StringComparer.OrdinalIgnoreCase)
            .Select(item => item.AccountId)
            .FirstOrDefault();

    private static void ReleaseSession(WsWebViewSession session)
    {
        session.CollectorState = "not-started";
        ReleaseRegistration(session.View, session.CollectorView, session.Release);
    }

    private static void ReleaseRegistration(WebView2 view, WebView2? collector, Action<WebView2>? release)
    {
        try { release?.Invoke(view); }
        catch
        {
            // Even a failed event-detachment callback must release both views.
        }
        finally
        {
            try { view.Close(); } catch { }
            try { collector?.Close(); } catch { }
        }
    }

    private static void ValidateAccountId(string? accountId)
    {
        if (string.IsNullOrWhiteSpace(accountId)) throw new ArgumentException("WS account id is required.", nameof(accountId));
        if (accountId.Length > 160) throw new ArgumentOutOfRangeException(nameof(accountId));
    }
}

public sealed record WsSessionLruEntry(string AccountId, DateTimeOffset LastUsedAt);
