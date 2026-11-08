using System.Text.Json;
using System.Text.Json.Nodes;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public static class LegacyStateRoutes
{
    public static IEndpointRouteBuilder MapLegacyStateRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/legacy");
        group.MapGet("/state", async (HttpContext context, LegacyStateRepository repository, CancellationToken cancellationToken) =>
        {
            var owner = Owner(context);
            var current = await repository.GetAsync(owner, cancellationToken);
            if (current is null) return Results.Ok(new { initialized = false, version = string.Empty });
            var node = JsonNode.Parse(current.Json ?? "{}") as JsonObject ?? new JsonObject();
            node["initialized"] = true;
            node["version"] = current.Revision.ToString();
            return Results.Json(node);
        });

        group.MapPut("/state", async (HttpContext context, LegacyStateRepository repository, CancellationToken cancellationToken) =>
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: cancellationToken);
            var expected = ParseRevision(context.Request.Headers["X-State-Version"].ToString());
            var result = await repository.SaveAsync(Owner(context), document.RootElement.Clone(), expected, cancellationToken);
            return result.Conflict
                ? Results.Conflict(new { error = "版本冲突，请刷新后重试。", version = result.Revision })
                : Results.Ok(new { ok = true, version = result.Revision.ToString() });
        });

        group.MapPost("/snapshot", async (HttpContext context, LegacyStateRepository repository, CancellationToken cancellationToken) =>
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: cancellationToken);
            var reason = document.RootElement.TryGetProperty("reason", out var value) ? value.GetString() ?? "" : "";
            var id = await repository.CreateSnapshotAsync(Owner(context), reason, cancellationToken: cancellationToken);
            return Results.Ok(new { ok = id > 0, snapshotCreated = id > 0, id });
        });

        group.MapGet("/snapshots", async (HttpContext context, LegacyStateRepository repository, CancellationToken cancellationToken) =>
        {
            var rows = await repository.ListSnapshotsAsync(Owner(context), cancellationToken: cancellationToken);
            return Results.Ok(new { snapshots = rows.Select(row => new { id = row.Id, createdAt = row.CreatedAt, reason = row.Reason, customers = CountArray(row.Json, "customers"), phoneRegistry = CountArray(row.Json, "phoneRegistry"), registrations = CountArray(row.Json, "registrations"), businessRecords = CountArray(row.Json, "tickets") + CountArray(row.Json, "deposits") }) });
        });

        group.MapPost("/snapshots/{id:long}/restore", async (long id, HttpContext context, LegacyStateRepository repository, CancellationToken cancellationToken) =>
        {
            var snapshot = await repository.GetSnapshotAsync(Owner(context), id, cancellationToken);
            if (snapshot is null) return Results.NotFound(new { error = "找不到该快照。" });
            using var document = JsonDocument.Parse(snapshot.Json);
            var expected = ParseRevision(context.Request.Headers["X-State-Version"].ToString());
            var result = await repository.SaveAsync(Owner(context), document.RootElement.Clone(), expected, cancellationToken);
            return result.Conflict
                ? Results.Conflict(new { error = "版本冲突，请刷新后重试。", version = result.Revision })
                : Results.Ok(new { ok = true, version = result.Revision.ToString(), snapshotCreated = true });
        });

        return endpoints;
    }

    private static string Owner(HttpContext context) => context.Items["Zhike.OwnerId"]?.ToString() ?? "default";
    private static long? ParseRevision(string value) => long.TryParse(value, out var revision) ? revision : null;
    private static int CountArray(string json, string property)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Array ? value.GetArrayLength() : 0;
        }
        catch { return 0; }
    }
}
