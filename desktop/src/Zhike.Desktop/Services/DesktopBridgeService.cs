using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed class DesktopBridgeService
{
    public const string CurrentVersion = "5.1";
    private readonly LegacyApiAdapter _legacyApi;

    public DesktopBridgeService(LegacyApiAdapter legacyApi) => _legacyApi = legacyApi;

    public event EventHandler<BridgeEvent>? EventPublished;

    public async Task<BridgeResponse> InvokeAsync(
        string requestId,
        string method,
        JsonElement payload,
        int timeoutMs = 15000,
        string? accountId = null,
        CancellationToken cancellationToken = default)
    {
        var id = string.IsNullOrWhiteSpace(requestId) ? Guid.NewGuid().ToString("N") : requestId;
        var timeout = Math.Clamp(timeoutMs, 250, 120000);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        try
        {
            if (string.Equals(method, "legacy.api", StringComparison.OrdinalIgnoreCase))
            {
                var path = payload.TryGetProperty("path", out var pathValue) ? pathValue.GetString() : null;
                var verb = payload.TryGetProperty("method", out var methodValue) ? methodValue.GetString() : "GET";
                var body = payload.TryGetProperty("body", out var bodyValue) ? bodyValue : (JsonElement?)null;
                if (string.IsNullOrWhiteSpace(path))
                    return BridgeResponse.Failure(id, CurrentVersion, "INVALID_REQUEST", "path is required");

                var result = await _legacyApi.SendAsync(id, path, new HttpMethod(verb ?? "GET"), body, timeoutCts.Token);
                return result.Ok
                    ? BridgeResponse.Success(id, CurrentVersion, result.Data, result.Message)
                    : BridgeResponse.Failure(id, CurrentVersion, result.ErrorCode, result.Message);
            }

            return BridgeResponse.Failure(id, CurrentVersion, "UNSUPPORTED", $"unsupported bridge method: {method}");
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            return BridgeResponse.Failure(id, CurrentVersion, "TIMEOUT", "desktop bridge request timed out");
        }
        catch (Exception)
        {
            // Intentionally redact exception text; it may contain URLs or credentials.
            return BridgeResponse.Failure(id, CurrentVersion, "BRIDGE_ERROR", "desktop bridge request failed");
        }
    }

    public void Publish(string eventName, JsonElement payload)
        => EventPublished?.Invoke(this, new BridgeEvent(eventName, payload.Clone(), DateTimeOffset.UtcNow));
}
