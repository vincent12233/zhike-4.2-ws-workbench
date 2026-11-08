using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed class LegacyApiAdapter
{
    private readonly ApiClient _api;

    private static readonly IReadOnlyDictionary<string, string> PathMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["/api/state"] = "api/v2/legacy/state",
            ["/api/state/version"] = "api/v2/legacy/state",
            ["/api/snapshot"] = "api/v2/legacy/snapshot",
            ["/api/snapshots"] = "api/v2/legacy/snapshots",
            ["/api/ws/accounts"] = "api/v2/ws/accounts",
            ["/api/ws/followups"] = "api/v2/ws/followups",
            ["/api/ws/ingest/batch"] = "api/v2/ws/ingest/batch",
        };

    public LegacyApiAdapter(ApiClient api) => _api = api;

    public async Task<LegacyApiResponse> SendAsync(
        string requestId,
        string legacyPath,
        HttpMethod method,
        JsonElement? body,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(legacyPath))
            return new(false, "INVALID_REQUEST", "legacy path is required", null, requestId);

        var key = legacyPath.Split('?', 2)[0];
        if (!PathMap.TryGetValue(key, out var v2Path))
        {
            if (key.StartsWith("/api/ws/", StringComparison.OrdinalIgnoreCase))
                v2Path = "api/v2/ws/" + key[8..];
            else if (key.StartsWith("/api/snapshots/", StringComparison.OrdinalIgnoreCase))
                v2Path = "api/v2/legacy/snapshots/" + key[15..];
            else if (key.Equals("/api/health", StringComparison.OrdinalIgnoreCase))
                v2Path = "api/v2/health";
            else
                return new(false, "UNSUPPORTED", $"unsupported legacy path: {key}", null, requestId);
        }

        var raw = await _api.SendJsonAsync(v2Path + (legacyPath.Contains('?') ? legacyPath[(legacyPath.IndexOf('?'))..] : string.Empty), method, body, cancellationToken);
        if (raw.Ok)
            return new(true, string.Empty, raw.Message, raw.Data, requestId);

        var code = raw.StatusCode switch
        {
            0 => "SERVICE_UNAVAILABLE",
            (int)HttpStatusCode.Conflict => "CONFLICT",
            (int)HttpStatusCode.Unauthorized or (int)HttpStatusCode.Forbidden => "AUTH_REQUIRED",
            >= 500 => "UPSTREAM_ERROR",
            _ => $"HTTP_{raw.StatusCode}",
        };
        return new(false, code, raw.Message, null, requestId);
    }
}
