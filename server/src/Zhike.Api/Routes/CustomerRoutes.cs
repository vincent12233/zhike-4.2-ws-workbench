using Zhike.Infrastructure.Repositories;
using Zhike.Contracts;

namespace Zhike.Api.Routes;

public static class CustomerRoutes
{
    public static IEndpointRouteBuilder MapCustomerRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/customers");
        group.MapGet("", async (string? search, string? cursor, int? limit, CustomerRepository repository, CancellationToken cancellationToken) => Results.Ok((await repository.ListAsync(search, cursor, limit ?? 100, cancellationToken)).Select(ToDto)));
        group.MapPost("", async (CustomerInput input, CustomerRepository repository, CancellationToken cancellationToken) =>
        {
            var row = await repository.UpsertFillEmptyAsync(input, cancellationToken);
            return row is null ? Results.NotFound(new { error = "客户不存在或保存失败。" }) : Results.Ok(ToDto(row));
        });
        group.MapPost("/{id}/recycle", async (string id, CustomerRepository repository, CancellationToken cancellationToken) =>
        {
            var changed = await repository.RecycleAsync(id, cancellationToken);
            return changed > 0 ? Results.Ok(new { changed }) : Results.NotFound(new { error = "客户不存在或状态未改变。", id });
        });
        group.MapPost("/{id}/restore", async (string id, CustomerRepository repository, CancellationToken cancellationToken) =>
        {
            var changed = await repository.RestoreAsync(id, cancellationToken);
            return changed > 0 ? Results.Ok(new { changed }) : Results.NotFound(new { error = "客户不存在或状态未改变。", id });
        });
        return endpoints;
    }

    private static CustomerDto ToDto(CustomerRow row)
        => new(row.Id, row.Name, row.Phone, row.Country, row.Language, row.Source, row.Stage, row.Status, row.IntentLevel, row.Occupation, row.Age, row.Budget, row.ProductInterest, row.Notes, row.AiSummary, row.UpdatedAt, row.StatusColor, row.Tags, row.ProfileSummary, row.CompletenessScore, row.NextFollowupAt);
}
