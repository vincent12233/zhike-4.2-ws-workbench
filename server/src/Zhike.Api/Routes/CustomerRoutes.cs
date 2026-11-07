using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public static class CustomerRoutes
{
    public static IEndpointRouteBuilder MapCustomerRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/customers");
        group.MapGet("", async (string? search, string? cursor, int? limit, CustomerRepository repository, CancellationToken cancellationToken) => Results.Ok(await repository.ListAsync(search, cursor, limit ?? 100, cancellationToken)));
        group.MapPost("", async (CustomerInput input, CustomerRepository repository, CancellationToken cancellationToken) => Results.Ok(await repository.UpsertFillEmptyAsync(input, cancellationToken)));
        group.MapPost("/{id}/recycle", async (string id, CustomerRepository repository, CancellationToken cancellationToken) => Results.Ok(new { changed = await repository.RecycleAsync(id, cancellationToken) }));
        group.MapPost("/{id}/restore", async (string id, CustomerRepository repository, CancellationToken cancellationToken) => Results.Ok(new { changed = await repository.RestoreAsync(id, cancellationToken) }));
        return endpoints;
    }
}
