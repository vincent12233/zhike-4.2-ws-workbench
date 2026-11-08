using Zhike.Contracts;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

/// <summary>
/// Account-scoped hot-chat profile routes.  The desktop client may use either
/// the profile id route or the customer/account/conversation scope route; both
/// paths resolve through the same transactional repository.
/// </summary>
public static class HotChatRoutes
{
    public static IEndpointRouteBuilder MapHotChatRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/ws/hot-chat");
        group.MapGet("/profiles", GetByScopeAsync);
        group.MapGet("/profiles/{id}", GetAsync);
        group.MapPost("/profiles", UpsertAsync);
        group.MapPut("/profiles/{id}", UpsertByIdAsync);
        group.MapPost("/profiles/{id}/fields", UpsertFieldAsync);
        group.MapPost("/profiles/{id}/events", AppendEventAsync);
        group.MapGet("/profiles/{id}/diagnostics", GetDiagnosticsAsync);
        group.MapGet("/diagnostics", GetDiagnosticsByScopeAsync);
        group.MapGet("/profile", GetByScopeAsync);
        group.MapPut("/profile", UpsertAsync);

        // Compatibility alias used by the offline WebView2 bridge.
        var alias = endpoints.MapGroup("/api/v2/hot-chat");
        alias.MapGet("/profiles", GetByScopeAsync);
        alias.MapGet("/profiles/{id}", GetAsync);
        alias.MapPost("/profiles", UpsertAsync);
        alias.MapPut("/profiles/{id}", UpsertByIdAsync);
        alias.MapPost("/profiles/{id}/fields", UpsertFieldAsync);
        alias.MapPost("/profiles/{id}/events", AppendEventAsync);
        alias.MapGet("/profiles/{id}/diagnostics", GetDiagnosticsAsync);
        alias.MapGet("/diagnostics", GetDiagnosticsByScopeAsync);
        alias.MapGet("/profile", GetByScopeAsync);
        alias.MapPut("/profile", UpsertAsync);
        return endpoints;
    }

    private static async Task<IResult> GetByScopeAsync(string customerId, string accountId, string conversationId, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        try
        {
            var profile = await repository.GetByScopeAsync(customerId, accountId, conversationId, cancellationToken);
            return profile is null ? Results.NotFound(new { error = "热聊档案不存在。" }) : Results.Ok(profile);
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static async Task<IResult> GetAsync(string id, string accountId, string conversationId, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        try
        {
            var profile = await repository.GetAsync(id, accountId, conversationId, cancellationToken);
            return profile is null ? Results.NotFound(new { error = "热聊档案不存在。", id }) : Results.Ok(profile);
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static Task<IResult> UpsertAsync(HttpContext context, HotChatProfileUpsertRequest input, HotChatProfileRepository repository, CancellationToken cancellationToken)
        => UpsertCoreAsync(context, input, null, repository, cancellationToken);

    private static Task<IResult> UpsertByIdAsync(HttpContext context, string id, HotChatProfileUpsertRequest input, HotChatProfileRepository repository, CancellationToken cancellationToken)
        => UpsertCoreAsync(context, input with { Id = id }, id, repository, cancellationToken);

    private static async Task<IResult> UpsertCoreAsync(HttpContext context, HotChatProfileUpsertRequest input, string? routeId, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        if (routeId is not null && !string.Equals(routeId.Trim(), input.Id?.Trim(), StringComparison.Ordinal)) return Results.BadRequest(new { error = "profile id mismatch" });
        var request = input.ExpectedVersion.HasValue ? input : input with { ExpectedVersion = ReadExpectedVersion(context) };
        try
        {
            var result = await repository.UpsertAsync(request, cancellationToken);
            if (result.Conflict) return Results.Conflict(new { error = "热聊档案版本冲突，请刷新后重试。", currentVersion = result.CurrentVersion });
            context.Response.Headers.ETag = $"\"{result.Profile?.Version ?? result.CurrentVersion}\"";
            return Results.Ok(result.Profile);
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static async Task<IResult> UpsertFieldAsync(HttpContext context, string id, string accountId, string conversationId, HotChatProfileFieldUpsertRequest input, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        var request = input.ExpectedVersion.HasValue ? input : input with { ExpectedVersion = ReadExpectedVersion(context) };
        try
        {
            var result = await repository.UpsertFieldAsync(id, accountId, conversationId, request, cancellationToken);
            if (result.Conflict && result.Conflicts.Contains("version", StringComparer.OrdinalIgnoreCase)) return Results.Conflict(new { error = "热聊档案版本冲突，请刷新后重试。", currentVersion = result.CurrentVersion });
            return Results.Ok(new { profile = result.Profile, appliedFields = result.AppliedFields, conflicts = result.Conflicts });
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static async Task<IResult> AppendEventAsync(HttpContext context, string id, string accountId, string conversationId, HotChatEventRequest input, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        try
        {
            var result = await repository.AppendEventAsync(id, accountId, conversationId, input, cancellationToken);
            return Results.Ok(new { profile = result.Profile, duplicate = result.Conflicts.Contains("duplicate", StringComparer.OrdinalIgnoreCase) });
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static async Task<IResult> GetDiagnosticsAsync(string id, string accountId, string conversationId, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        try
        {
            var result = await repository.GetDiagnosticsAsync(id, accountId, conversationId, cancellationToken);
            return result is null ? Results.NotFound(new { error = "热聊档案不存在。", id }) : Results.Ok(result);
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static async Task<IResult> GetDiagnosticsByScopeAsync(string profileId, string accountId, string conversationId, HotChatProfileRepository repository, CancellationToken cancellationToken)
    {
        try
        {
            var result = await repository.GetDiagnosticsAsync(profileId, accountId, conversationId, cancellationToken);
            return result is null ? Results.NotFound(new { error = "热聊档案不存在。", profileId }) : Results.Ok(result);
        }
        catch (HotChatScopeException error) { return Results.Conflict(new { error = error.Message }); }
    }

    private static long? ReadExpectedVersion(HttpContext context)
    {
        var raw = context.Request.Headers["X-State-Version"].FirstOrDefault()
            ?? context.Request.Headers["If-Match"].FirstOrDefault()?.Trim('"');
        return long.TryParse(raw, out var version) && version >= 0 ? version : null;
    }
}
