namespace Zhike.Desktop.Services;

/// <summary>
/// A send authorization is bound to one foreground selection revision and
/// one pooled session/view/Core identity. Invalidating is monotonic: selecting
/// A again never revives a ticket captured before A -> B -> A.
/// This guard does not create/navigate a WebView or cancel background jobs.
/// </summary>
public sealed class WsSendOperationGuard
{
    private long _revision;

    public void Invalidate() => Interlocked.Increment(ref _revision);

    public WsSendOperationTicket Capture(string accountId, long generation, object session, object view, object core)
        => new(Volatile.Read(ref _revision), accountId, generation, session, view, core);

    public bool IsCurrent(WsSendOperationTicket ticket, string accountId, long generation,
        object session, object view, object? core, bool foregroundEligible)
        => foregroundEligible
            && ticket.Revision == Volatile.Read(ref _revision)
            && string.Equals(ticket.AccountId, accountId, StringComparison.OrdinalIgnoreCase)
            && ticket.Generation == generation
            && ReferenceEquals(ticket.Session, session)
            && ReferenceEquals(ticket.View, view)
            && ReferenceEquals(ticket.Core, core);
}

public sealed record WsSendOperationTicket(
    long Revision, string AccountId, long Generation, object Session, object View, object Core);
