using System.Net;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

var queueRoot = Path.Combine(Path.GetTempPath(), $"zhike-ws-queue-runtime-{Guid.NewGuid():N}");
Directory.CreateDirectory(queueRoot);
try
{
    const string accountId = "account-non-default-runtime";
    const string conversationKey = "conversation-runtime-42";
    const string originalBody = "第一行  保留空格\nsecond line\n第三行";
    var observedAt = new DateTimeOffset(2026, 11, 13, 4, 40, 0, TimeSpan.Zero);
    var request = new WsIngestBatchRequestDto(
        "zhike.ws.v1",
        "native-webview2",
        accountId,
        observedAt,
        "read-history",
        [new WsMessageEnvelopeDto("native-webview2", accountId, conversationKey, "message-runtime-1", observedAt.AddMinutes(-2), "outgoing", originalBody, false, observedAt, "cursor-runtime-1", 17, "上午10:38, 2026年11月4日", "whatsapp-preamble", "wa-row-legacyruntime", "class-message-out")],
        [new WsCheckpointDto(accountId, conversationKey, "cursor-runtime-checkpoint", "fingerprint-runtime", observedAt, "运行时客户", "preview", observedAt.ToString("O"), 0, "read-history", true, "completed", 1, 4, 0)]);

    var queue = new LocalQueue(queueRoot);
    await queue.EnqueueAsync("api/ws/ingest/batch", request);
    var queued = (await queue.PeekAsync()).Single();
    using (var queueDocument = JsonDocument.Parse(queued.PayloadJson))
    {
        if (!queueDocument.RootElement.TryGetProperty("accountId", out var camelAccount) || camelAccount.GetString() != accountId)
            throw new Exception("queue payload was not serialized with the Web camelCase contract");
        if (queueDocument.RootElement.TryGetProperty("AccountId", out _))
            throw new Exception("queue payload unexpectedly used PascalCase");
    }

    var restored = LocalQueue.DeserializePayload<WsIngestBatchRequestDto>(queued.PayloadJson)
        ?? throw new Exception("queue payload did not deserialize");
    if (restored.AccountId != accountId) throw new Exception("non-default account was lost");
    if (restored.Messages.Count != 1 || restored.Messages[0].Body != originalBody) throw new Exception("message body changed in queue roundtrip");
    if (restored.Messages[0].TimestampText != "上午10:38, 2026年11月4日" || restored.Messages[0].TimestampSource != "whatsapp-preamble") throw new Exception("message timestamp metadata changed in queue roundtrip");
    if (restored.Messages[0].LegacyExternalMessageId != "wa-row-legacyruntime" || restored.Messages[0].DirectionSource != "class-message-out") throw new Exception("direction alias/evidence changed in queue roundtrip");
    if (restored.Checkpoints.Count != 1 || restored.Checkpoints[0].Coverage != "read-history") throw new Exception("checkpoint coverage was lost");
    if (restored.Checkpoints[0].DirectionVersion != 4 || restored.Checkpoints[0].DirectionUnresolvedCount != 0) throw new Exception("direction checkpoint version was lost");

    var handler = new CaptureHandler();
    using var http = new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:48080/") };
    var api = new ApiClient(http);
    try
    {
        await api.IngestWsBatchAsync(restored);
        throw new Exception("missing native authority reached HTTP");
    }
    catch (InvalidOperationException)
    {
        if (handler.RequestCount != 0) throw new Exception("unauthorized packet reached HTTP");
    }
    // Test-only setup of the internal host capability; no public bridge setter.
    var nativeToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    typeof(ApiClient).GetMethod("ConfigureNativeWriteAuthority", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
        .Invoke(api, [nativeToken]);
    var response = await api.IngestWsBatchAsync(restored);
    if (response?.Accepted != 1 || handler.RequestCount != 1) throw new Exception("API ingest roundtrip did not complete once");
    if (handler.NativeToken != nativeToken) throw new Exception("typed native request did not receive host authority");
    if (http.DefaultRequestHeaders.Contains("X-Zhike-Native-Token")) throw new Exception("native authority leaked into default headers");
    using var apiDocument = JsonDocument.Parse(handler.Body ?? throw new Exception("API request body missing"));
    var apiRoot = apiDocument.RootElement;
    if (apiRoot.GetProperty("accountId").GetString() != accountId) throw new Exception("API request lost the account");
    if (apiRoot.GetProperty("messages")[0].GetProperty("body").GetString() != originalBody) throw new Exception("API request changed the message body");
    if (apiRoot.GetProperty("messages")[0].GetProperty("timestampText").GetString() != "上午10:38, 2026年11月4日") throw new Exception("API request lost timestamp metadata");
    if (apiRoot.GetProperty("messages")[0].GetProperty("legacyExternalMessageId").GetString() != "wa-row-legacyruntime" || apiRoot.GetProperty("messages")[0].GetProperty("directionSource").GetString() != "class-message-out") throw new Exception("API request lost direction alias/evidence");
    if (apiRoot.GetProperty("checkpoints")[0].GetProperty("coverage").GetString() != "read-history") throw new Exception("API request lost checkpoint coverage");
    if (apiRoot.GetProperty("checkpoints")[0].GetProperty("directionVersion").GetInt32() != 4) throw new Exception("API request lost direction checkpoint version");

    var invalid = new WsIngestBatchRequestDto("zhike.ws.v1", "native-webview2", "", observedAt, "read-history", [], []);
    try
    {
        await api.IngestWsBatchAsync(invalid);
        throw new Exception("invalid empty batch was sent as success");
    }
    catch (InvalidDataException)
    {
        if (handler.RequestCount != 1) throw new Exception("invalid empty batch reached the API");
        await queue.MarkFailureAsync(queued.Id, new InvalidDataException("invalid queue payload"));
        var preserved = (await queue.PeekAsync()).SingleOrDefault(item => item.Id == queued.Id);
        if (preserved is null || preserved.Attempts != 1) throw new Exception("failed batch was removed instead of retained for retry");
    }

    var adapter = new LegacyApiAdapter(api);
    foreach (var route in new[] { "/api/ws/ingest/batch", "/api/ws/ingest/batch/?accountId=fake", "/API/WS/INGEST/BATCH", "/api/ws/ai-automation/attempts" })
    {
        var blocked = await adapter.SendAsync("synthetic-renderer", route, HttpMethod.Post, JsonSerializer.SerializeToElement(new { source = "desktop-webview2" }));
        if (blocked.Ok || blocked.ErrorCode != "WS_NATIVE_AUTHORITY_REQUIRED" || handler.RequestCount != 1)
            throw new Exception("generic legacy bridge reached a native-only route");
    }
    await api.SendJsonAsync("api/ws/accounts", HttpMethod.Get, headers: new Dictionary<string, string> { ["X-Zhike-Native-Token"] = nativeToken });
    if (handler.NativeToken is not null) throw new Exception("generic API request forwarded native authority");
    var retryQueue = new LocalQueue(Path.Combine(queueRoot, "account-retries"));
    var retired = restored with { AccountId = "retired", Scope = "background-collector" };
    await retryQueue.EnqueueAsync("api/ws/ingest/batch", retired);
    await retryQueue.EnqueueAsync("api/ws/ingest/batch", retired);
    await retryQueue.EnqueueAsync("api/ws/ingest/batch", restored);
    var synced = new List<string>();
    await WsIngestQueue.FlushAsync(retryQueue, api, (batch, _) => synced.Add(batch.AccountId));
    var remaining = await retryQueue.PeekAsync();
    if (!synced.SequenceEqual([accountId]) || remaining.Count != 2 || remaining[0].Attempts != 1 || remaining[1].Attempts != 0)
        throw new Exception("a retired account blocked another account or reordered its pending checkpoints");
    await retryQueue.EnqueueAsync("api/ws/ingest/batch", restored);
    handler.Offline = true;
    await WsIngestQueue.FlushAsync(retryQueue, api, (batch, _) => synced.Add(batch.AccountId));
    remaining = await retryQueue.PeekAsync();
    if (remaining.Count != 3 || remaining[0].Attempts != 2 || remaining.Skip(1).Any(item => item.Attempts != 0) || synced.Count != 1)
        throw new Exception("a service outage should retain all later packets without retrying each account");
    Console.WriteLine("WS queue Web JSON/API roundtrip passed: native authority, bridge exclusion, account, bidirectional evidence, checkpoint coverage and original body preserved");
}
finally
{
    try { Directory.Delete(queueRoot, true); } catch { }
}

sealed class CaptureHandler : HttpMessageHandler
{
    public int RequestCount { get; private set; }
    public string? Body { get; private set; }
    public string? NativeToken { get; private set; }
    public bool Offline { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestCount += 1;
        NativeToken = request.Headers.TryGetValues("X-Zhike-Native-Token", out var values) ? values.Single() : null;
        Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        if (Offline) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        if (request.Method == HttpMethod.Get && request.RequestUri?.AbsolutePath == "/api/ws/accounts")
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"accounts\":[]}", Encoding.UTF8, "application/json") };
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"accepted\":1,\"deduplicated\":0,\"messageIds\":[\"message-runtime-1\"],\"processedAt\":\"2026-11-13T04:40:00Z\"}", Encoding.UTF8, "application/json"),
        };
    }
}
