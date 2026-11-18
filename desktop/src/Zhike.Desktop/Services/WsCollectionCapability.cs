using System.Text.Json.Serialization;

namespace Zhike.Desktop.Services;

/// <summary>
/// RD02 is a code boundary, not an enableable production feature flag.
/// Foreground connectivity never grants a second authenticated collector.
/// </summary>
public sealed class WsCollectionCapability
{
    private WsCollectionCapability() { }
    public static WsCollectionCapability Current { get; } = new();
    public const string ErrorCode = "COLLECTION_CAPABILITY_BLOCKED";
    [JsonPropertyName("state")] public string State => "blocked";
    [JsonPropertyName("code")] public string Code => ErrorCode;
    [JsonPropertyName("reason")] public string Reason => "后台采集依赖复制认证状态，已按安全边界停用；前台聊天和手动导入可用。";
    [JsonPropertyName("backgroundCollection")] public bool BackgroundCollection => false;
    [JsonPropertyName("automaticHistory")] public bool AutomaticHistory => false;
    [JsonPropertyName("groupMonitoring")] public bool GroupMonitoring => false;
    [JsonPropertyName("foregroundFallback")] public bool ForegroundFallback => false;
    [JsonPropertyName("manualVisibleImport")] public bool ManualVisibleImport => true;

    public static InvalidOperationException Denied()
        => new($"{ErrorCode}: {Current.Reason}");

    public static bool BlocksAction(string action) => action is
        "discover-conversations" or "collect-all-read" or "configure-group-monitor"
        or "start-group-monitor" or "configure-ws-groups" or "configure-vip-groups";
}
