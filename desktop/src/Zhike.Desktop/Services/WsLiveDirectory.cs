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
        return JsonSerializer.SerializeToElement(new { supported = true, accountId = purpose.AccountId, workspaceMode = purpose.WorkspaceMode,
            sessionGeneration = generation, collectorEpoch = epoch, source, collectorOnly = source == "collector",
            eventName = "live-directory", scanId = Number(packet, "scanId"), chunkIndex = Number(packet, "chunkIndex"),
            scanned = Flag(packet, "scanned"), scanning = Flag(packet, "scanning"), finished = Flag(packet, "finished"), complete = Flag(packet, "complete"),
            coverage = Text(packet, "coverage", 50), conversations = direct, groupConversations = groups });
    }
}
