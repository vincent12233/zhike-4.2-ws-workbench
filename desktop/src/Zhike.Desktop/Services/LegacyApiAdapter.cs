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
            ["/api/ws/checkpoints"] = "api/v2/ws/checkpoints",
            ["/api/ws/heartbeat"] = "api/v2/ws/heartbeat",
        };

    // These legacy endpoints are part of the Electron-only local service.
    // The WinUI bridge must report them as unsupported until an equivalent
    // Postgres API exists; forwarding them to a guessed v2 path would turn a
    // missing feature into an opaque HTTP_404 and make the page look saved.
    private static readonly string[] ExplicitlyUnsupportedPrefixes =
    [
        "/api/ws/conversations",
        "/api/ws/messages",
        "/api/ws/analyses",
        "/api/ws/replies",
        "/api/ws/settings",
        "/api/ws/collection-runs",
        "/api/ws/collection-items",
        "/api/ws/followup-alerts",
        "/api/ws/crm-sync",
        "/api/ws/export",
        "/api/ws/import",
        "/api/data-governance/",
        "/api/import/legacy/",
        "/api/diagnostics",
        "/api/shutdown",
    ];

    public LegacyApiAdapter(ApiClient api) => _api = api;

    public async Task<LegacyApiResponse> SendAsync(
        string requestId,
        string legacyPath,
        HttpMethod method,
        JsonElement? body,
        IReadOnlyDictionary<string, string>? headers = null,
        string bodyKind = "json",
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(legacyPath))
            return new(false, "INVALID_REQUEST", "legacy path is required", null, requestId);

        var key = legacyPath.Split('?', 2)[0];
        if (!PathMap.TryGetValue(key, out var v2Path))
        {
            if (key.StartsWith("/api/snapshots/", StringComparison.OrdinalIgnoreCase))
                v2Path = "api/v2/legacy/snapshots/" + key[15..];
            else if (key.Equals("/api/health", StringComparison.OrdinalIgnoreCase))
                v2Path = "api/v2/health";
            else if (ExplicitlyUnsupportedPrefixes.Any(prefix => key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
                return new(false, "UNSUPPORTED", $"legacy path is not available in the Postgres desktop host: {key}", null, requestId);
            else
                return new(false, "UNSUPPORTED", $"unsupported legacy path: {key}", null, requestId);
        }

        byte[]? rawBody = null;
        if (string.Equals(bodyKind, "binary", StringComparison.OrdinalIgnoreCase) && body is { ValueKind: JsonValueKind.Object } binary && binary.TryGetProperty("base64", out var encoded))
        {
            try { rawBody = Convert.FromBase64String(encoded.GetString() ?? string.Empty); }
            catch { return new(false, "INVALID_REQUEST", "binary request body is invalid", null, requestId); }
        }
        var raw = await _api.SendJsonAsync(v2Path + (legacyPath.Contains('?') ? legacyPath[(legacyPath.IndexOf('?'))..] : string.Empty), method, bodyKind == "binary" ? null : body, cancellationToken, headers, rawBody);
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
