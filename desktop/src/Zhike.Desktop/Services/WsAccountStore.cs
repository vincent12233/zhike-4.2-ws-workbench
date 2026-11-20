using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record StoredWsLoginObservation(DateTimeOffset ObservedAt, long ProfileCreatedUtcTicks, bool SignedIn);
public sealed record StoredWsDirectoryDiagnostics(DateTimeOffset ObservedAt, string Source, string WorkspaceMode,
    bool ListPresent, int RenderedRows, int StableRows, int UnresolvedRows, bool ConfirmedOpen,
    int? SkippedUnread = null, int? SkippedReadUnknown = null, int? SkippedTypeUnknown = null, string? OpenIdentityStatus = null,
    string? GroupFilterStatus = null, string? MenuProbeStatus = null, int? GroupNoticeRows = null, int? VerifiedNoticeRows = null,
    int? NoticeAdjacentSvgRows = null, int? NoticeUnlabelledSvgRows = null);
public sealed record StoredWsAccount(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen = null, string? LastKnownStatus = null, string WorkspaceMode = "ordinary",
    StoredWsLoginObservation? ForegroundLoginObservation = null, StoredWsLoginObservation? CollectorLoginObservation = null,
    bool DirectoryPurposeConfirmed = false, StoredWsDirectoryDiagnostics? ForegroundDirectoryDiagnostics = null,
    StoredWsDirectoryDiagnostics? CollectorDirectoryDiagnostics = null, bool OpenUnreadGroups = false);

/// <summary>
/// Small local account index used before/without the API.  It stores only
/// display metadata and profile ids; WebView2 owns the actual session data in
/// its account-scoped profile directory.
/// </summary>
public sealed class WsAccountStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _options = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private sealed record PendingProbe(StoredWsDirectoryDiagnostics Sample, Func<bool> IsCurrent);
    private sealed class ProbeSlot
    {
        public PendingProbe? Latest;
        public Task? Writer;
        public long LastAttemptTicks;
    }
    private readonly Dictionary<(string Account, string Source), ProbeSlot> _probes = new();
    private readonly TimeSpan _probeInterval;

    public WsAccountStore(string? root = null) : this(root, TimeSpan.FromSeconds(10)) { }

    internal WsAccountStore(string? root, TimeSpan probeInterval)
    {
        _probeInterval = probeInterval;
        var basePath = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "ws-accounts");
#if STAGE51_ISOLATED_UI
        basePath = Stage51Isolation.MapDataPath(basePath);
#endif
        Directory.CreateDirectory(basePath);
        _path = Path.Combine(basePath, "accounts.json");
    }

    public Task RecordDirectoryDiagnosticsAsync(string accountId, string workspaceMode, string source, JsonElement packet,
        DateTimeOffset observedAt, Func<bool> isCurrent)
    {
        if (source is not ("foreground-visible" or "collector") || workspaceMode is not ("ordinary" or "dedicated")
            || packet.ValueKind != JsonValueKind.Object || !packet.TryGetProperty("directoryDiagnostics", out var data)
            || data.ValueKind != JsonValueKind.Object || !Flag("listPresent", out var present) || !Flag("confirmedOpen", out var open)
            || !Count("renderedRows", out var rendered) || !Count("stableRows", out var stable) || !Count("unresolvedRows", out var unresolved)
            || !isCurrent()) return Task.CompletedTask;
        bool Flag(string key, out bool flag)
        {
            flag = false;
            if (!data.TryGetProperty(key, out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
            flag = value.GetBoolean();
            return true;
        }
        bool Count(string key, out int count)
        {
            count = 0;
            return data.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out count) && count is >= 0 and <= 1_000_000;
        }
        int? OptionalCount(string key) => Count(key, out var count) ? count : null;
        var openStatus = packet.TryGetProperty("openIdentityStatus", out var status) && status.ValueKind == JsonValueKind.String
            ? status.GetString() : null;
        if (openStatus is not ("verified" or "no-open-chat" or "insufficient-message-identities" or "no-message-envelopes" or "unsupported-message-envelope"
            or "unconfirmed-message-position" or "single-message-owner" or "awaiting-owner-confirmation" or "conflicting-identities"
            or "workspace-type-mismatch" or "source-unavailable")) openStatus = null;
        string? ProbeStatus(string key) => source == "collector" && data.TryGetProperty(key, out var value)
            && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        var filter = ProbeStatus("groupFilterStatus");
        var menu = ProbeStatus("menuProbeStatus");
        if (filter is not ("not-checked" or "not-offered" or "ambiguous" or "selecting" or "selected" or "selection-unconfirmed")) filter = null;
        if (menu is not ("verified-group" or "verified-read-group" or "unread" or "read-state-unknown" or "type-unconfirmed" or "menu-unavailable" or "menu-unowned" or "row-changed" or "navigation-busy")) menu = null;
        // No raw WebView payload, title, identifiers or message text cross this boundary.
        var sample = new StoredWsDirectoryDiagnostics(observedAt, source, workspaceMode, present, rendered, stable, unresolved, open,
            OptionalCount("skippedUnread"), OptionalCount("skippedReadUnknown"), OptionalCount("skippedTypeUnknown"), openStatus, filter, menu, OptionalCount("groupNoticeRows"), OptionalCount("verifiedNoticeRows"),
            OptionalCount("noticeAdjacentSvgRows"), OptionalCount("noticeUnlabelledSvgRows"));
        lock (_probes)
        {
            var key = (accountId, source);
            if (!_probes.TryGetValue(key, out var slot)) _probes[key] = slot = new ProbeSlot();
            if (slot.Latest is null || slot.Latest.Sample.ObservedAt < observedAt) slot.Latest = new(sample, isCurrent);
            return slot.Writer ??= DrainDirectoryProbesAsync(accountId, slot);
        }
    }

    private async Task DrainDirectoryProbesAsync(string accountId, ProbeSlot slot)
    {
        // Preserve the caller's dispatcher for lease checks and return before doing file I/O.
        await Task.Yield();
        while (true)
        {
            TimeSpan delay;
            lock (_probes)
            {
                if (slot.Latest is null) { slot.Writer = null; return; }
                delay = slot.LastAttemptTicks == 0 ? TimeSpan.Zero :
                    _probeInterval - System.Diagnostics.Stopwatch.GetElapsedTime(slot.LastAttemptTicks);
            }
            if (delay > TimeSpan.Zero) await Task.Delay(delay);
            PendingProbe pending;
            lock (_probes)
            {
                pending = slot.Latest!;
                slot.Latest = null;
                slot.LastAttemptTicks = System.Diagnostics.Stopwatch.GetTimestamp();
            }
            await _gate.WaitAsync();
            try
            {
                if (!pending.IsCurrent()) continue;
                var rows = (await ReadAsync(default)).ToArray();
                var index = Array.FindIndex(rows, row => row is not null && row.Id == accountId && row.DirectoryPurposeConfirmed && row.WorkspaceMode == pending.Sample.WorkspaceMode);
                if (index < 0 || !pending.IsCurrent()) continue;
                var account = rows[index];
                var sample = pending.Sample;
                var collector = sample.Source == "collector";
                var previous = collector ? account.CollectorDirectoryDiagnostics : account.ForegroundDirectoryDiagnostics;
                if (previous is not null && (sample.ObservedAt <= previous.ObservedAt ||
                    sample.ObservedAt - previous.ObservedAt < TimeSpan.FromMinutes(1) && (sample with { ObservedAt = previous.ObservedAt }) == previous)) continue;
                rows[index] = collector ? account with { CollectorDirectoryDiagnostics = sample } : account with { ForegroundDirectoryDiagnostics = sample };
                await WriteAsync(rows, default, pending.IsCurrent);
            }
            // A diagnostic must never replace an unreadable index or break live discovery.
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or System.Runtime.InteropServices.COMException) { }
            finally { _gate.Release(); }
        }
    }

    public async Task<IReadOnlyList<StoredWsAccount>> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await ReadAsync(cancellationToken);
        }
        catch (JsonException)
        {
            // Keep a corrupt file for diagnostics rather than deleting a
            // user's account index or profile data.
            return [];
        }
        finally { _gate.Release(); }
    }

    public async Task SaveAsync(IEnumerable<StoredWsAccount> accounts, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { await WriteAsync(Normalize(accounts), cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<StoredWsAccount>> UpdateAsync(
        Func<IReadOnlyList<StoredWsAccount>, IEnumerable<StoredWsAccount>> change,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            // Keep read, mutation, and atomic replacement within the same gate.
            // Invalid JSON propagates instead of replacing the unreadable index.
            var current = await ReadAsync(cancellationToken);
            var updated = Normalize(change(current));
            if (!current.SequenceEqual(updated)) await WriteAsync(updated, cancellationToken);
            return updated;
        }
        finally { _gate.Release(); }
    }

    private async Task<IReadOnlyList<StoredWsAccount>> ReadAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return [];
        await using var stream = File.OpenRead(_path);
        return await JsonSerializer.DeserializeAsync<List<StoredWsAccount>>(stream, _options, cancellationToken) ?? [];
    }

    private static StoredWsAccount[] Normalize(IEnumerable<StoredWsAccount> accounts) => accounts
        .Where(item => !string.IsNullOrWhiteSpace(item.Id))
        .GroupBy(item => item.Id.Trim(), StringComparer.OrdinalIgnoreCase)
        .Select(group => group.Last() with { Id = group.Key })
        .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private async Task WriteAsync(StoredWsAccount[] accounts, CancellationToken cancellationToken, Func<bool>? stillCurrent = null)
    {
        var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(accounts, _options), cancellationToken);
            if (stillCurrent?.Invoke() != false) File.Move(temporary, _path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
