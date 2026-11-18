using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Zhike.Desktop.Services;

/// <summary>
/// Wraps a complete workspace in a byte-stable integrity envelope. The web
/// restore screen verifies payloadJson before parsing it, avoiding a fragile
/// cross-runtime JSON canonicalization rule between .NET and JavaScript.
/// </summary>
internal static class NativeBackupEnvelope
{
    private const int MaxWorkspaceBytes = 95 * 1024 * 1024; // /api/state accepts 100 MB.
    private const int MaxWsAccountBytes = 48 * 1024 * 1024; // /api/ws/import accepts 50 MB.
    private const int MaxBackupBytes = 250 * 1024 * 1024; // Restore file picker cap.
    private static readonly (string Name, int Limit)[] WsRows =
    [
        ("settings", 5_000), ("conversations", 5_000), ("messages", 100_000),
        ("analyses", 20_000), ("replies", 20_000), ("batches", 20_000),
        ("collectionRuns", 5_000), ("collectionItems", 100_000), ("followupAlerts", 20_000),
    ];

    internal static void ValidateWorkspace(JsonObject state)
    {
        if (JsonSerializer.SerializeToUtf8Bytes(state).Length > MaxWorkspaceBytes)
            throw new InvalidDataException("当前客户数据超过可恢复上限，未生成无法恢复的自动备份。请先导出并归档旧记录。");
    }

    internal static void ValidateAccountIds(IEnumerable<string?>? accountIds)
    {
        var ids = accountIds?.ToArray();
        if (ids is null || ids.Length == 0 || ids.Any(string.IsNullOrWhiteSpace)
            || !ids.Contains("default", StringComparer.OrdinalIgnoreCase)
            || ids.Distinct(StringComparer.OrdinalIgnoreCase).Count() != ids.Length)
            throw new InvalidDataException("WS 账号清单读取失败或不完整，未生成不完整备份。请稍后重试。");
    }

    internal static void ValidateWsAccount(JsonNode? node)
    {
        if (node is not JsonObject value)
            throw new InvalidDataException("WS 会话导出格式异常，未生成不完整备份。请稍后重试。");
        foreach (var (name, limit) in WsRows)
        {
            if (value[name] is not JsonArray rows)
                throw new InvalidDataException("WS 会话导出缺少必要清单，未生成不完整备份。请稍后重试。");
            if (rows.Count > limit)
                throw new InvalidDataException("WS 历史记录超过当前恢复上限，未生成无法恢复的自动备份。请先导出并归档旧记录。");
        }
        if (JsonSerializer.SerializeToUtf8Bytes(value).Length > MaxWsAccountBytes)
            throw new InvalidDataException("WS 会话数据超过当前恢复上限，未生成无法恢复的自动备份。请先导出并归档旧记录。");
    }

    internal static byte[] Create(JsonObject state, JsonSerializerOptions options)
    {
        if (state["backupFormat"]?.ToString() != "zhike-6-workspace" || state["version"]?.ToString() != "6")
            throw new InvalidDataException("自动备份格式不正确，未写入文件。");
        var compact = new JsonSerializerOptions(options) { WriteIndented = false };
        var payloadJson = JsonSerializer.Serialize(state, compact);
        var payloadHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payloadJson))).ToLowerInvariant();
        var envelope = new JsonObject
        {
            ["backupFormat"] = "zhike-6-native-workspace",
            ["version"] = 6,
            ["payloadJson"] = payloadJson,
            ["integrity"] = new JsonObject
            {
                ["algorithm"] = "SHA-256",
                ["payloadSha256"] = payloadHash,
            },
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(envelope, compact);
        if (bytes.Length > MaxBackupBytes)
            throw new InvalidDataException("完整备份超过 250 MB 可恢复上限，未写入文件。");
        return bytes;
    }
}
