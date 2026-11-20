namespace Zhike.Desktop.Services;

public sealed record WsAccountMetricRuntime(string AccountId, long Generation, bool ForegroundInitialized, bool CollectorInitialized, string CollectorState);
public sealed record WsAccountProbeLease(string AccountId, long Generation, bool Collector, long Sequence);
public sealed record WsAccountMetric(string AccountId, string WorkspaceMode, string SavedSession, string ForegroundSavedSession, string CollectorSavedSession,
    string OnlineState, DateTimeOffset? LastOnlineProbeAt, bool ForegroundInitialized, bool CollectorInitialized, bool CollectorRunning);
public sealed record WsAccountMetricsSnapshot(DateTimeOffset GeneratedAt, int OnlineFreshnessSeconds, IReadOnlyList<WsAccountMetric> Accounts);

/// <summary>Local observations only; no network calls or WebView creation.</summary>
public sealed class WsAccountMetrics
{
    public const int OnlineFreshnessSeconds = 30;
    private sealed record Observation(long Generation, bool Online, DateTimeOffset At);
    private readonly object _gate = new();
    private readonly Dictionary<(string, bool), long> _versions = new();
    private readonly Dictionary<string, Observation> _online = new(StringComparer.OrdinalIgnoreCase);
    private long _sequence;
    private static (string, bool) Key(string id, bool collector) => (id.ToUpperInvariant(), collector);

    public WsAccountProbeLease BeginProbe(string id, long generation, bool collector)
    {
        lock (_gate) { var version = ++_sequence; _versions[Key(id, collector)] = version; return new(id, generation, collector, version); }
    }
    public bool IsCurrent(WsAccountProbeLease lease)
    {
        lock (_gate) return _versions.TryGetValue(Key(lease.AccountId, lease.Collector), out var current) && current == lease.Sequence;
    }
    public bool CompleteProbe(WsAccountProbeLease lease, bool online, DateTimeOffset at)
    {
        lock (_gate)
        {
            if (!IsCurrent(lease)) return false;
            if (!lease.Collector) _online[lease.AccountId] = new(lease.Generation, online, at);
            return true;
        }
    }
    public void Invalidate(string accountId, bool collector = false)
    {
        lock (_gate) { _versions[Key(accountId, collector)] = ++_sequence; if (!collector) _online.Remove(accountId); }
    }
    private static string Saved(StoredWsLoginObservation? evidence, long? profileStamp)
    {
        if (profileStamp == 0) return "none";
        if (profileStamp is null || evidence is null || profileStamp != evidence.ProfileCreatedUtcTicks) return "unknown";
        return evidence.SignedIn ? "confirmed" : "none";
    }
    public WsAccountMetricsSnapshot Snapshot(IReadOnlyList<StoredWsAccount> accounts, IReadOnlyList<WsAccountMetricRuntime> runtime,
        Func<string, bool, long?> profileStamp, DateTimeOffset now)
    {
        var sessions = runtime.ToDictionary(item => item.AccountId, StringComparer.OrdinalIgnoreCase);
        var metrics = new List<WsAccountMetric>();
        lock (_gate)
        foreach (var account in accounts)
        {
            sessions.TryGetValue(account.Id, out var session);
            var foreground = Saved(account.ForegroundLoginObservation, profileStamp(account.Id, false));
            var collector = Saved(account.CollectorLoginObservation, profileStamp(account.Id, true));
            var saved = foreground == "confirmed" || collector == "confirmed" ? "confirmed" : foreground == "none" && collector == "none" ? "none" : "unknown";
            var online = "not-observed";
            DateTimeOffset? observed = null;
            if (session?.ForegroundInitialized == true && _online.TryGetValue(account.Id, out var evidence) && evidence.Generation == session.Generation)
            {
                observed = evidence.At;
                var age = now - evidence.At;
                online = age < TimeSpan.Zero || age > TimeSpan.FromSeconds(OnlineFreshnessSeconds) ? "stale" : evidence.Online ? "recent" : "not-online";
            }
            metrics.Add(new(account.Id, account.WorkspaceMode, saved, foreground, collector, online, observed,
                session?.ForegroundInitialized == true, session?.CollectorInitialized == true, session?.CollectorInitialized == true && session.CollectorState == "running"));
        }
        return new(now, OnlineFreshnessSeconds, metrics);
    }
}
