namespace Zhike.Desktop.Services;

// One state object belongs to one owned WebView surface in one pool generation.
// Callback COM wrappers are deliberately not identities. The budget resets only
// for an explicit refresh/reconnect or a user-initiated document navigation.
public sealed class WsNavigationLifecycle
{
    private readonly HashSet<ulong> _policyCancelled = [];
    private readonly Queue<ulong> _cancelOrder = [];
    private readonly HashSet<ulong> _completed = [];
    private readonly Queue<ulong> _completeOrder = [];
    private long _request;
    private long _cycle;
    private ulong _activeNavigation;
    private bool _recoveryUsed;
    private bool _disposed;

    public WsNavigationLifecycle(string accountId, long generation, string surface)
    { AccountId = accountId; Generation = generation; Surface = surface; }
    public string AccountId { get; }
    public long Generation { get; }
    public string Surface { get; }
    public long Cycle => _cycle;
    public long RequestSequence => _request;
    public string RequestSource { get; private set; } = "initial";
    public int RecoveryCount { get; private set; }

    public void Request(string source, bool explicitBoundary = false)
    {
        if (_disposed) return;
        RequestSource = source;
        _request++;
        if (explicitBoundary) { _cycle++; _recoveryUsed = false; }
    }

    public void Starting(ulong navigationId, bool policyCancelled, bool userInitiated = false)
    {
        if (_disposed) return;
        if (userInitiated) Request("user-navigation", explicitBoundary: true);
        _activeNavigation = navigationId;
        if (policyCancelled) Remember(_policyCancelled, _cancelOrder, navigationId);
    }

    public WsNavigationCompletion Completed(ulong navigationId, bool success, bool operationCancelled, bool isolatedDocument)
    {
        if (_disposed || _completed.Contains(navigationId)) return new("ignored-duplicate-or-disposed");
        Remember(_completed, _completeOrder, navigationId);
        if (_policyCancelled.Remove(navigationId)) return new("policy-cancelled");
        if (navigationId != _activeNavigation) return new("stale-navigation");
        if (success) return new(isolatedDocument ? "isolated-document" : "success");
        if (operationCancelled) return new("operation-cancelled");
        if (_recoveryUsed) return new("failure-budget-exhausted");
        _recoveryUsed = true;
        RecoveryCount++;
        return new("recover", new WsNavigationRecoveryTicket(navigationId, _cycle, _request));
    }

    public bool CanApply(WsNavigationRecoveryTicket ticket)
        => !_disposed && ticket.NavigationId == _activeNavigation && ticket.Cycle == _cycle && ticket.RequestSequence == _request;
    public void Dispose() => _disposed = true;

    private static void Remember(HashSet<ulong> values, Queue<ulong> order, ulong value)
    {
        if (!values.Add(value)) return;
        order.Enqueue(value);
        while (order.Count > 256) values.Remove(order.Dequeue());
    }
}

public sealed record WsNavigationRecoveryTicket(ulong NavigationId, long Cycle, long RequestSequence);
public sealed record WsNavigationCompletion(string Outcome, WsNavigationRecoveryTicket? Recovery = null);
