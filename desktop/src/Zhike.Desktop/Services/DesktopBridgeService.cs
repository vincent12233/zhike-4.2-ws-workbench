using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed class DesktopBridgeService
{
    // This is the production bridge contract shipped with Zhike 6.0.  The
    // renderer and native host are bundled together, so accepting an older
    // protocol would hide a mixed-resource installation instead of providing
    // useful compatibility.
    public const string CurrentVersion = "6.0";
    private const int MaxPayloadChars = 48 * 1024 * 1024;
    private readonly LegacyApiAdapter? _legacyApi;
    private readonly string _storageError;

    public DesktopBridgeService(LegacyApiAdapter? legacyApi, string storageError = "")
        => (_legacyApi, _storageError) = (legacyApi, storageError);

    public event EventHandler<BridgeEvent>? EventPublished;

    public async Task<BridgeResponse> InvokeAsync(
        string requestId,
        string method,
        JsonElement payload,
        int timeoutMs = 15000,
        string? accountId = null,
        CancellationToken cancellationToken = default,
        string? bridgeVersion = null)
    {
        var id = string.IsNullOrWhiteSpace(requestId) ? Guid.NewGuid().ToString("N") : requestId;
        if (!string.Equals(bridgeVersion, CurrentVersion, StringComparison.Ordinal))
            return BridgeResponse.Failure(id, CurrentVersion, "UNSUPPORTED_VERSION", "desktop bridge version is not supported");
        if (id.Length > 128 || string.IsNullOrWhiteSpace(method) || method.Length > 128)
            return BridgeResponse.Failure(id, CurrentVersion, "INVALID_REQUEST", "bridge request is invalid");
        if (payload.GetRawText().Length > MaxPayloadChars)
            return BridgeResponse.Failure(id, CurrentVersion, "INVALID_REQUEST", "bridge payload is too large");
        var timeout = Math.Clamp(timeoutMs, 250, 300000);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        try
        {
            if (string.Equals(method, "legacy.api", StringComparison.OrdinalIgnoreCase))
            {
                if (_legacyApi is null)
                    return BridgeResponse.Failure(id, CurrentVersion, "LOCAL_STORAGE_UNAVAILABLE", _storageError);
                var path = payload.TryGetProperty("path", out var pathValue) ? pathValue.GetString() : null;
                var verb = payload.TryGetProperty("method", out var methodValue) ? methodValue.GetString() : "GET";
                var body = payload.TryGetProperty("body", out var bodyValue) ? bodyValue : (JsonElement?)null;
                var allowedHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    "Content-Type", "Accept", "X-State-Version", "X-Zhike-State-Format", "X-Filename", "X-Idempotency-Key"
                };
                var headers = payload.TryGetProperty("headers", out var headersValue) && headersValue.ValueKind == JsonValueKind.Object
                    ? headersValue.EnumerateObject().Where(item => allowedHeaders.Contains(item.Name)).ToDictionary(item => item.Name, item => item.Value.ToString(), StringComparer.OrdinalIgnoreCase)
                    : null;
                var bodyKind = payload.TryGetProperty("bodyKind", out var bodyKindValue) ? bodyKindValue.GetString() ?? "json" : "json";
                if (string.IsNullOrWhiteSpace(path))
                    return BridgeResponse.Failure(id, CurrentVersion, "INVALID_REQUEST", "path is required");

                var result = await _legacyApi.SendAsync(id, path, new HttpMethod(verb ?? "GET"), body, headers, bodyKind, timeoutCts.Token);
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
