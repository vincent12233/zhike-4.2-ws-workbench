using Zhike.Api.Auth;

namespace Zhike.Api.Routes;

public sealed record PairingStartRequest(string DeviceId);
public sealed record PairingCompleteRequest(string Code, string DeviceProof);
public sealed record SessionRevokeRequest(string Token);
public sealed record SessionRotateRequest(string Token);

public static class AuthRoutes
{
    public static IEndpointRouteBuilder MapAuthRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2");
        group.MapPost("/pairing/start", (HttpContext context, PairingStartRequest request, PairingAccessGuard access, PairingService service) =>
        {
            var accessResult = access.Check(context);
            if (!accessResult.Allowed) return Results.Json(new { ok = false, reason = accessResult.Reason }, statusCode: StatusCodes.Status403Forbidden);
            return string.IsNullOrWhiteSpace(request?.DeviceId)
                ? Results.BadRequest(new { ok = false, reason = "deviceId is required" })
                : Results.Ok(service.Start(request.DeviceId));
        });
        group.MapPost("/pairing/complete", (HttpContext context, PairingCompleteRequest request, PairingAccessGuard access, PairingService pairing, SessionService sessions) =>
        {
            var accessResult = access.Check(context);
            if (!accessResult.Allowed) return Results.Json(new { ok = false, reason = accessResult.Reason }, statusCode: StatusCodes.Status403Forbidden);
            var result = pairing.Complete(request.Code, request.DeviceProof);
            return result.Succeeded && result.DeviceId is not null
                ? Results.Ok(new { ok = true, token = sessions.Issue(result.DeviceId), expiresAt = DateTimeOffset.UtcNow.AddHours(24) })
                : Results.BadRequest(new { ok = false, reason = result.Reason });
        });
        group.MapPost("/sessions/revoke", (HttpContext context, SessionRevokeRequest request, SessionService sessions) =>
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            var current = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? authorization[7..].Trim() : string.Empty;
            if (string.IsNullOrWhiteSpace(request?.Token) || !CryptographicEquals(current, request.Token)) return (IResult)Results.StatusCode(StatusCodes.Status403Forbidden);
            sessions.Revoke(current);
            return Results.Ok(new { ok = true });
        });
        group.MapPost("/sessions/rotate", (HttpContext context, SessionRotateRequest request, SessionService sessions) =>
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            var current = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? authorization[7..].Trim() : string.Empty;
            if (string.IsNullOrWhiteSpace(request?.Token) || !CryptographicEquals(current, request.Token)) return (IResult)Results.StatusCode(StatusCodes.Status403Forbidden);
            var rotated = sessions.Rotate(current);
            return rotated.Succeeded ? Results.Ok(new { ok = true, token = rotated.Token, expiresAt = DateTimeOffset.UtcNow.AddHours(24) }) : Results.Unauthorized();
        });
        return endpoints;
    }

    private static bool CryptographicEquals(string left, string right)
    {
        var a = System.Text.Encoding.UTF8.GetBytes(left ?? string.Empty);
        var b = System.Text.Encoding.UTF8.GetBytes(right ?? string.Empty);
        return a.Length == b.Length && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(a, b);
    }
}
