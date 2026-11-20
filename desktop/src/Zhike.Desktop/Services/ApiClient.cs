using System.Net.Http.Json;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;

namespace Zhike.Desktop.Services;

public sealed record HealthDto(string AppVersion, int SchemaVersion, string DatabaseStatus, string WorkerStatus);
public sealed record CustomerDto(string Id, string Name, string Phone, string Country, string Language, string Source, string Stage, string Status, string IntentLevel, string Occupation, int? Age, string Budget, string ProductInterest, string Notes, string AiSummary, DateTimeOffset UpdatedAt);
public sealed record BusinessRecordDto(string Id, string CustomerId, string RecordType, string ProductCode, string Direction, string? RegisteredAt, string? BusinessDate, string? NextFollowupAt, string Channel, string Status, string VipCode, string Note, string BusinessKey, DateTimeOffset UpdatedAt);
public sealed record ImportPreviewRequest(IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string>> Rows, string Context = "", string SourceName = "", string Target = "");
public sealed record ImportPreviewRowDto(int RowNumber, JsonElement Raw, JsonElement Classified, double Confidence, IReadOnlyList<string> Conflicts);
public sealed record ImportPreviewResponse(string Id, string SourceHash, IReadOnlyList<ImportPreviewRowDto> Rows, string DuplicateOf = "");
public sealed record WsAccountDto(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen, string? RuntimeStatus = null, DateTimeOffset? UpdatedAt = null, string? LastKnownStatus = null, string WorkspaceMode = "ordinary");
public sealed record FollowupDto(string Id, string CustomerId, string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority, string State);
public sealed record AiJobDto(string Id, string JobType, string State, int Attempts, DateTimeOffset AvailableAt, string LastError, DateTimeOffset UpdatedAt);
public sealed record AiPipelineLeaseDto(string ScopeKey, string LeaseId, string OwnerId, long FencingToken);
public sealed record AiPipelineRequestResult(bool Ok, int StatusCode, JsonElement? Data, string Message);
public sealed record WsAccountRequest(string Id, string DisplayName, string Status = "未连接",
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? WorkspaceMode = null);
public sealed record WsMessageEnvelopeDto(
    string ConnectorId,
    string AccountId,
    string ConversationKey,
    string? ExternalMessageId,
    DateTimeOffset? SentAt,
    string Direction,
    string Body,
    bool PreviewOnly,
    DateTimeOffset ObservedAt,
    string? Cursor = null,
    long Order = 0,
    string TimestampText = "",
    string TimestampSource = "",
    string LegacyExternalMessageId = "",
    string DirectionSource = "",
    string ConversationType = "",
    bool VipGroup = false,
    string SenderId = "",
    string SenderName = "",
    string SenderPhone = "",
    string SenderIdentitySource = "",
    bool SenderIdentityTrusted = false);
// Checkpoints are list-level observations. Optional preview/time/unread fields
// let a virtualized WS list update the conversation summary without creating a
// fake message row; old callers that only send identity/cursor remain valid.
public sealed record WsObservedMemberDto(string MemberId, string DisplayName);
public sealed record WsCheckpointDto(
    string AccountId,
    string ConversationKey,
    string Cursor,
    string LastMessageFingerprint,
    DateTimeOffset UpdatedAt,
    string DisplayName = "",
    string LastMessagePreview = "",
    string LastMessageAt = "",
    int? UnreadCount = null,
    string Coverage = "",
    bool HistoryLoaded = false,
    string CollectionStatus = "",
    int HistoryMessageCount = 0,
    int DirectionVersion = 0,
    int DirectionUnresolvedCount = 0,
    string ConversationType = "",
    bool? IsGroup = null,
    bool VipGroup = false,
    IReadOnlyList<WsObservedMemberDto>? ObservedMembers = null);
public sealed record WsGroupMembershipEventDto(
    string AccountId,
    string ProfileId,
    string TargetId,
    string GroupJid,
    string MemberId,
    string MemberPhone,
    string Type,
    DateTimeOffset? EventAt = null,
    DateTimeOffset? ObservedAt = null,
    string SourceEventId = "",
    double Confidence = 0,
    string Source = "ws-native");
public sealed record WsIngestBatchRequestDto(
    string Protocol,
    string ConnectorId,
    string AccountId,
    DateTimeOffset CapturedAt,
    string Scope,
    IReadOnlyList<WsMessageEnvelopeDto> Messages,
    IReadOnlyList<WsCheckpointDto> Checkpoints,
    IReadOnlyList<WsGroupMembershipEventDto>? GroupEvents = null,
    long? SessionGeneration = null);
public sealed record WsIngestBatchResponseDto(int Accepted, int Deduplicated, IReadOnlyList<string> MessageIds, DateTimeOffset ProcessedAt, int ObservedMembersAdded = 0);

public sealed class ApiClient(HttpClient http) : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private string? _sessionToken;
    private string? _nativeWriteToken;
    private readonly Dictionary<string, ImportPreviewRequest> _localImportBatches = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _localImportHashes = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>
    /// True when this client talks to the bundled loopback SQLite sidecar.
    /// The local sidecar intentionally exposes a small, non-versioned route
    /// set; the desktop build has no remote-server fallback.
    /// </summary>
    public bool IsLocalSidecar { get; private set; }

    public void Dispose()
    {
        http.Dispose();
        GC.SuppressFinalize(this);
    }

    public void ConfigureLocalSidecar() => IsLocalSidecar = true;

    public static ApiClient? TryCreateFromEnvironment()
    {
        // Native fallback pages use the same loopback SQLite service as the
        // WebView shell.  Do not return null merely because the old remote
        // connection profile is absent; that was the source of blank native
        // pages and misleading "未配置服务器" errors after the local-only
        // migration.
        if (Zhike.Desktop.App.LocalService?.IsRunning == true)
            return Zhike.Desktop.App.LocalService.CreateApiClient();
        return null;
    }

    public void SetSessionToken(string? token)
    {
        _sessionToken = string.IsNullOrWhiteSpace(token) ? null : token.Trim();
        http.DefaultRequestHeaders.Authorization = string.IsNullOrWhiteSpace(_sessionToken)
            ? null
            : new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _sessionToken);
        // The local SQLite sidecar uses a per-launch loopback token rather
        // than a generic bearer credential. Keep Authorization for legacy
        // compatibility, but always send the explicit sidecar header too.
        http.DefaultRequestHeaders.Remove("X-Zhike-Api-Token");
        if (!string.IsNullOrWhiteSpace(_sessionToken))
            http.DefaultRequestHeaders.TryAddWithoutValidation("X-Zhike-Api-Token", _sessionToken);
    }

    public string? SessionToken => _sessionToken;

    internal Task<JsonElement> RestoreWorkspaceAsync(Stream body, string version, CancellationToken token) =>
        WorkspaceRestoreTransfer.PostAsync(http, body, version, token);

    public async Task<JsonElement> WsAiAutomationAsync(object payload, CancellationToken cancellationToken = default)
    {
        using var response = await PostNativeJsonAsync("api/ws/ai-automation/attempts", payload, cancellationToken);
        var data = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var reason = data.TryGetProperty("error", out var error) ? error.GetString() : null;
            throw new InvalidOperationException(reason ?? "自动 AI 授权服务不可用，未发送请求。");
        }
        return data;
    }

    internal void ConfigureNativeWriteAuthority(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("Native write authority is required.", nameof(token));
        _nativeWriteToken = token;
    }

    // Only typed host-owned operations call this method. Generic legacy.api
    // never receives this capability and it is never a default HTTP header.
    internal async Task<HttpResponseMessage> PostNativeJsonAsync<T>(string path, T payload, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_nativeWriteToken))
            throw new InvalidOperationException("WS_NATIVE_AUTHORITY_REQUIRED: 原生写入凭证未就绪。");
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("X-Zhike-Native-Token", _nativeWriteToken);
        request.Content = JsonContent.Create(payload, options: JsonOptions);
        return await http.SendAsync(request, cancellationToken);
    }

    public async Task<RawApiResponse> SendJsonAsync(
        string path,
        HttpMethod method,
        JsonElement? payload = null,
        CancellationToken cancellationToken = default,
        IReadOnlyDictionary<string, string>? headers = null,
        byte[]? rawBody = null)
    {
        try
        {
            using var request = new HttpRequestMessage(method, path);
            if (rawBody is not null && method != HttpMethod.Get && method != HttpMethod.Head)
                request.Content = new ByteArrayContent(rawBody);
            else if (payload.HasValue && method != HttpMethod.Get && method != HttpMethod.Head)
                request.Content = JsonContent.Create(payload.Value, options: JsonOptions);
            if (headers is not null)
                foreach (var header in headers)
                    if (!header.Key.Equals("X-Zhike-Native-Token", StringComparison.OrdinalIgnoreCase)
                        && !request.Headers.TryAddWithoutValidation(header.Key, header.Value))
                        request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value);
            using var response = await http.SendAsync(request, cancellationToken);
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            JsonElement? data = null;
            if (!string.IsNullOrWhiteSpace(text))
            {
                try { data = JsonDocument.Parse(text).RootElement.Clone(); }
                catch { /* preserve the status/error without exposing response text */ }
            }
            return response.IsSuccessStatusCode
                ? new RawApiResponse(true, (int)response.StatusCode, "ok", data)
                : new RawApiResponse(false, (int)response.StatusCode, "upstream request failed", data);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new RawApiResponse(false, 0, "upstream request timed out", null);
        }
        catch
        {
            return new RawApiResponse(false, 0, "upstream request unavailable", null);
        }
    }

    public async Task<BinaryApiResponse> GetBytesAsync(
        string path,
        CancellationToken cancellationToken = default,
        int maxBytes = 64 * 1024 * 1024)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith("api/ws/media/", StringComparison.OrdinalIgnoreCase))
            return new(false, 400, "invalid binary path", [], string.Empty, string.Empty);
        if (maxBytes < 1) return new(false, 400, "invalid binary size limit", [], string.Empty, string.Empty);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var output = new MemoryStream();
            var buffer = new byte[64 * 1024];
            var total = 0;
            while (true)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(), cancellationToken);
                if (read <= 0) break;
                total += read;
                if (total > maxBytes)
                    return new(false, 413, "binary response exceeds the configured limit", [], string.Empty, string.Empty);
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            var bytes = output.ToArray();
            var contentType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
            var disposition = response.Content.Headers.ContentDisposition?.ToString() ?? string.Empty;
            return response.IsSuccessStatusCode
                ? new(true, (int)response.StatusCode, "ok", bytes, contentType, disposition)
                : new(false, (int)response.StatusCode, "binary request failed", [], contentType, disposition);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(false, 0, "binary request timed out", [], string.Empty, string.Empty);
        }
        catch
        {
            return new(false, 0, "binary request unavailable", [], string.Empty, string.Empty);
        }
    }

    public async Task<HealthDto?> GetHealthAsync(CancellationToken cancellationToken = default)
        => await http.GetFromJsonAsync<HealthDto>("api/health", JsonOptions, cancellationToken);

    public async Task<IReadOnlyList<CustomerDto>?> GetCustomersAsync(string? search = null, string? cursor = null, CancellationToken cancellationToken = default)
    {
        using var state = await GetStateDocumentAsync(cancellationToken);
        if (!state.RootElement.TryGetProperty("customers", out var rows) || rows.ValueKind != JsonValueKind.Array) return [];
        var needle = search?.Trim() ?? string.Empty;
        return rows.EnumerateArray()
            .Where(row => !Bool(row, "deleted") && (string.IsNullOrWhiteSpace(needle) || string.Join(" ", Text(row, "name"), Text(row, "phone"), Text(row, "rawPhone"), Text(row, "source"), Text(row, "status"), Text(row, "phase")).Contains(needle, StringComparison.OrdinalIgnoreCase)))
            .Select(row => new CustomerDto(Text(row, "id"), Text(row, "name"), Text(row, "phone", "rawPhone"), Text(row, "country", "countryRegion"), Text(row, "language", "customerLanguage"), Text(row, "source", "channel"), Text(row, "phase", "stage"), Text(row, "status"), Text(row, "intentLevel", "intent"), Text(row, "occupation", "job"), NullableInt(row, "age"), Text(row, "budget"), Text(row, "productInterest", "interest"), Text(row, "note", "notes"), Text(row, "aiSummary", "profileSummary"), Date(row, "updatedAt", "createdAt")))
            .ToArray();
    }

    public async Task<IReadOnlyList<BusinessRecordDto>?> GetBusinessRecordsAsync(string? productCode = null, string? recordType = null, string? direction = null, string? cursor = null, CancellationToken cancellationToken = default)
    {
        using var state = await GetStateDocumentAsync(cancellationToken);
        var result = new List<BusinessRecordDto>();
        if (state.RootElement.TryGetProperty("tickets", out var tickets) && tickets.ValueKind == JsonValueKind.Array)
            foreach (var row in tickets.EnumerateArray())
                AddTicketRows(result, row, productCode, recordType, direction);
        if (state.RootElement.TryGetProperty("deposits", out var deposits) && deposits.ValueKind == JsonValueKind.Array)
            foreach (var row in deposits.EnumerateArray())
                AddDepositRow(result, row, productCode, recordType, direction);
        return result;
    }

    public async Task<ImportPreviewResponse?> PreviewImportAsync(ImportPreviewRequest request, CancellationToken cancellationToken = default)
    {
        var id = $"local-import-{Guid.NewGuid():N}";
        var sourceHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
        var duplicate = _localImportHashes.FirstOrDefault(pair => pair.Key.Equals(sourceHash, StringComparison.OrdinalIgnoreCase)).Value;
        _localImportBatches[id] = request;
        _localImportHashes[sourceHash] = id;
        var rows = request.Rows.Select((row, index) => new ImportPreviewRowDto(
            index + 2,
            JsonSerializer.SerializeToElement(row),
            JsonSerializer.SerializeToElement(new { target = request.Target, fields = request.Headers.Zip(row, (header, value) => new { header, value }).ToDictionary(item => item.header, item => item.value) }),
            request.Target.Equals("mixed", StringComparison.OrdinalIgnoreCase) ? 0.72 : 0.86,
            Array.Empty<string>())).ToArray();
        await Task.CompletedTask;
        return new ImportPreviewResponse(id, sourceHash, rows, duplicate ?? string.Empty);
    }

    public async Task<bool> CommitImportAsync(string batchId, CancellationToken cancellationToken = default)
    {
        if (!_localImportBatches.TryGetValue(batchId, out var request)) return false;
        using var stateDocument = await GetStateDocumentAsync(cancellationToken);
        var state = JsonNode.Parse(stateDocument.RootElement.GetRawText())?.AsObject() ?? new JsonObject();
        var customers = EnsureArray(state, "customers");
        var tickets = EnsureArray(state, "tickets");
        var deposits = EnsureArray(state, "deposits");
        var changed = 0;
        var processed = 0;
        var now = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        for (var index = 0; index < request.Rows.Count; index++)
        {
            var row = ToRow(request.Headers, request.Rows[index]);
            if (row.Count == 0 || row.Values.All(string.IsNullOrWhiteSpace)) continue;
            var kind = request.Target.Equals("mixed", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(request.Target) || request.Target.Equals("auto", StringComparison.OrdinalIgnoreCase)
                ? InferRowTarget(row)
                : request.Target.ToLowerInvariant();
            var phoneRaw = Value(row, "电话", "手机", "号码", "phone", "mobile", "contact");
            var phone = NormalizePhone(phoneRaw);
            var customer = EnsureCustomer(customers, row, phoneRaw, phone, ref changed);
            var customerId = NodeText(customer?["id"]);
            processed++;
            if (kind is "ticket" or "deposit")
            {
                if (kind == "ticket")
                {
                    var products = SplitProducts(Value(row, "股票代码", "证券代码", "产品代码", "股票", "品种", "symbol", "product"));
                    if (products.Length == 0) products = ["未指定"];
                    foreach (var product in products)
                    {
                        var item = BuildTicket(row, customer, customerId, phoneRaw, phone, product, now);
                        var existing = FindBusinessRecord(tickets, item, "ticket");
                        if (existing is null) { tickets.Add(item); changed++; }
                        else if (MergeMissing(existing, item)) changed++;
                    }
                }
                else
                {
                    var item = BuildDeposit(row, customer, customerId, phoneRaw, phone, now);
                    var existing = FindBusinessRecord(deposits, item, "deposit");
                    if (existing is null) { deposits.Add(item); changed++; }
                    else if (MergeMissing(existing, item)) changed++;
                }
                continue;
            }
        }
        if (processed <= 0) return false;
        if (changed > 0)
        {
            var version = stateDocument.RootElement.TryGetProperty("version", out var versionValue) ? versionValue.ToString() : string.Empty;
            await PutStateAsync(state, version, cancellationToken);
        }
        _localImportBatches.Remove(batchId);
        return true;
    }

    public async Task<FollowupDto[]?> GetFollowupsAsync(string? state = null, CancellationToken cancellationToken = default)
    {
        using var document = await GetStateDocumentAsync(cancellationToken);
        if (!document.RootElement.TryGetProperty("followups", out var rows) || rows.ValueKind != JsonValueKind.Array) return [];
        return rows.EnumerateArray()
            .Where(row => string.IsNullOrWhiteSpace(state) || Text(row, "state", "status").Equals(state, StringComparison.OrdinalIgnoreCase))
            .Select(row => new FollowupDto(Text(row, "id"), Text(row, "customerId"), Text(row, "reasonKey", "reason"), Text(row, "title"), Text(row, "detail", "note", "result"), DateOrNull(row, "dueAt", "nextDate", "due"), Text(row, "priority"), Text(row, "state", "status")))
            .ToArray();
    }

    public async Task<AiJobDto[]?> GetAiJobsAsync(string? state = null, CancellationToken cancellationToken = default)
    {
        // Keep this method on the legacy queue route for existing native
        // callers.  The route remains the production authority while the
        // Stage 4 pipeline is behind its isolated feature gate.
        var query = "api/ws/ai-jobs?accountId=default";
        if (!string.IsNullOrWhiteSpace(state)) query += "&status=" + Uri.EscapeDataString(state.Trim());
        using var response = await http.GetAsync(query, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        if (!document.RootElement.TryGetProperty("jobs", out var rows) || rows.ValueKind != JsonValueKind.Array) return [];
        return rows.EnumerateArray().Select(ParseLegacyAiJob).ToArray();
    }

    public async Task<int> RetryAiJobsAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken = default)
    {
        if (ids is null || ids.Count == 0) return 0;
        throw new InvalidOperationException("AI 重试需要隔离队列的 fencing lease；请调用 RetryAiPipelineJobsAsync。 ");
    }

    /// <summary>
    /// Reads the Stage 4 queue without enabling it. A 404 response is returned
    /// as data instead of being hidden so the UI can truthfully show that the
    /// production gate is still frozen.
    /// </summary>
    public Task<AiPipelineRequestResult> GetAiPipelineJobsAsync(
        string accountId = "default",
        string? state = null,
        CancellationToken cancellationToken = default)
    {
        var query = $"api/ws/ai-pipeline/jobs?accountId={Uri.EscapeDataString(accountId)}";
        if (!string.IsNullOrWhiteSpace(state)) query += "&state=" + Uri.EscapeDataString(state.Trim());
        return SendAiPipelineRequestAsync(HttpMethod.Get, query, null, cancellationToken);
    }

    public Task<AiPipelineRequestResult> GetAiPipelineJobAsync(
        string jobId,
        string accountId = "default",
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId)) throw new ArgumentException("任务编号不能为空。", nameof(jobId));
        var path = $"api/ws/ai-pipeline/jobs/{Uri.EscapeDataString(jobId)}?accountId={Uri.EscapeDataString(accountId)}";
        return SendAiPipelineRequestAsync(HttpMethod.Get, path, null, cancellationToken);
    }

    public Task<AiPipelineRequestResult> GetAiCrmSuggestionsAsync(
        string accountId = "default",
        string? status = null,
        CancellationToken cancellationToken = default)
    {
        var query = $"api/ws/ai-pipeline/suggestions?accountId={Uri.EscapeDataString(accountId)}";
        if (!string.IsNullOrWhiteSpace(status)) query += "&status=" + Uri.EscapeDataString(status.Trim());
        return SendAiPipelineRequestAsync(HttpMethod.Get, query, null, cancellationToken);
    }

    public Task<AiPipelineRequestResult> AcquireAiPipelineLeaseAsync(
        string scopeKey,
        string ownerId,
        int leaseMs = 120_000,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(scopeKey)) throw new ArgumentException("租约作用域不能为空。", nameof(scopeKey));
        if (string.IsNullOrWhiteSpace(ownerId)) throw new ArgumentException("租约所有者不能为空。", nameof(ownerId));
        return SendAiPipelineRequestAsync(HttpMethod.Post, "api/ws/fencing", new
        {
            action = "acquire",
            scopeKey,
            ownerId,
            leaseMs = Math.Clamp(leaseMs, 10_000, 600_000),
        }, cancellationToken);
    }

    public Task<AiPipelineRequestResult> SendAiPipelineJobActionAsync(
        string jobId,
        string action,
        AiPipelineLeaseDto lease,
        string accountId = "default",
        object? fields = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId)) throw new ArgumentException("任务编号不能为空。", nameof(jobId));
        if (string.IsNullOrWhiteSpace(action)) throw new ArgumentException("任务操作不能为空。", nameof(action));
        var body = BuildStage4Body(accountId, fields);
        body["jobId"] = jobId;
        body["action"] = action.Trim().ToLowerInvariant();
        body["lease"] = JsonSerializer.SerializeToNode(lease, JsonOptions);
        var path = $"api/ws/ai-pipeline/jobs/{Uri.EscapeDataString(jobId)}?accountId={Uri.EscapeDataString(accountId)}";
        return SendAiPipelineRequestAsync(HttpMethod.Post, path, body, cancellationToken);
    }

    public async Task<int> RetryAiPipelineJobsAsync(
        IReadOnlyList<string> ids,
        AiPipelineLeaseDto lease,
        string accountId = "default",
        CancellationToken cancellationToken = default)
    {
        if (ids is null || ids.Count == 0) return 0;
        var retried = 0;
        foreach (var id in ids.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal))
        {
            var result = await SendAiPipelineJobActionAsync(id, "retry", lease, accountId, cancellationToken: cancellationToken);
            if (result.Ok && result.Data is { } data && data.ValueKind == JsonValueKind.Object && data.TryGetProperty("retried", out var value) && value.ValueKind == JsonValueKind.True)
                retried++;
        }
        return retried;
    }

    public Task<AiPipelineRequestResult> ApproveAiCrmSuggestionAsync(
        string suggestionId,
        AiPipelineLeaseDto lease,
        string stateVersion,
        string accountId = "default",
        string actor = "operator",
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(suggestionId)) throw new ArgumentException("候选编号不能为空。", nameof(suggestionId));
        if (string.IsNullOrWhiteSpace(stateVersion)) throw new ArgumentException("审核必须带客户资料版本。", nameof(stateVersion));
        var body = BuildStage4Body(accountId, new { actor });
        body["action"] = "approve";
        body["suggestionId"] = suggestionId;
        body["lease"] = JsonSerializer.SerializeToNode(lease, JsonOptions);
        var path = $"api/ws/ai-pipeline/suggestions/{Uri.EscapeDataString(suggestionId)}/approve?accountId={Uri.EscapeDataString(accountId)}";
        return SendAiPipelineRequestAsync(HttpMethod.Post, path, body, cancellationToken, new Dictionary<string, string> { ["X-State-Version"] = stateVersion });
    }

    private async Task<AiPipelineRequestResult> SendAiPipelineRequestAsync(
        HttpMethod method,
        string path,
        object? payload,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        JsonElement? element = payload is null ? null : JsonSerializer.SerializeToElement(payload, JsonOptions);
        var response = await SendJsonAsync(path, method, element, cancellationToken, headers);
        return new AiPipelineRequestResult(response.Ok, response.StatusCode, response.Data, response.Message);
    }

    private static JsonObject BuildStage4Body(string accountId, object? fields)
    {
        var body = fields is null
            ? new JsonObject()
            : JsonSerializer.SerializeToNode(fields, JsonOptions)?.AsObject() ?? new JsonObject();
        body["accountId"] = accountId;
        return body;
    }

    private static AiJobDto ParseLegacyAiJob(JsonElement row)
    {
        var availableAt = DateTimeOffset.TryParse(Text(row, "nextAttemptAt", "createdAt", "updatedAt"), out var parsed)
            ? parsed
            : DateTimeOffset.UtcNow;
        return new AiJobDto(
            Text(row, "id"),
            Text(row, "jobType") is { Length: > 0 } type ? type : "ws.ai.analysis",
            Text(row, "status", "state"),
            int.TryParse(Text(row, "attempts"), out var attempts) ? attempts : 0,
            availableAt,
            Text(row, "lastError", "error"),
            DateTimeOffset.TryParse(Text(row, "updatedAt", "createdAt"), out var updated) ? updated : availableAt);
    }

    private async Task<JsonDocument> GetStateDocumentAsync(CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync("api/state", cancellationToken);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return JsonDocument.Parse(body);
    }

    private async Task PutStateAsync(JsonObject state, string version, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "api/state")
        {
            Content = JsonContent.Create(state, options: JsonOptions),
        };
        request.Headers.TryAddWithoutValidation("X-State-Version", version);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private static JsonArray EnsureArray(JsonObject state, string name)
    {
        if (state[name] is JsonArray array) return array;
        array = new JsonArray();
        state[name] = array;
        return array;
    }

    private static Dictionary<string, string> ToRow(IReadOnlyList<string> headers, IReadOnlyList<string> values)
    {
        var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < headers.Count; index++)
        {
            var header = headers[index]?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(header)) continue;
            var value = index < values.Count ? values[index]?.Trim() ?? string.Empty : string.Empty;
            row[header] = value;
        }
        return row;
    }

    private static JsonObject? EnsureCustomer(JsonArray customers, IReadOnlyDictionary<string, string> row, string? phoneRaw, string phone, ref int changed)
    {
        var externalId = Value(row, "客户编号", "客户ID", "客户标识", "账号", "externalId", "customerId");
        var name = Value(row, "客户姓名", "姓名", "名称", "联系人", "昵称", "name", "customer");
        var existing = customers.OfType<JsonObject>().FirstOrDefault(item =>
            (!string.IsNullOrWhiteSpace(phone) && NormalizePhone(NodeText(item["phone"] ?? item["rawPhone"])) == phone)
            || (!string.IsNullOrWhiteSpace(externalId) && (NodeText(item["id"]).Equals(externalId, StringComparison.OrdinalIgnoreCase) || NodeText(item["externalId"]).Equals(externalId, StringComparison.OrdinalIgnoreCase)))
            || (string.IsNullOrWhiteSpace(phone) && !string.IsNullOrWhiteSpace(name) && NodeText(item["name"]).Equals(name, StringComparison.OrdinalIgnoreCase)));

        if (existing is null && string.IsNullOrWhiteSpace(phone) && string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(externalId))
            return null;
        if (existing is null)
        {
            existing = new JsonObject
            {
                ["id"] = !string.IsNullOrWhiteSpace(externalId) && IsSafeId(externalId) ? externalId : $"N-customer-{Guid.NewGuid():N}",
                ["name"] = name ?? "新客户",
                ["rawPhone"] = phoneRaw ?? string.Empty,
                ["phone"] = phone,
                ["source"] = Value(row, "渠道", "来源", "source") ?? "导入",
                ["channel"] = Value(row, "渠道", "来源", "source") ?? "导入",
                ["status"] = Value(row, "状态", "客户状态") ?? "新客户",
                ["phase"] = Value(row, "客户阶段", "阶段", "phase") ?? "新客户",
                // Never manufacture today's registration date when an import
                // does not contain one. Empty means unknown and is preserved.
                ["registered"] = DateValue(row, "登记日期", "登记时间", "注册日期", "registered", "registeredAt"),
                ["due"] = DateValue(row, "下次跟进", "下次跟进日期", "跟进日期", "due", "nextFollowupAt"),
                ["deleted"] = false,
                ["touched"] = true,
                ["createdAt"] = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                ["updatedAt"] = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            };
            customers.Add(existing);
            changed++;
        }

        if (FillCustomer(existing, row, phoneRaw, phone)) changed++;
        return existing;
    }

    private static bool FillCustomer(JsonObject customer, IReadOnlyDictionary<string, string> row, string? phoneRaw, string phone)
    {
        var changed = false;
        void Fill(string field, string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            if (customer[field] is null || string.IsNullOrWhiteSpace(NodeText(customer[field]))) { customer[field] = value; changed = true; }
        }

        Fill("name", Value(row, "客户姓名", "姓名", "名称", "联系人", "昵称", "name", "customer"));
        Fill("rawPhone", phoneRaw);
        Fill("phone", phone);
        Fill("source", Value(row, "渠道", "来源", "source"));
        Fill("channel", Value(row, "渠道", "来源", "source"));
        Fill("status", Value(row, "状态", "客户状态", "status"));
        Fill("phase", Value(row, "客户阶段", "阶段", "phase", "stage"));
        Fill("registered", DateValue(row, "登记日期", "登记时间", "注册日期", "registered", "registeredAt"));
        Fill("due", DateValue(row, "下次跟进", "下次跟进日期", "跟进日期", "due", "nextFollowupAt"));
        Fill("assistant", Value(row, "助理", "负责人", "跟进人", "assistant", "owner"));
        Fill("page", Value(row, "页面", "来源页面", "page"));
        Fill("group", Value(row, "群组", "群号", "群编号", "group"));
        Fill("occupation", Value(row, "职业", "工作", "职业及工作", "occupation", "job"));
        Fill("age", Value(row, "年龄", "age"));
        Fill("gender", Value(row, "性别", "gender"));
        Fill("country", Value(row, "国家", "地区", "国家/地区", "country", "countryRegion"));
        Fill("language", Value(row, "语言", "客户语言", "language", "customerLanguage"));
        Fill("productInterest", Value(row, "产品兴趣", "兴趣", "产品", "productInterest", "interest"));
        Fill("budget", Value(row, "预算", "budget"));
        Fill("note", Value(row, "备注", "说明", "note", "notes"));
        Fill("vipCode", Value(row, "VIP编号", "VIP 编号", "VIP", "vipCode", "vipNumber"));
        Fill("qualification", Value(row, "评级", "客户评级", "qualification", "grade"));
        Fill("hot", Value(row, "热聊", "热聊状态", "hot"));
        customer["updatedAt"] = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        return changed;
    }

    private static JsonObject BuildTicket(IReadOnlyDictionary<string, string> row, JsonObject? customer, string customerId, string? phoneRaw, string phone, string product, string now)
    {
        var direction = NormalizeDirection(Value(row, "买卖方向", "交易方向", "方向", "side", "action"));
        var tradeDate = DateValue(row, direction == "卖出" ? "卖出日期" : "买入日期", "业务日期", "交易日期", "跟票日期", "登记日期", "日期", "date");
        var buyDate = direction == "买入" ? tradeDate : DateValue(row, "买入日期", "purchaseDate", "buyDate");
        var sellDate = direction == "卖出" ? tradeDate : DateValue(row, "卖出日期", "saleDate", "sellDate");
        var item = new JsonObject
        {
            ["id"] = $"N-ticket-{Guid.NewGuid():N}",
            ["customerId"] = customerId,
            ["customer"] = NodeText(customer?["name"]) is { Length: > 0 } customerName ? customerName : Value(row, "客户姓名", "姓名", "名称", "name") ?? string.Empty,
            ["phone"] = phoneRaw ?? string.Empty,
            ["date"] = tradeDate,
            ["buyDate"] = buyDate,
            ["sellDate"] = sellDate,
            ["product"] = product,
            ["direction"] = direction,
            ["status"] = Value(row, "状态", "跟票状态") ?? "已确认",
            ["channel"] = Value(row, "渠道", "来源", "source") ?? string.Empty,
            ["assistant"] = Value(row, "助理", "负责人", "assistant", "owner") ?? string.Empty,
            ["group"] = Value(row, "群组", "群号", "群编号", "group") ?? string.Empty,
            ["tradeRef"] = Value(row, "交易流水", "成交编号", "订单号", "交易编号", "tradeRef", "externalRef") ?? string.Empty,
            ["note"] = Value(row, "备注", "说明", "note") ?? string.Empty,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        item["businessKey"] = BusinessKey(item, "ticket");
        return item;
    }

    private static JsonObject BuildDeposit(IReadOnlyDictionary<string, string> row, JsonObject? customer, string customerId, string? phoneRaw, string phone, string now)
    {
        var date = DateValue(row, "入金日期", "付款日期", "充值日期", "业务日期", "交易日期", "登记日期", "日期", "date");
        var item = new JsonObject
        {
            ["id"] = $"N-deposit-{Guid.NewGuid():N}",
            ["customerId"] = customerId,
            ["customer"] = NodeText(customer?["name"]) is { Length: > 0 } customerName ? customerName : Value(row, "客户姓名", "姓名", "名称", "name") ?? string.Empty,
            ["phone"] = phoneRaw ?? string.Empty,
            ["date"] = date,
            ["amount"] = Value(row, "金额", "入金金额", "付款金额", "充值金额", "amount") ?? "0",
            ["currency"] = Value(row, "币种", "currency") ?? string.Empty,
            ["status"] = Value(row, "状态", "入金状态") ?? "已确认",
            ["channel"] = Value(row, "渠道", "来源", "source") ?? string.Empty,
            ["assistant"] = Value(row, "助理", "负责人", "assistant", "owner") ?? string.Empty,
            ["group"] = Value(row, "群组", "群号", "群编号", "group") ?? string.Empty,
            ["externalRef"] = Value(row, "支付流水", "付款流水", "入金编号", "交易流水", "externalRef", "tradeRef") ?? string.Empty,
            ["note"] = Value(row, "备注", "说明", "note") ?? string.Empty,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        item["businessKey"] = BusinessKey(item, "deposit");
        return item;
    }

    private static JsonObject? FindBusinessRecord(JsonArray records, JsonObject candidate, string kind)
    {
        var keys = BusinessKeyVariants(candidate, kind).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return records.OfType<JsonObject>().FirstOrDefault(item => BusinessKeyVariants(item, kind).Any(keys.Contains));
    }

    private static bool MergeMissing(JsonObject target, JsonObject source)
    {
        var changed = false;
        foreach (var pair in source)
        {
            if (pair.Key is "id" or "businessKey" or "createdAt") continue;
            if (pair.Value is null || string.IsNullOrWhiteSpace(NodeText(pair.Value))) continue;
            if (target[pair.Key] is null || string.IsNullOrWhiteSpace(NodeText(target[pair.Key]))) { target[pair.Key] = pair.Value.DeepClone(); changed = true; }
        }
        if (changed) target["updatedAt"] = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        return changed;
    }

    private static string BusinessKey(JsonObject row, string kind)
    {
        var owner = NodeText(row["customerId"]);
        if (string.IsNullOrWhiteSpace(owner)) owner = NormalizePhone(NodeText(row["phone"]));
        var date = NodeText(row["date"]);
        var product = NodeText(row["product"]);
        var direction = NodeText(row["direction"]);
        var amount = NodeText(row["amount"]);
        var currency = NodeText(row["currency"]);
        var reference = NodeText(row["tradeRef"] ?? row["externalRef"]);
        return kind.Equals("ticket", StringComparison.OrdinalIgnoreCase)
            ? string.Join("|", owner, date, product.Trim().ToLowerInvariant(), direction.Trim().ToLowerInvariant(), reference.Trim().ToLowerInvariant())
            : string.Join("|", owner, date, amount.Trim().ToLowerInvariant(), currency.Trim().ToLowerInvariant(), reference.Trim().ToLowerInvariant());
    }

    private static IEnumerable<string> BusinessKeyVariants(JsonObject row, string kind)
    {
        yield return BusinessKey(row, kind);
        var customerId = NodeText(row["customerId"]);
        var phone = NormalizePhone(NodeText(row["phone"]));
        if (!string.IsNullOrWhiteSpace(customerId) && !string.IsNullOrWhiteSpace(phone))
        {
            var clone = (JsonObject)row.DeepClone();
            clone["customerId"] = string.Empty;
            yield return BusinessKey(clone, kind);
        }
    }

    private static string[] SplitProducts(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return [];
        return value.Normalize(NormalizationForm.FormKC).Split([',', '，', '、', ';', '；', '|', '/', '\\', '+', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static bool IsSafeId(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, @"^[\p{L}\p{N}_-]{1,128}$");

    private static string NodeText(JsonNode? value) => value?.ToString() ?? string.Empty;

    private static string? Value(IReadOnlyDictionary<string, string> row, params string[] keys)
        => keys.Select(key => row.FirstOrDefault(item => string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase)).Value).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static string InferRowTarget(IReadOnlyDictionary<string, string> row)
    {
        var explicitType = Value(row, "记录类型", "业务类型", "数据类型", "类型", "recordType", "business.type");
        if (!string.IsNullOrWhiteSpace(explicitType))
        {
            if (explicitType.Contains("跟票", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("股票", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("证券", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("ticket", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("trade", StringComparison.OrdinalIgnoreCase)) return "ticket";
            if (explicitType.Contains("入金", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("付款", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("充值", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("deposit", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("payment", StringComparison.OrdinalIgnoreCase)) return "deposit";
            if (explicitType.Contains("客户", StringComparison.OrdinalIgnoreCase) || explicitType.Contains("customer", StringComparison.OrdinalIgnoreCase)) return "customer";
        }
        var keys = string.Join('|', row.Keys);
        var product = Value(row, "股票代码", "证券代码", "产品代码", "股票", "品种", "symbol", "product");
        var direction = Value(row, "买卖方向", "交易方向", "方向", "side", "action");
        if (!string.IsNullOrWhiteSpace(product) || !string.IsNullOrWhiteSpace(direction) || !string.IsNullOrWhiteSpace(Value(row, "交易流水", "成交编号", "订单号", "tradeRef"))) return "ticket";
        var depositDate = Value(row, "入金日期", "付款日期", "充值日期", "支付时间", "paymentDate", "depositDate");
        var depositAmount = Value(row, "入金金额", "付款金额", "充值金额", "支付金额", "depositAmount", "paymentAmount");
        if (!string.IsNullOrWhiteSpace(depositDate) || (!string.IsNullOrWhiteSpace(depositAmount) && (!string.IsNullOrWhiteSpace(Value(row, "币种", "currency")) || keys.Contains("支付", StringComparison.OrdinalIgnoreCase) || keys.Contains("付款", StringComparison.OrdinalIgnoreCase) || keys.Contains("充值", StringComparison.OrdinalIgnoreCase)))) return "deposit";
        var hasIdentity = !string.IsNullOrWhiteSpace(Value(row, "电话", "手机", "号码", "phone", "mobile", "contact")) || !string.IsNullOrWhiteSpace(Value(row, "客户姓名", "姓名", "名称", "联系人", "昵称", "name", "customer"));
        // Header names alone are not enough to create a business row. Customer
        // exports often carry empty derived columns such as 股票代码/入金金额;
        // route by actual values unless the file has no customer identity at all.
        if (!hasIdentity && (keys.Contains("股票", StringComparison.OrdinalIgnoreCase) || keys.Contains("证券", StringComparison.OrdinalIgnoreCase) || keys.Contains("买卖方向", StringComparison.OrdinalIgnoreCase))) return "ticket";
        if (!hasIdentity && (keys.Contains("入金", StringComparison.OrdinalIgnoreCase) || keys.Contains("付款", StringComparison.OrdinalIgnoreCase) || keys.Contains("充值", StringComparison.OrdinalIgnoreCase))) return "deposit";
        return "customer";
    }

    private static string NormalizePhone(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits;
    }

    private static string NormalizeDirection(string? value)
    {
        var text = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (text is "买入" or "购买" or "购入" or "买" or "buy" or "b") return "买入";
        if (text is "卖出" or "卖" or "sell" or "s") return "卖出";
        if (text is "关注" or "观察" or "持有" or "watch" or "hold" or "h") return "关注";
        return string.IsNullOrWhiteSpace(value) ? "关注" : value.Trim();
    }

    private static string DateValue(IReadOnlyDictionary<string, string> row, params string[] names)
    {
        var raw = Value(row, names);
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        var text = raw.Trim().Normalize(NormalizationForm.FormKC).Replace('年', '-').Replace('月', '-').Replace("日", string.Empty, StringComparison.Ordinal).Replace('/', '-').Replace('.', '-');
        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial >= 1 && serial <= 2958465 && !text.Contains('-', StringComparison.Ordinal))
            return DateTime.SpecifyKind(new DateTime(1899, 12, 30).AddDays(Math.Truncate(serial)), DateTimeKind.Utc).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var date)) return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (DateTime.TryParse(text, CultureInfo.CurrentCulture, DateTimeStyles.AllowWhiteSpaces, out date)) return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return raw.Trim();
    }

    private static string Text(JsonElement row, params string[] names)
        => names.Select(name => row.TryGetProperty(name, out var value) ? value.ToString() : string.Empty).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;

    private static bool Bool(JsonElement row, string name)
        => row.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static int? NullableInt(JsonElement row, params string[] names)
        => int.TryParse(Text(row, names), out var value) ? value : null;

    private static DateTimeOffset Date(JsonElement row, params string[] names)
        => DateTimeOffset.TryParse(Text(row, names), out var value) ? value : DateTimeOffset.UtcNow;

    private static DateTimeOffset? DateOrNull(JsonElement row, params string[] names)
        => DateTimeOffset.TryParse(Text(row, names), out var value) ? value : null;

    private static void AddTicketRows(List<BusinessRecordDto> result, JsonElement row, string? productCode, string? recordType, string? direction)
    {
        if (!string.IsNullOrWhiteSpace(recordType) && !recordType.Equals("ticket", StringComparison.OrdinalIgnoreCase)) return;
        var products = row.TryGetProperty("products", out var values) && values.ValueKind == JsonValueKind.Array ? values.EnumerateArray().Select(item => item.ToString()).Where(item => !string.IsNullOrWhiteSpace(item)).ToArray() : [Text(row, "product", "productCode", "symbol")];
        foreach (var product in products.DefaultIfEmpty("未指定"))
        {
            if (!string.IsNullOrWhiteSpace(productCode) && !product.Contains(productCode.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
            var side = Text(row, "direction", "side") ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(direction) && !side.Equals(direction, StringComparison.OrdinalIgnoreCase)) continue;
            result.Add(new BusinessRecordDto(Text(row, "id"), Text(row, "customerId"), "ticket", product, side, Text(row, "registeredAt"), Text(row, "businessDate", "date", "buyDate", "sellDate"), Text(row, "nextFollowupAt", "nextDate"), Text(row, "channel", "source"), Text(row, "status"), Text(row, "vipCode", "vipNumber"), Text(row, "note"), Text(row, "businessKey"), Date(row, "updatedAt", "createdAt")));
        }
    }

    private static void AddDepositRow(List<BusinessRecordDto> result, JsonElement row, string? productCode, string? recordType, string? direction)
    {
        if (!string.IsNullOrWhiteSpace(recordType) && !recordType.Equals("deposit", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.IsNullOrWhiteSpace(productCode)) return;
        result.Add(new BusinessRecordDto(Text(row, "id"), Text(row, "customerId"), "deposit", string.Empty, direction ?? string.Empty, Text(row, "registeredAt"), Text(row, "businessDate", "date"), Text(row, "nextFollowupAt", "nextDate"), Text(row, "channel", "source"), Text(row, "status"), Text(row, "vipCode", "vipNumber"), Text(row, "note"), Text(row, "businessKey"), Date(row, "updatedAt", "createdAt")));
    }

    public async Task<WsAccountDto[]?> GetWsAccountsAsync(CancellationToken cancellationToken = default)
    {
        using var response = await http.GetAsync("api/ws/accounts", cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, cancellationToken);
        if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("accounts", out var accounts))
            return accounts.Deserialize<WsAccountDto[]>(JsonOptions) ?? [];
        return payload.Deserialize<WsAccountDto[]>(JsonOptions) ?? [];
    }

    public async Task<WsCollectorPurposePolicy> GetWsCollectorPurposeAsync(string accountId, CancellationToken cancellationToken = default)
    {
        var accounts = await GetWsAccountsAsync(cancellationToken) ?? throw new InvalidDataException("WS 账号用途未确认。");
        var account = accounts.SingleOrDefault(row => row.Id == accountId) ?? throw new InvalidDataException("WS 账号用途未确认。");
        return WsCollectorPurposePolicy.Confirm(account, accountId);
    }

    public async Task<WsCollectorMonitorPolicy> GetWsCollectorMonitorAsync(string accountId, string profileId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(profileId)) throw new InvalidDataException("WS 群监控席位未确认。");
        using var response = await http.GetAsync($"api/ws/group-monitors/{Uri.EscapeDataString(profileId)}?accountId={Uri.EscapeDataString(accountId)}", cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return ParseWsCollectorMonitor(document.RootElement.GetProperty("profile"), accountId, profileId);
    }

    public async Task<IReadOnlyList<WsCollectorMonitorPolicy>> GetWsCollectorMonitorsAsync(string accountId, CancellationToken cancellationToken = default)
    {
        using var response = await http.GetAsync($"api/ws/group-monitors/profiles?accountId={Uri.EscapeDataString(accountId)}", cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return document.RootElement.GetProperty("profiles").EnumerateArray()
            .Select(profile => ParseWsCollectorMonitor(profile, accountId, profile.GetProperty("id").GetString() ?? "")).ToArray();
    }

    private static WsCollectorMonitorPolicy ParseWsCollectorMonitor(JsonElement profile, string accountId, string profileId)
    {
        string Value(JsonElement row, string key) => row.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
        bool Enabled(JsonElement row) => row.TryGetProperty("enabled", out var value) && value.ValueKind == JsonValueKind.True;
        if (string.IsNullOrWhiteSpace(profileId) || Value(profile, "id") != profileId || Value(profile, "accountId") != accountId) throw new InvalidDataException("WS 群监控席位账号不匹配。");
        var targets = new List<WsCollectorMonitorTarget>();
        foreach (var row in profile.GetProperty("targets").EnumerateArray())
        {
            var jid = Value(row, "groupJid");
            var id = Value(row, "id");
            if (Value(row, "accountId") != accountId || Value(row, "profileId") != profileId || !Enabled(row)
                || string.IsNullOrWhiteSpace(id) || !WsCollectorPurposePolicy.IsGroupJid(jid)) continue;
            targets.Add(new(id, jid, Value(row, "groupName"), Value(row, "sourceId"), true));
            if (targets.Count > 500) throw new InvalidDataException("WS 群监控目标超过 500 项。");
        }
        var interval = profile.TryGetProperty("pollIntervalSec", out var value) && value.TryGetInt32(out var parsed) ? Math.Clamp(parsed, 15, 3600) : 45;
        return new(accountId, profileId, Enabled(profile), interval, targets);
    }

    public async Task AuthorizeWsCollectorBatchAsync(WsIngestBatchRequestDto request, CancellationToken cancellationToken = default)
    {
        if (request.Scope != "background-collector") return;
        var purpose = await GetWsCollectorPurposeAsync(request.AccountId, cancellationToken);
        var memberCheckpoints = request.Checkpoints.Where(row => row.ObservedMembers is { Count: > 0 }).ToArray();
        var monitors = purpose.AllowsGroupMonitoring && (request.Messages.Count > 0 || memberCheckpoints.Length > 0)
            ? await GetWsCollectorMonitorsAsync(request.AccountId, cancellationToken) : [];
        if (memberCheckpoints.Any(row => row.Coverage != "group-monitor-visible" || !monitors.Any(monitor => monitor.AllowsGroup(row.ConversationKey))))
            throw new InvalidDataException("WS_COLLECTOR_TARGET_BLOCKED: 群成员观察仅限已选的监测群。");
        if (request.Messages.Any(row => !purpose.AllowsMessage(row, monitors)) || request.Checkpoints.Any(row => !purpose.AllowsCheckpoint(row)))
            throw new InvalidDataException("WS_COLLECTOR_PURPOSE_BLOCKED: 旧采集包与当前账号用途不符，保留待恢复。");
        // Legacy ordinary packets may contain direct history plus passive
        // directory/event observations. The sidecar ignores forbidden events
        // individually, so a stale event cannot permanently stall direct data.
        if (!purpose.AllowsGroupMonitoring) return;
        foreach (var group in (request.GroupEvents ?? []).GroupBy(item => item.ProfileId))
        {
            var monitor = await GetWsCollectorMonitorAsync(request.AccountId, group.Key, cancellationToken);
            if (group.Any(item => !monitor.AllowsEvent(item))) throw new InvalidDataException("WS_COLLECTOR_TARGET_BLOCKED: 群监控目标未确认，保留待恢复。");
        }
    }

    public async Task<WsAccountDto?> UpsertWsAccountAsync(WsAccountRequest request, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync("api/ws/accounts", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, cancellationToken);
        if (payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("account", out var account))
            return account.Deserialize<WsAccountDto>(JsonOptions);
        return payload.Deserialize<WsAccountDto>(JsonOptions);
    }

    public async Task<WsAccountDto> EnsureWsAccountAsync(WsAccountRequest request, CancellationToken cancellationToken = default, string? missingAccountWorkspaceMode = null)
    {
        if (request.WorkspaceMode is not (null or "ordinary" or "dedicated"))
            throw new InvalidDataException("WS 账号用途必须为普通或专用。");
        void VerifyMode(WsAccountDto account, string? expectedMode)
        {
            if (account.WorkspaceMode is not ("ordinary" or "dedicated")
                || (expectedMode is not null && account.WorkspaceMode != expectedMode))
                throw new InvalidDataException("WS 账号用途不一致，必须使用对应工作台的独立账号。");
        }
        async Task<WsAccountDto?> FindExistingAsync()
        {
            var accounts = await GetWsAccountsAsync(cancellationToken) ?? throw new InvalidDataException("本机账号列表未返回。");
            var existing = accounts.FirstOrDefault(account => string.Equals(account.Id, request.Id, StringComparison.Ordinal));
            if (existing is not null) { VerifyMode(existing, request.WorkspaceMode); return existing; }
            if (accounts.Any(account => string.Equals(account.Id, request.Id, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("本机账号编号大小写不一致，无法确认原账号。");
            return null;
        }

        var existing = await FindExistingAsync();
        if (existing is not null) return existing;

        // A confirmed sidecar row is authoritative. Only when it is absent do
        // we recover purpose from the local index, without changing that purpose.
        if (missingAccountWorkspaceMode is not (null or "ordinary" or "dedicated")
            || (missingAccountWorkspaceMode is not null && request.WorkspaceMode is not null
                && missingAccountWorkspaceMode != request.WorkspaceMode))
            throw new InvalidDataException("本机 WS 账号用途无效或与恢复请求不符。");
        var creationMode = request.WorkspaceMode ?? missingAccountWorkspaceMode;
        WsAccountDto? confirmed;
        try { confirmed = await UpsertWsAccountAsync(request with { WorkspaceMode = creationMode }, cancellationToken); }
        catch (HttpRequestException error) when (error.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            confirmed = await FindExistingAsync();
        }
        if (confirmed is null || !string.Equals(confirmed.Id, request.Id, StringComparison.Ordinal))
            throw new InvalidDataException("本机数据服务未确认原账号编号。");
        VerifyMode(confirmed, creationMode);
        return confirmed;
    }

    public async Task<bool> UpdateWsAccountStatusAsync(string accountId, string status, CancellationToken cancellationToken = default)
    {
        using var response = await http.PatchAsJsonAsync($"api/ws/accounts/{Uri.EscapeDataString(accountId)}", new { Status = status }, JsonOptions, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<WsIngestBatchResponseDto?> IngestWsBatchAsync(WsIngestBatchRequestDto request, CancellationToken cancellationToken = default)
    {
        ValidateWsIngestBatch(request);
        using var response = await PostNativeJsonAsync("api/ws/ingest/batch", request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<WsIngestBatchResponseDto>(JsonOptions, cancellationToken);
    }

    public static void ValidateWsIngestBatch(WsIngestBatchRequestDto? request)
    {
        if (request is null) throw new InvalidDataException("WS 待同步数据无法反序列化。");
        if (string.IsNullOrWhiteSpace(request.AccountId)) throw new InvalidDataException("WS 待同步数据缺少账号标识。");
        if (request.Messages is null) throw new InvalidDataException("WS 待同步数据缺少消息集合。");
        if (request.Checkpoints is null) throw new InvalidDataException("WS 待同步数据缺少会话检查点集合。");
        if (request.GroupEvents is not null && request.GroupEvents.Count > 1000)
            throw new InvalidDataException("WS 群组事件批次超过 1000 条，已保留等待重试。");
        if (request.Messages.Count == 0 && request.Checkpoints.Count == 0 && (request.GroupEvents is null || request.GroupEvents.Count == 0))
            throw new InvalidDataException("WS 待同步数据为空，已保留等待修复，未误报同步成功。");
    }

    public async Task<bool> TryRotateSessionAsync(CancellationToken cancellationToken = default)
    {
        // Loopback tokens are generated per launch and never need remote
        // session rotation. Keep the method for the native WS timer contract.
        await Task.CompletedTask;
        return false;
    }
}
