using System.Text.Json.Serialization;

namespace Zhike.Desktop.Services;

/// <summary>
/// Background collection uses a separately authenticated, account-scoped
/// WebView. Foreground login never grants collector authentication.
/// </summary>
public sealed class WsCollectionCapability
{
    private WsCollectionCapability() { }
    public static WsCollectionCapability Current { get; } = new();
    public const string ErrorCode = "COLLECTION_CAPABILITY_BLOCKED";
    [JsonPropertyName("state")] public string State => "available";
    [JsonPropertyName("code")] public string Code => "COLLECTION_INDEPENDENT_SESSION";
    [JsonPropertyName("provider")] public string Provider => "native-independent-session";
    [JsonPropertyName("protocolVersion")] public int ProtocolVersion => 1;
    [JsonPropertyName("reason")] public string Reason => "后台采集使用独立会话，请打开采集登录并单独扫码；前台聊天保持独立。";
    [JsonPropertyName("backgroundCollection")] public bool BackgroundCollection => true;
    [JsonPropertyName("automaticHistory")] public bool AutomaticHistory => true;
    [JsonPropertyName("groupMonitoring")] public bool GroupMonitoring => true;
    [JsonPropertyName("automaticAi")] public bool AutomaticAi => false;
    [JsonPropertyName("foregroundFallback")] public bool ForegroundFallback => false;
    [JsonPropertyName("manualVisibleImport")] public bool ManualVisibleImport => true;

    public static InvalidOperationException Denied()
        => new($"{ErrorCode}: 不支持复制认证会话，请使用独立采集登录。");

    public static bool BlocksAction(string action) => false;
}
