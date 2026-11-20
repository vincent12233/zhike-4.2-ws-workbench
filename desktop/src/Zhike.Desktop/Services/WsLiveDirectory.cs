using System.Text.Json;

namespace Zhike.Desktop.Services;

public static class WsLiveDirectory
{
    private static string Text(JsonElement row, string field, int limit)
        => row.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { } text
            ? text[..Math.Min(text.Length, limit)].Trim() : "";

    private static int Number(JsonElement row, string field)
        => row.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n) ? Math.Max(0, n) : 0;

    private static bool Flag(JsonElement row, string field)
        => row.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.True;

    public static JsonElement Project(JsonElement packet, WsCollectorPurposePolicy purpose, long generation, long epoch, string source)
    {
        var direct = new List<object>();
        var groups = new List<object>();
        var contacts = new List<object>();
        var dedicated = purpose.AllowsGroupMonitoring;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!packet.TryGetProperty("rows", out var rows))
            packet.TryGetProperty(dedicated ? "groupConversations" : "conversations", out rows);
        if (rows.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in rows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object || seen.Count >= 1000) continue;
                var key = Text(row, "conversationKey", 200);
                var type = Text(row, "conversationType", 20);
                if (key.Length == 0 || (dedicated
                    ? !WsCollectorPurposePolicy.IsGroupJid(key) || type is not ("group" or "vip_group")
                    : !purpose.AllowsHistory(key, type, Flag(row, "isGroup"), Flag(row, "vipGroup"))) || !seen.Add(key)) continue;
                var title = Text(row, "displayName", 150);
                if (title.Length == 0) title = Text(row, "title", 150);
                if (dedicated)
                    groups.Add(new { conversationKey = key, externalId = key, groupJid = key, displayName = title, title, isGroup = true, conversationType = "group" });
                else
                    direct.Add(new { conversationKey = key, externalId = key, displayName = title, title, isGroup = false, conversationType = "direct",
                        previewText = Text(row, "previewText", 240), lastMessageAt = Text(row, "lastMessageAt", 80),
                        unreadCount = Number(row, "unreadCount"), unread = Flag(row, "unread"), uncertainUnread = Flag(row, "uncertainUnread"),
                        lastMessageFingerprint = Text(row, "lastMessageFingerprint", 240), visibleOnly = true, previewOnly = true });
            }
        }
        var contactsVisible = source == "foreground-visible" && purpose.AllowsDirectHistory && Flag(packet, "contactsVisible");
        if (contactsVisible && packet.TryGetProperty("contacts", out var contactRows) && contactRows.ValueKind == JsonValueKind.Array)
        {
            var seenContacts = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in contactRows.EnumerateArray())
            {
                if (contacts.Count >= 1000) break;
                if (row.ValueKind != JsonValueKind.Object) continue;
                var id = Text(row, "contactId", 100).ToLowerInvariant();
                if (System.Text.RegularExpressions.Regex.IsMatch(id, @"^\d{1,20}@(c\.us|s\.whatsapp\.net|lid)$") && seenContacts.Add(id))
                    contacts.Add(new { contactId = id, displayName = Text(row, "displayName", 150) });
            }
        }
        object? activeGroup = null, directoryDiagnostics = null;
        var openIdentityStatus = Text(packet, "openIdentityStatus", 40);
        if (openIdentityStatus is not ("verified" or "no-open-chat" or "insufficient-message-identities" or "conflicting-identities" or "workspace-type-mismatch"))
            openIdentityStatus = "source-unavailable";
        if (source == "foreground-visible" && dedicated && openIdentityStatus == "verified" && packet.TryGetProperty("activeGroup", out var active) && active.ValueKind == JsonValueKind.Object)
        {
            var jid = Text(active, "groupJid", 200);
            if (WsCollectorPurposePolicy.IsGroupJid(jid) && seen.Contains(jid)) activeGroup = new { groupJid = jid, displayName = Text(active, "displayName", 150) };
        }
        if (packet.TryGetProperty("directoryDiagnostics", out var diag) && diag.ValueKind == JsonValueKind.Object)
            directoryDiagnostics = new { listPresent = Flag(diag, "listPresent"), renderedRows = Number(diag, "renderedRows"),
                stableRows = Number(diag, "stableRows"), unresolvedRows = Number(diag, "unresolvedRows"), confirmedOpen = Flag(diag, "confirmedOpen"),
                skippedUnread = Number(diag, "skippedUnread"), skippedReadUnknown = Number(diag, "skippedReadUnknown"), skippedTypeUnknown = Number(diag, "skippedTypeUnknown"),
                groupNoticeRows = Number(diag, "groupNoticeRows"), verifiedNoticeRows = Number(diag, "verifiedNoticeRows"),
                groupFilterStatus = Text(diag, "groupFilterStatus", 24), menuProbeStatus = Text(diag, "menuProbeStatus", 24) };
        return JsonSerializer.SerializeToElement(new { supported = true, accountId = purpose.AccountId, workspaceMode = purpose.WorkspaceMode, activeGroup, openIdentityStatus, directoryDiagnostics,
            sessionGeneration = generation, collectorEpoch = epoch, source, collectorOnly = source == "collector",
            eventName = "live-directory", scanId = Number(packet, "scanId"), chunkIndex = Number(packet, "chunkIndex"),
            scanned = Flag(packet, "scanned"), scanning = Flag(packet, "scanning"), finished = Flag(packet, "finished"), complete = Flag(packet, "complete"),
            coverage = Text(packet, "coverage", 50), conversations = direct, groupConversations = groups,
            unresolvedRowCount = Number(packet, "unresolvedRowCount"), conversationListVisible = Flag(packet, "conversationListVisible"), contactsVisible, contacts,
            unresolvedContactCount = contactsVisible ? Number(packet, "unresolvedContactCount") : 0 });
    }
}
