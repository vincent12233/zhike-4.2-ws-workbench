using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public sealed record HealthDto(string AppVersion, int SchemaVersion, string DatabaseStatus, string WorkerStatus);
public sealed record CustomerDto(string Id, string Name, string Phone, string Country, string Language, string Source, string Stage, string Status, string IntentLevel, string Occupation, int? Age, string Budget, string ProductInterest, string Notes, string AiSummary, DateTimeOffset UpdatedAt);
public sealed record BusinessRecordDto(string Id, string CustomerId, string RecordType, string ProductCode, string Direction, string? RegisteredAt, string? BusinessDate, string? NextFollowupAt, string Channel, string Status, string VipCode, string Note, string BusinessKey, DateTimeOffset UpdatedAt);
public sealed record ImportPreviewRequest(IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string>> Rows, string Context = "", string SourceName = "");
public sealed record ImportPreviewRowDto(int RowNumber, JsonElement Raw, JsonElement Classified, double Confidence, IReadOnlyList<string> Conflicts);
public sealed record ImportPreviewResponse(string Id, string SourceHash, IReadOnlyList<ImportPreviewRowDto> Rows);
public sealed record WsAccountDto(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen, string? RuntimeStatus = null, DateTimeOffset? UpdatedAt = null);
public sealed record FollowupDto(string Id, string CustomerId, string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority, string State);
public sealed record WsAccountRequest(string Id, string DisplayName, string Status = "未连接");
public sealed record WsMessageEnvelopeDto(string ConnectorId, string AccountId, string ConversationKey, string? ExternalMessageId, DateTimeOffset? SentAt, string Direction, string Body, bool PreviewOnly, DateTimeOffset ObservedAt, string? Cursor = null);
public sealed record WsCheckpointDto(string AccountId, string ConversationKey, string Cursor, string LastMessageFingerprint, DateTimeOffset UpdatedAt);
public sealed record WsIngestBatchRequestDto(string Protocol, string ConnectorId, string AccountId, DateTimeOffset CapturedAt, string Scope, IReadOnlyList<WsMessageEnvelopeDto> Messages, IReadOnlyList<WsCheckpointDto> Checkpoints);
public sealed record WsIngestBatchResponseDto(int Accepted, int Deduplicated, IReadOnlyList<string> MessageIds, DateTimeOffset ProcessedAt);
public sealed record PairingStartRequest(string DeviceId);
public sealed record PairingStartResponse(string Code, DateTimeOffset ExpiresAt);
public sealed record PairingCompleteRequest(string Code, string DeviceProof);
public sealed record PairingCompleteResponse(bool Ok, string? Token, DateTimeOffset? ExpiresAt, string? Reason);
public sealed record SessionRotateResponse(bool Ok, string? Token, DateTimeOffset? ExpiresAt);

public sealed class ApiClient(HttpClient http)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private string? _sessionToken;
    // Used only for the explicitly opt-in remote pairing flow. Do not add it
    // to HttpClient.DefaultRequestHeaders: pairing approval must never be sent
    // to ordinary API endpoints.
    private readonly string? _pairingApprovalCode = Environment.GetEnvironmentVariable("ZHIKE_PAIRING_APPROVAL_CODE");

    public static ApiClient? TryCreateFromEnvironment()
    {
        var apiUrl = Environment.GetEnvironmentVariable("ZHIKE_API_BASE_URL");
        if (!Uri.TryCreate(apiUrl, UriKind.Absolute, out var baseUri)) return null;
        var baseAddress = new Uri(baseUri.ToString().TrimEnd('/') + "/");
        var client = new ApiClient(new HttpClient { BaseAddress = baseAddress });
        client.SetSessionToken(Environment.GetEnvironmentVariable("ZHIKE_API_TOKEN"));
        return client;
    }

    public void SetSessionToken(string? token)
    {
        _sessionToken = string.IsNullOrWhiteSpace(token) ? null : token.Trim();
        http.DefaultRequestHeaders.Authorization = string.IsNullOrWhiteSpace(_sessionToken)
            ? null
            : new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _sessionToken);
    }

    public string? SessionToken => _sessionToken;

    public static string ComputePairingProof(string code, string deviceId)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(deviceId.Trim()));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(code.Trim())))
            .Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }

    public async Task<HealthDto?> GetHealthAsync(CancellationToken cancellationToken = default)
        => await http.GetFromJsonAsync<HealthDto>("api/v2/health", JsonOptions, cancellationToken);

    public async Task<IReadOnlyList<CustomerDto>?> GetCustomersAsync(string? search = null, string? cursor = null, CancellationToken cancellationToken = default)
    {
        var query = new List<string>();
        if (!string.IsNullOrWhiteSpace(search)) query.Add($"search={Uri.EscapeDataString(search.Trim())}");
        if (!string.IsNullOrWhiteSpace(cursor)) query.Add($"cursor={Uri.EscapeDataString(cursor.Trim())}");
        var suffix = query.Count == 0 ? string.Empty : "?" + string.Join("&", query);
        return await http.GetFromJsonAsync<IReadOnlyList<CustomerDto>>($"api/v2/customers{suffix}", JsonOptions, cancellationToken);
    }

    public async Task<IReadOnlyList<BusinessRecordDto>?> GetBusinessRecordsAsync(string? productCode = null, string? recordType = null, string? direction = null, string? cursor = null, CancellationToken cancellationToken = default)
    {
        var query = new List<string>();
        if (!string.IsNullOrWhiteSpace(productCode)) query.Add($"productCode={Uri.EscapeDataString(productCode.Trim())}");
        if (!string.IsNullOrWhiteSpace(recordType)) query.Add($"recordType={Uri.EscapeDataString(recordType.Trim())}");
        if (!string.IsNullOrWhiteSpace(direction)) query.Add($"direction={Uri.EscapeDataString(direction.Trim())}");
        if (!string.IsNullOrWhiteSpace(cursor)) query.Add($"cursor={Uri.EscapeDataString(cursor.Trim())}");
        var suffix = query.Count == 0 ? string.Empty : "?" + string.Join("&", query);
        return await http.GetFromJsonAsync<IReadOnlyList<BusinessRecordDto>>($"api/v2/business-records{suffix}", JsonOptions, cancellationToken);
    }

    public async Task<ImportPreviewResponse?> PreviewImportAsync(ImportPreviewRequest request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/v2/import/batches/preview", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ImportPreviewResponse>(JsonOptions, cancellationToken);
    }

    public async Task<bool> CommitImportAsync(string batchId, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/v2/import/batches/commit", new { BatchId = batchId }, JsonOptions, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<FollowupDto[]?> GetFollowupsAsync(string? state = null, CancellationToken cancellationToken = default)
    {
        var suffix = string.IsNullOrWhiteSpace(state) ? string.Empty : $"?state={Uri.EscapeDataString(state)}";
        return await http.GetFromJsonAsync<FollowupDto[]>($"api/v2/ws/followups{suffix}", JsonOptions, cancellationToken);
    }

    public async Task<WsAccountDto[]?> GetWsAccountsAsync(CancellationToken cancellationToken = default)
        => await http.GetFromJsonAsync<WsAccountDto[]>("api/v2/ws/accounts", JsonOptions, cancellationToken);

    public async Task<WsAccountDto?> UpsertWsAccountAsync(WsAccountRequest request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/v2/ws/accounts", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<WsAccountDto>(JsonOptions, cancellationToken);
    }

    public async Task<bool> UpdateWsAccountStatusAsync(string accountId, string status, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync($"api/v2/ws/accounts/{Uri.EscapeDataString(accountId)}/status", new { Status = status }, JsonOptions, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<WsIngestBatchResponseDto?> IngestWsBatchAsync(WsIngestBatchRequestDto request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/v2/ws/ingest/batch", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<WsIngestBatchResponseDto>(JsonOptions, cancellationToken);
    }

    public async Task<PairingStartResponse?> StartPairingAsync(PairingStartRequest request, CancellationToken cancellationToken = default)
    {
        using var message = CreatePairingRequest("api/v2/pairing/start", request);
        using var response = await http.SendAsync(message, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<PairingStartResponse>(JsonOptions, cancellationToken);
    }

    public async Task<PairingCompleteResponse?> CompletePairingAsync(PairingCompleteRequest request, CancellationToken cancellationToken = default)
    {
        using var message = CreatePairingRequest("api/v2/pairing/complete", request);
        using var response = await http.SendAsync(message, cancellationToken);
        return await response.Content.ReadFromJsonAsync<PairingCompleteResponse>(JsonOptions, cancellationToken);
    }

    private HttpRequestMessage CreatePairingRequest<T>(string path, T payload)
    {
        var message = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(payload, options: JsonOptions)
        };
        if (!string.IsNullOrWhiteSpace(_pairingApprovalCode))
        {
            message.Headers.TryAddWithoutValidation("X-Zhike-Pairing-Approval", _pairingApprovalCode.Trim());
        }
        return message;
    }

    public async Task<SessionRotateResponse?> RotateSessionAsync(string? token = null, CancellationToken cancellationToken = default)
    {
        var current = string.IsNullOrWhiteSpace(token) ? _sessionToken : token.Trim();
        if (string.IsNullOrWhiteSpace(current)) return null;
        using var response = await http.PostAsJsonAsync("api/v2/sessions/rotate", new { Token = current }, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        var rotated = await response.Content.ReadFromJsonAsync<SessionRotateResponse>(JsonOptions, cancellationToken);
        if (rotated?.Ok == true && !string.IsNullOrWhiteSpace(rotated.Token)) SetSessionToken(rotated.Token);
        return rotated;
    }

    public async Task<bool> TryRotateSessionAsync(CancellationToken cancellationToken = default)
    {
        try { return (await RotateSessionAsync(null, cancellationToken))?.Ok == true; }
        catch { return false; }
    }
}
