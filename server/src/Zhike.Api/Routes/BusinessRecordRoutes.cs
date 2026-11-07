using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public static class BusinessRecordRoutes
{
    public static IEndpointRouteBuilder MapBusinessRecordRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/business-records");
        group.MapGet("", async (string? productCode, string? recordType, string? direction, string? cursor, int? limit, BusinessRecordRepository repository, CancellationToken cancellationToken) => Results.Ok(await repository.ListAsync(productCode, recordType, direction, cursor, limit ?? 100, cancellationToken)));
        group.MapPost("", async (BusinessRecordInput input, BusinessRecordRepository repository, CancellationToken cancellationToken) => Results.Ok(await repository.UpsertAsync(input, cancellationToken)));
        return endpoints;
    }
}
