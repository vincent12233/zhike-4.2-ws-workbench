using System.Text.Json;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public sealed record ImportPreviewRequest(IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string>> Rows, string Context = "", string SourceName = "");
public sealed record ImportCommitRequest(string BatchId);

public static class ImportRoutes
{
    public static IEndpointRouteBuilder MapImportRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v2/import/batches");
        group.MapPost("/preview", async (ImportPreviewRequest request, ImportRepository repository, CancellationToken cancellationToken) =>
        {
            if (request is null || request.Headers is null || request.Headers.Count > 500 || request.Rows is null || request.Rows.Count > 100_000)
                return (IResult)Results.BadRequest("导入列数或行数超出限制（最多 500 列、100000 行）");
            var headers = new List<string>(request.Headers.Count);
            var seenHeaders = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < request.Headers.Count; index++)
            {
                var header = (request.Headers[index] ?? string.Empty).Trim();
                if (header.Length > 200) return (IResult)Results.BadRequest("导入表头长度不能超过 200 个字符");
                if (header.Length == 0) header = $"列{index + 1}";
                if (seenHeaders.TryGetValue(header, out var count))
                {
                    count++;
                    seenHeaders[header] = count;
                    header = $"{header}_{count}";
                }
                else seenHeaders[header] = 1;
                headers.Add(header);
            }
            var rows = request.Rows.Select(row =>
            {
                var values = headers.Select((header, index) => new KeyValuePair<string, string>(header, index < row.Count ? (row[index] ?? string.Empty) : string.Empty)).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
                values["__context"] = request.Context ?? string.Empty;
                return JsonSerializer.SerializeToElement(values);
            }).ToArray();
            return Results.Ok(await repository.CreatePreviewAsync(string.IsNullOrWhiteSpace(request.SourceName) ? request.Context : request.SourceName, rows, cancellationToken));
        });
        group.MapPost("/commit", async (ImportCommitRequest request, ImportRepository repository, CancellationToken cancellationToken) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.BatchId))
                return (IResult)Results.BadRequest("batchId is required");
            var changed = await repository.CommitAsync(request.BatchId, cancellationToken);
            return changed > 0
                ? Results.Ok(new { ok = true, changed })
                : Results.Conflict(new { ok = false, changed = 0, error = "批次不存在、已提交或没有可写入的记录。" });
        });
        return endpoints;
    }
}
