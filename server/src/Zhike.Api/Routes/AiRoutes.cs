using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public static class AiRoutes
{
    public static IEndpointRouteBuilder MapAiRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/ai");
        group.MapGet("/jobs", async (string? state, int? limit, AiJobRepository repository, CancellationToken cancellationToken)
            => Results.Ok(await repository.ListAsync(state, limit ?? 100, cancellationToken)));
        group.MapPost("/jobs/retry", async (AiRetryRequest request, AiJobRepository repository, CancellationToken cancellationToken)
            => Results.Ok(new { changed = await repository.RetryAsync(request.Ids ?? [], cancellationToken) }));
        return endpoints;
    }
}

public sealed record AiRetryRequest(IReadOnlyList<string>? Ids);
