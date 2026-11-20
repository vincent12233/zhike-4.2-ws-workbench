using System.Text.RegularExpressions;

namespace Zhike.Desktop.Services;

/// <summary>Only a sidecar-confirmed account can authorize automatic collection.</summary>
public sealed record WsCollectorPurposePolicy(string AccountId, string WorkspaceMode, bool OpenUnreadGroups = false)
{
    public bool AllowsDirectHistory => WorkspaceMode == "ordinary";
    public bool AllowsGroupMonitoring => WorkspaceMode == "dedicated";
    public static WsCollectorPurposePolicy Confirm(WsAccountDto account, string accountId)
    {
        if (!string.Equals(account.Id, accountId, StringComparison.Ordinal)
            || account.WorkspaceMode is not ("ordinary" or "dedicated"))
            throw new InvalidDataException("WS_COLLECTOR_PURPOSE_UNCONFIRMED: 本机服务未确认当前账号用途。");
        return new(accountId, account.WorkspaceMode, account.OpenUnreadGroups);
    }
    public static bool IsGroupJid(string? value)
        => value is not null && Regex.IsMatch(value, "^[a-z0-9._-]+@g\\.us$", RegexOptions.CultureInvariant);
    // There is no VIP group. "vip_group" is only a legacy spelling of an
    // ordinary group and is read as one; it grants nothing extra.
    public static bool IsGroupType(string? type) => type is "group" or "vip_group";
    public bool AllowsHistory(string? key, string? type, bool? isGroup = false)
        => AllowsDirectHistory && type == "direct" && isGroup != true
            && !string.IsNullOrWhiteSpace(key) && !key.Contains("@g.us", StringComparison.OrdinalIgnoreCase);
    public bool AllowsCheckpoint(WsCheckpointDto row)
        => row.AccountId == AccountId && (AllowsHistory(row.ConversationKey, row.ConversationType, row.IsGroup)
            // Directory observations are harmless in either workspace; they
            // must never claim group full-history progress.
            || IsGroupJid(row.ConversationKey) && row.IsGroup != false && IsGroupType(row.ConversationType)
                && !row.HistoryLoaded && row.HistoryMessageCount == 0 && !row.Coverage.StartsWith("read-history", StringComparison.OrdinalIgnoreCase));
    public bool AllowsMessage(WsMessageEnvelopeDto row, IEnumerable<WsCollectorMonitorPolicy>? monitors = null)
        => row.AccountId == AccountId && (AllowsHistory(row.ConversationKey, row.ConversationType, false)
            || AllowsGroupMonitoring && IsGroupJid(row.ConversationKey) && IsGroupType(row.ConversationType)
                && !row.PreviewOnly && row.Direction is "incoming" or "receive" && row.SenderIdentityTrusted
                && row.SenderIdentitySource is "sender-jid" or "sender-phone"
                && (Regex.IsMatch(row.SenderId, "^[a-zA-Z0-9._:-]+@(s\\.whatsapp\\.net|c\\.us|lid)$", RegexOptions.CultureInvariant)
                    || Regex.IsMatch(row.SenderPhone, "^[0-9]{8,15}$", RegexOptions.CultureInvariant))
                && (monitors?.Any(monitor => monitor.AccountId == AccountId && monitor.AllowsGroup(row.ConversationKey)) ?? false));
}

public sealed record WsCollectorMonitorTarget(string TargetId, string GroupJid, string GroupName, string SourceId, bool Enabled);
public sealed record WsCollectorMonitorPolicy(string AccountId, string ProfileId, bool Enabled, int IntervalSec, IReadOnlyList<WsCollectorMonitorTarget> Targets)
{
    public bool AllowsGroup(string groupJid)
        => Enabled && WsCollectorPurposePolicy.IsGroupJid(groupJid)
            && Targets.Any(target => target.Enabled && target.GroupJid == groupJid);
    public bool AllowsEvent(WsGroupMembershipEventDto item)
        => Enabled && item.AccountId == AccountId && item.ProfileId == ProfileId
            && WsCollectorPurposePolicy.IsGroupJid(item.GroupJid)
            && Targets.Any(target => target.Enabled && target.TargetId == item.TargetId && target.GroupJid == item.GroupJid);
}
