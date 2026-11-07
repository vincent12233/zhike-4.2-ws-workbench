using System.Net.Http.Json;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record HealthDto(string AppVersion, int SchemaVersion, string DatabaseStatus, string WorkerStatus);
public sealed record ImportPreviewRequest(IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string>> Rows, string Context = "");
public sealed record ImportPreviewResponse(IReadOnlyList<JsonElement> Rows, IReadOnlyList<string> Conflicts);
public sealed record WsAccountDto(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen);
public sealed record FollowupDto(string Id, string CustomerId, string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority, string State);

public sealed class ApiClient(HttpClient http)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<HealthDto?> GetHealthAsync(CancellationToken cancellationToken = default)
        => await http.GetFromJsonAsync<HealthDto>("api/v2/health", JsonOptions, cancellationToken);

    public async Task<IReadOnlyList<JsonElement>?> GetCustomersAsync(string? cursor = null, CancellationToken cancellationToken = default)
    {
        var suffix = string.IsNullOrWhiteSpace(cursor) ? string.Empty : $"?cursor={Uri.EscapeDataString(cursor)}";
        return await http.GetFromJsonAsync<IReadOnlyList<JsonElement>>($"api/v2/customers{suffix}", JsonOptions, cancellationToken);
    }

    public async Task<ImportPreviewResponse?> PreviewImportAsync(ImportPreviewRequest request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/v2/import/batches/preview", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ImportPreviewResponse>(JsonOptions, cancellationToken);
    }

    public async Task<WsAccountDto[]?> GetWsAccountsAsync(CancellationToken cancellationToken = default)
        => await http.GetFromJsonAsync<WsAccountDto[]>("api/v2/ws/accounts", JsonOptions, cancellationToken);

    public async Task<FollowupDto[]?> GetFollowupsAsync(string? state = null, CancellationToken cancellationToken = default)
    {
        var suffix = string.IsNullOrWhiteSpace(state) ? string.Empty : $"?state={Uri.EscapeDataString(state)}";
        return await http.GetFromJsonAsync<FollowupDto[]>($"api/v2/ws/followups{suffix}", JsonOptions, cancellationToken);
    }
}
