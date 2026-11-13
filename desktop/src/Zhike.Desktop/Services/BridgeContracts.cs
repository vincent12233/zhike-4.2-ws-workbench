using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record BridgeResponse(
    bool Ok,
    string ErrorCode,
    string Message,
    JsonElement? Data,
    string RequestId,
    string BridgeVersion)
{
    public static BridgeResponse Success(string requestId, string version, JsonElement? data = null, string message = "ok")
        => new(true, string.Empty, message, data, requestId, version);

    public static BridgeResponse Failure(string requestId, string version, string errorCode, string message)
        => new(false, errorCode, message, null, requestId, version);
}

public sealed record BridgeEvent(string Name, JsonElement Payload, DateTimeOffset PublishedAt);

public sealed record LegacyApiResponse(
    bool Ok,
    string ErrorCode,
    string Message,
    JsonElement? Data,
    string RequestId);

public sealed record RawApiResponse(
    bool Ok,
    int StatusCode,
    string Message,
    JsonElement? Data);
