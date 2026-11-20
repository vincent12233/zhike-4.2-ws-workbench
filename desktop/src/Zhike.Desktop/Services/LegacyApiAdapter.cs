using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace Zhike.Desktop.Services;

/// <summary>
/// Keeps the existing web shell API contract while sending every request to
/// the single local SQLite sidecar. The former adapter translated a subset of
/// routes to the removed PostgreSQL API and rejected WS detail routes, which
/// made the workbench render but never persist its data.
/// </summary>
public sealed class LegacyApiAdapter
{
    private readonly ApiClient _api;

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

        var separator = legacyPath.IndexOf('?', StringComparison.Ordinal);
        var key = separator >= 0 ? legacyPath[..separator] : legacyPath;
        if (!key.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
            || key.Contains("..", StringComparison.Ordinal)
            || key.Contains('\\', StringComparison.Ordinal))
            return new(false, "INVALID_REQUEST", "仅允许本机 API 路径。", null, requestId);
        if (key.Equals("/api/shutdown", StringComparison.OrdinalIgnoreCase))
            return new(false, "UNSUPPORTED", "关闭本机服务必须由桌面宿主执行。", null, requestId);

        // These writes require host-owned evidence. The shell may configure
        // automation, but cannot impersonate capture or paid native execution.
        var authorityPath = key.TrimEnd('/');
        if (authorityPath.Equals("/api/ws/ingest/batch", StringComparison.OrdinalIgnoreCase)
            || authorityPath.Equals("/api/ws/ai-automation/attempts", StringComparison.OrdinalIgnoreCase))
            return new(false, "WS_NATIVE_AUTHORITY_REQUIRED", "此操作只能由原生宿主执行。", null, requestId);

        byte[]? rawBody = null;
        if (string.Equals(bodyKind, "binary", StringComparison.OrdinalIgnoreCase)
            && body is { ValueKind: JsonValueKind.Object } binary
            && binary.TryGetProperty("base64", out var encoded))
        {
            try { rawBody = Convert.FromBase64String(encoded.GetString() ?? string.Empty); }
            catch { return new(false, "INVALID_REQUEST", "binary request body is invalid", null, requestId); }
        }

        var path = key.TrimStart('/') + (separator >= 0 ? legacyPath[separator..] : string.Empty);
        var raw = await _api.SendJsonAsync(path, method, bodyKind == "binary" ? null : body, cancellationToken, headers, rawBody);
        if (raw.Ok)
        {
            var business = EvaluateBusinessResult(key, raw.Data);
            if (business is not null)
                return new(false, business.Value.ErrorCode, business.Value.Message, raw.Data, requestId);
            return new(true, string.Empty, raw.Message, raw.Data, requestId);
        }

        var code = raw.StatusCode switch
        {
            0 => "SERVICE_UNAVAILABLE",
            (int)HttpStatusCode.Conflict => "CONFLICT",
            (int)HttpStatusCode.Unauthorized or (int)HttpStatusCode.Forbidden => "AUTH_REQUIRED",
            >= 500 => "UPSTREAM_ERROR",
            _ => $"HTTP_{raw.StatusCode}",
        };
        var message = raw.Data is { ValueKind: JsonValueKind.Object } errorBody
            && (errorBody.TryGetProperty("error", out var errorValue) || errorBody.TryGetProperty("message", out errorValue))
            ? errorValue.ToString()
            : raw.Message;
        return new(false, code, message, raw.Data, requestId);
    }

    private static (string ErrorCode, string Message)? EvaluateBusinessResult(string key, JsonElement? data)
    {
        if (data is not { ValueKind: JsonValueKind.Object } value) return null;
        if (value.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False)
            return ("BUSINESS_REJECTED", "本机服务拒绝了本次操作。");
        if (value.TryGetProperty("snapshotCreated", out var snapshot)
            && snapshot.ValueKind == JsonValueKind.False
            && !key.Equals("/api/snapshot", StringComparison.OrdinalIgnoreCase))
            return ("SNAPSHOT_NOT_CREATED", "未创建写入前快照，本次操作已取消。");
        // changed=0 is a valid idempotent no-op (for example, deleting an
        // already absent option or replaying an import). Treating it as an
        // error was the source of the misleading “保存异常” badge.
        return null;
    }
}
