namespace Zhike.Desktop.Services;

/// <summary>
/// Stable collection rules for personal WhatsApp Web.  The policy belongs to
/// the process runtime rather than a page, so changing routes cannot weaken
/// unread protection, VIP-group isolation or direction verification.
/// </summary>
public sealed record WsCollectionPolicy(
    bool SkipUnread,
    bool SkipUncertainUnread,
    bool CaptureVipGroups,
    bool ExcludeUnlistedGroups,
    bool RequireTrustedGroupSenderIdentity,
    bool ExcludeUnknownConversationTypes,
    bool CaptureIncoming,
    bool CaptureOutgoing,
    bool RequireVerifiedDirection,
    bool RequireHistoryTopEvidence)
{
    public static WsCollectionPolicy PersonalWhatsAppDefault { get; } = new(
        SkipUnread: true,
        SkipUncertainUnread: true,
        CaptureVipGroups: true,
        ExcludeUnlistedGroups: true,
        RequireTrustedGroupSenderIdentity: true,
        ExcludeUnknownConversationTypes: true,
        CaptureIncoming: true,
        CaptureOutgoing: true,
        RequireVerifiedDirection: true,
        RequireHistoryTopEvidence: true);
}

public enum WsAccountRuntimeState
{
    Registered,
    WaitingLogin,
    Connecting,
    Connected,
    Collecting,
    Paused,
    RetryScheduled,
    SessionExpired,
    Failed,
}

public sealed record WsAccountRuntimeSnapshot(
    string AccountId,
    string DisplayName,
    WsAccountRuntimeState State,
    bool Enabled,
    bool IsForeground,
    bool IsBackgroundLease,
    DateTimeOffset? LastHeartbeatAt,
    DateTimeOffset? LastBackgroundLeaseAt,
    DateTimeOffset? NextRetryAt,
    int ConsecutiveFailures,
    string LastError);

public sealed record WsRuntimeSnapshot(
    string? ForegroundAccountId,
    string? BackgroundAccountId,
    WsCollectionPolicy Policy,
    IReadOnlyList<WsAccountRuntimeSnapshot> Accounts);

/// <summary>
/// Process-owned scheduler for the 6.0 WS runtime.
///
/// It intentionally owns no XAML control.  A future WebView pool binds to its
/// leases, while the foreground page binds only to ForegroundAccountId.  This
/// keeps account rotation, retry/backoff and collection safety alive when a
/// page is hidden or rebuilt without letting a background worker steal the
/// user's visible account.
/// </summary>
public sealed class WsRuntimeCoordinator
{
    private sealed class AccountRuntime
    {
        public required string AccountId { get; init; }
        public required string DisplayName { get; set; }
        public WsAccountRuntimeState State { get; set; }
        public bool Enabled { get; set; } = true;
        public DateTimeOffset? LastHeartbeatAt { get; set; }
        public DateTimeOffset? LastBackgroundLeaseAt { get; set; }
        public DateTimeOffset? NextRetryAt { get; set; }
        public int ConsecutiveFailures { get; set; }
        public string LastError { get; set; } = string.Empty;
    }

    private readonly object _sync = new();
    private readonly Dictionary<string, AccountRuntime> _accounts = new(StringComparer.OrdinalIgnoreCase);
    private readonly TimeSpan _leaseDuration;
    private readonly TimeSpan _minimumRetryDelay;
    private readonly TimeSpan _maximumRetryDelay;
    private string? _foregroundAccountId;
    private string? _backgroundAccountId;

    public WsRuntimeCoordinator(
        WsCollectionPolicy? policy = null,
        TimeSpan? leaseDuration = null,
        TimeSpan? minimumRetryDelay = null,
        TimeSpan? maximumRetryDelay = null)
    {
        Policy = policy ?? WsCollectionPolicy.PersonalWhatsAppDefault;
        _leaseDuration = leaseDuration ?? TimeSpan.FromSeconds(45);
        _minimumRetryDelay = minimumRetryDelay ?? TimeSpan.FromSeconds(5);
        _maximumRetryDelay = maximumRetryDelay ?? TimeSpan.FromMinutes(5);
        if (_leaseDuration <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(leaseDuration));
        if (_minimumRetryDelay <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(minimumRetryDelay));
        if (_maximumRetryDelay < _minimumRetryDelay) throw new ArgumentOutOfRangeException(nameof(maximumRetryDelay));
    }

    public WsCollectionPolicy Policy { get; }

    public event EventHandler<WsRuntimeSnapshot>? StateChanged;

    public void RegisterAccounts(IEnumerable<StoredWsAccount> accounts)
    {
        ArgumentNullException.ThrowIfNull(accounts);
        lock (_sync)
        {
            foreach (var account in accounts)
                RegisterAccountCore(account.Id, account.DisplayName, FromDisplayStatus(account.Status));
        }
        PublishChanged();
    }

    public void RegisterAccount(string accountId, string displayName, WsAccountRuntimeState state = WsAccountRuntimeState.Registered)
    {
        ValidateAccountId(accountId);
        lock (_sync) RegisterAccountCore(accountId, displayName, state);
        PublishChanged();
    }

    public bool RemoveAccount(string accountId)
    {
        ValidateAccountId(accountId);
        bool removed;
        lock (_sync)
        {
            removed = _accounts.Remove(accountId);
            if (string.Equals(_foregroundAccountId, accountId, StringComparison.OrdinalIgnoreCase)) _foregroundAccountId = null;
            if (string.Equals(_backgroundAccountId, accountId, StringComparison.OrdinalIgnoreCase)) _backgroundAccountId = null;
        }
        if (removed) PublishChanged();
        return removed;
    }

    public void SetForegroundAccount(string? accountId)
    {
        lock (_sync)
        {
            if (!string.IsNullOrWhiteSpace(accountId) && !_accounts.ContainsKey(accountId))
                throw new KeyNotFoundException($"WS account is not registered: {accountId}");
            _foregroundAccountId = string.IsNullOrWhiteSpace(accountId) ? null : accountId;
            // Never let the hidden collector mutate the conversation that the
            // user is currently reading or typing in.
            if (string.Equals(_backgroundAccountId, _foregroundAccountId, StringComparison.OrdinalIgnoreCase))
            {
                if (_backgroundAccountId is not null && _accounts.TryGetValue(_backgroundAccountId, out var previous) && previous.State == WsAccountRuntimeState.Collecting)
                    previous.State = WsAccountRuntimeState.Connected;
                _backgroundAccountId = null;
            }
        }
        PublishChanged();
    }

    public void SetAccountEnabled(string accountId, bool enabled)
    {
        lock (_sync)
        {
            var account = RequiredAccount(accountId);
            account.Enabled = enabled;
            if (!enabled && string.Equals(_backgroundAccountId, accountId, StringComparison.OrdinalIgnoreCase)) _backgroundAccountId = null;
        }
        PublishChanged();
    }

    public void UpdateConnectionState(string accountId, WsAccountRuntimeState state, DateTimeOffset? observedAt = null)
    {
        lock (_sync)
        {
            var account = RequiredAccount(accountId);
            account.State = state;
            account.LastHeartbeatAt = observedAt ?? DateTimeOffset.UtcNow;
            if (state is WsAccountRuntimeState.Connected or WsAccountRuntimeState.Collecting)
            {
                account.ConsecutiveFailures = 0;
                account.NextRetryAt = null;
                account.LastError = string.Empty;
            }
            if (state is WsAccountRuntimeState.WaitingLogin or WsAccountRuntimeState.SessionExpired or WsAccountRuntimeState.Failed
                && string.Equals(_backgroundAccountId, accountId, StringComparison.OrdinalIgnoreCase))
                _backgroundAccountId = null;
        }
        PublishChanged();
    }

    public void RecordHeartbeat(string accountId, DateTimeOffset? observedAt = null)
    {
        lock (_sync) RequiredAccount(accountId).LastHeartbeatAt = observedAt ?? DateTimeOffset.UtcNow;
        PublishChanged();
    }

    public DateTimeOffset RecordFailure(string accountId, string? error, DateTimeOffset? observedAt = null)
    {
        DateTimeOffset retryAt;
        lock (_sync)
        {
            var account = RequiredAccount(accountId);
            var now = observedAt ?? DateTimeOffset.UtcNow;
            account.ConsecutiveFailures = Math.Min(account.ConsecutiveFailures + 1, 30);
            var multiplier = Math.Pow(2d, Math.Min(account.ConsecutiveFailures - 1, 12));
            var delayMs = Math.Min(_maximumRetryDelay.TotalMilliseconds, _minimumRetryDelay.TotalMilliseconds * multiplier);
            retryAt = now.AddMilliseconds(delayMs);
            account.NextRetryAt = retryAt;
            account.LastHeartbeatAt = now;
            account.LastError = NormalizeError(error);
            account.State = WsAccountRuntimeState.RetryScheduled;
            if (string.Equals(_backgroundAccountId, accountId, StringComparison.OrdinalIgnoreCase)) _backgroundAccountId = null;
        }
        PublishChanged();
        return retryAt;
    }

    public string? LeaseNextBackgroundAccount(DateTimeOffset? observedAt = null)
    {
        string? result;
        lock (_sync)
        {
            var now = observedAt ?? DateTimeOffset.UtcNow;
            if (_backgroundAccountId is not null && _accounts.TryGetValue(_backgroundAccountId, out var current)
                && IsEligible(current, now) && !string.Equals(current.AccountId, _foregroundAccountId, StringComparison.OrdinalIgnoreCase)
                && current.LastBackgroundLeaseAt is not null && now - current.LastBackgroundLeaseAt < _leaseDuration)
                return current.AccountId;

            if (_backgroundAccountId is not null && _accounts.TryGetValue(_backgroundAccountId, out var expired) && expired.State == WsAccountRuntimeState.Collecting)
                expired.State = WsAccountRuntimeState.Connected;
            _backgroundAccountId = null;

            var next = _accounts.Values
                .Where(item => !string.Equals(item.AccountId, _foregroundAccountId, StringComparison.OrdinalIgnoreCase) && IsEligible(item, now))
                .OrderBy(item => item.LastBackgroundLeaseAt.HasValue)
                .ThenBy(item => item.LastBackgroundLeaseAt)
                .ThenBy(item => item.AccountId, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (next is null) return null;
            next.LastBackgroundLeaseAt = now;
            next.State = WsAccountRuntimeState.Collecting;
            _backgroundAccountId = next.AccountId;
            result = next.AccountId;
        }
        PublishChanged();
        return result;
    }

    public void ReleaseBackgroundLease(string accountId, bool succeeded, string? error = null, DateTimeOffset? observedAt = null)
    {
        if (!succeeded)
        {
            RecordFailure(accountId, error, observedAt);
            return;
        }
        lock (_sync)
        {
            var account = RequiredAccount(accountId);
            account.State = WsAccountRuntimeState.Connected;
            account.LastHeartbeatAt = observedAt ?? DateTimeOffset.UtcNow;
            account.ConsecutiveFailures = 0;
            account.NextRetryAt = null;
            account.LastError = string.Empty;
            if (string.Equals(_backgroundAccountId, accountId, StringComparison.OrdinalIgnoreCase)) _backgroundAccountId = null;
        }
        PublishChanged();
    }

    public WsRuntimeSnapshot Snapshot()
    {
        lock (_sync) return SnapshotCore();
    }

    private void RegisterAccountCore(string accountId, string displayName, WsAccountRuntimeState state)
    {
        ValidateAccountId(accountId);
        var normalizedId = accountId.Trim();
        var normalizedName = string.IsNullOrWhiteSpace(displayName) ? normalizedId : displayName.Trim();
        if (_accounts.TryGetValue(normalizedId, out var existing))
        {
            if (!string.Equals(normalizedName, normalizedId, StringComparison.OrdinalIgnoreCase)
                || string.Equals(existing.DisplayName, existing.AccountId, StringComparison.OrdinalIgnoreCase))
                existing.DisplayName = normalizedName;
            if (existing.State == WsAccountRuntimeState.Registered) existing.State = state;
            return;
        }
        _accounts[normalizedId] = new AccountRuntime { AccountId = normalizedId, DisplayName = normalizedName, State = state };
    }

    private AccountRuntime RequiredAccount(string accountId)
    {
        ValidateAccountId(accountId);
        return _accounts.TryGetValue(accountId.Trim(), out var account)
            ? account
            : throw new KeyNotFoundException($"WS account is not registered: {accountId}");
    }

    private static bool IsEligible(AccountRuntime account, DateTimeOffset now)
        => account.Enabled
            // A freshly restored 6.0 account index starts as Registered until
            // its isolated WebView profile is probed. Lease it once so a valid
            // persisted WhatsApp login can resume collection after restart;
            // WaitingLogin/SessionExpired remain user-driven and are not spun
            // in a hidden retry loop.
            && account.State is WsAccountRuntimeState.Registered or WsAccountRuntimeState.Connected or WsAccountRuntimeState.Collecting or WsAccountRuntimeState.Paused or WsAccountRuntimeState.RetryScheduled
            && (account.NextRetryAt is null || account.NextRetryAt <= now);

    private WsRuntimeSnapshot SnapshotCore()
    {
        var rows = _accounts.Values
            .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.AccountId, StringComparer.OrdinalIgnoreCase)
            .Select(item => new WsAccountRuntimeSnapshot(
                item.AccountId,
                item.DisplayName,
                item.State,
                item.Enabled,
                string.Equals(_foregroundAccountId, item.AccountId, StringComparison.OrdinalIgnoreCase),
                string.Equals(_backgroundAccountId, item.AccountId, StringComparison.OrdinalIgnoreCase),
                item.LastHeartbeatAt,
                item.LastBackgroundLeaseAt,
                item.NextRetryAt,
                item.ConsecutiveFailures,
                item.LastError))
            .ToArray();
        return new WsRuntimeSnapshot(_foregroundAccountId, _backgroundAccountId, Policy, rows);
    }

    private void PublishChanged()
    {
        var handler = StateChanged;
        if (handler is null) return;
        handler(this, Snapshot());
    }

    private static string NormalizeError(string? error)
    {
        var normalized = string.Join(' ', (error ?? string.Empty).Split(new[] { '\r', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries));
        return normalized.Length <= 240 ? normalized : normalized[..240];
    }

    public static WsAccountRuntimeState FromDisplayStatus(string? state)
        => state?.Trim() switch
        {
            "等待登录" => WsAccountRuntimeState.WaitingLogin,
            "登录中" or "连接中" or "正在重连" => WsAccountRuntimeState.Connecting,
            "已连接" => WsAccountRuntimeState.Connected,
            "采集中" => WsAccountRuntimeState.Collecting,
            "已暂停" => WsAccountRuntimeState.Paused,
            "会话过期" => WsAccountRuntimeState.SessionExpired,
            "连接失败" => WsAccountRuntimeState.Failed,
            _ => WsAccountRuntimeState.Registered,
        };

    private static void ValidateAccountId(string? accountId)
    {
        if (string.IsNullOrWhiteSpace(accountId)) throw new ArgumentException("WS account id is required.", nameof(accountId));
        if (accountId.Length > 160) throw new ArgumentOutOfRangeException(nameof(accountId));
    }
}
