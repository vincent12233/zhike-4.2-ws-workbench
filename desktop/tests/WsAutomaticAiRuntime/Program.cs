using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zhike.Desktop.Services;

// Real production coordinator + native adapter; all external provider HTTP is
// replaced by this handler. The ledger is the real disposable loopback sidecar.
if (args.Length != 6 || !Uri.TryCreate(args[0], UriKind.Absolute, out var origin) || !origin.IsLoopback)
    throw new InvalidOperationException("Synthetic loopback ledger arguments required.");
var root = Path.Combine(Path.GetTempPath(), "zhike-automatic-ai-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    using var ledgerHttp = new HttpClient { BaseAddress = origin };
    ledgerHttp.DefaultRequestHeaders.Add("X-Zhike-Api-Token", args[1]);
    ledgerHttp.DefaultRequestHeaders.Add("X-Zhike-Native-Token", args[5]);
    async Task<JsonElement> Ledger(object body, CancellationToken token)
    {
        using var response = await ledgerHttp.PostAsJsonAsync("api/ws/ai-automation/attempts", body, token);
        var data = await response.Content.ReadFromJsonAsync<JsonElement>(token);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(data.GetProperty("code").GetString());
        return data;
    }
    var fake = new ProviderHandler();
    var service = new AiBridgeService(root, new HttpClient(fake));
    await service.InvokeAsync("saveKey", JsonSerializer.SerializeToElement(new { provider = "openai", apiKey = "sk-isolated-not-a-real-key-000000", model = "gpt-5.4-mini-2026-03-17" }));
    static JsonElement HeldPermit(string attemptId) => JsonSerializer.SerializeToElement(new { attemptId, input = "SYNTHETIC_AUTHORIZED_CHAT",
        quote = new { id = "openai-gpt54mini-synthetic", provider = "openai", model = "gpt-5.4-mini-2026-03-17", endpoint = "https://api.openai.com/v1/responses",
            expiresAt = DateTimeOffset.UtcNow.AddHours(1), maxOutputTokens = 4096 } });
    try { await service.RequestWsAutomaticAsync(HeldPermit("missing-guard"), null!); throw new Exception("Native send accepted an absent dispatch callback."); }
    catch (ArgumentNullException) { }
    if (fake.Calls != 0) throw new Exception("Missing dispatch callback reached provider.");
    // Hold the real coordinator at either ledger await. Cancellation must be
    // registered before reserve, and account A -> B -> A must invalidate it.
    foreach (var stage in new[] { "reserve", "dispatch" })
    foreach (var accountSwitch in new[] { false, true })
    {
        var reached = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var active = args[2]; long epoch = 1; var dispatches = 0;
        var requestId = $"race-{stage}-{accountSwitch}";
        async Task<JsonElement> HeldLedger(object body, CancellationToken token)
        {
            var action = JsonSerializer.SerializeToElement(body).GetProperty("action").GetString();
            if (action == "dispatch") dispatches++;
            if (action == stage) { reached.TrySetResult(true); await release.Task; }
            return HeldPermit("synthetic-held");
        }
        var pending = WsAutomaticAiCoordinator.ExecuteAsync(service, HeldLedger, () => active,
            JsonSerializer.SerializeToElement(new { accountId = args[2], conversationId = "authorized-chat", jobId = "held-job", leaseToken = "held-lease", requestId }),
            accountEpoch: () => epoch);
        await reached.Task.WaitAsync(TimeSpan.FromSeconds(5));
        if (accountSwitch) { active = "other-account"; epoch++; active = args[2]; epoch++; }
        else
        {
            var cancelled = await service.InvokeAsync("cancel", JsonSerializer.SerializeToElement(new { requestId }));
            if (!cancelled.GetProperty("cancelled").GetBoolean()) throw new Exception("Cancel was lost before provider registration.");
        }
        release.TrySetResult(true);
        try { await pending; throw new Exception("Stale native operation continued."); }
        catch (OperationCanceledException) when (!accountSwitch) { }
        catch (InvalidOperationException error) when (accountSwitch && error.Message.Contains("账号已切换")) { }
        if (fake.Calls != 0 || dispatches != (stage == "dispatch" ? 1 : 0)) throw new Exception("Stale operation reached a later stage.");
    }
    // Credential locking must happen before dispatch. Account/cancellation or
    // ledger state can change while the real storage semaphore is held.
    var credentialGate = (SemaphoreSlim)typeof(AiBridgeService).GetField("_gate", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(service)!;
    foreach (var accountSwitch in new[] { false, true })
    {
        await credentialGate.WaitAsync();
        var requestId = $"credential-race-{accountSwitch}"; long epoch = 1;
        var reserves = 0; var dispatches = 0; var finishes = 0;
        Task<JsonElement> CredentialLedger(object body, CancellationToken token)
        {
            var action = JsonSerializer.SerializeToElement(body).GetProperty("action").GetString();
            if (action == "reserve") reserves++;
            if (action == "dispatch") dispatches++;
            if (action == "finish") finishes++;
            return Task.FromResult(HeldPermit("credential-held"));
        }
        var pending = WsAutomaticAiCoordinator.ExecuteAsync(service, CredentialLedger, () => args[2],
            JsonSerializer.SerializeToElement(new { accountId = args[2], conversationId = "authorized-chat", jobId = "held-job", leaseToken = "held-lease", requestId }),
            accountEpoch: () => epoch);
        if (reserves != 1 || dispatches != 0 || pending.IsCompleted) throw new Exception("Dispatch ran before the blocked credential read completed.");
        if (accountSwitch) epoch += 2; // A -> B -> A retains the name but not ownership.
        else await service.InvokeAsync("cancel", JsonSerializer.SerializeToElement(new { requestId }));
        credentialGate.Release();
        try { await pending; throw new Exception("Stale credential operation sent."); }
        catch (OperationCanceledException) when (!accountSwitch) { }
        catch (InvalidOperationException error) when (accountSwitch && error.Message.Contains("账号已切换")) { }
        if (fake.Calls != 0 || reserves != 1 || dispatches != 0 || finishes != 1) throw new Exception("Credential wait bypassed the final send guard or reserved twice.");
    }
    foreach (var change in new[] { "pause", "revoke", "history-change" })
    {
        await credentialGate.WaitAsync();
        var reserves = 0; var dispatches = 0; var finishes = 0;
        string? changedCode = null;
        Task<JsonElement> ChangedLedger(object body, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var action = JsonSerializer.SerializeToElement(body).GetProperty("action").GetString();
            if (action == "reserve") reserves++;
            if (action == "finish") finishes++;
            if (action == "dispatch")
            {
                dispatches++;
                if (changedCode is not null) throw new InvalidOperationException(changedCode);
            }
            return Task.FromResult(HeldPermit("credential-" + change));
        }
        var pending = WsAutomaticAiCoordinator.ExecuteAsync(service, ChangedLedger, () => args[2],
            JsonSerializer.SerializeToElement(new { accountId = args[2], conversationId = "authorized-chat", jobId = "held-job", leaseToken = "held-lease", requestId = "credential-" + change }));
        if (reserves != 1 || dispatches != 0 || pending.IsCompleted) throw new Exception("Fixture did not hold dispatch behind the credential lock.");
        // These are the real sidecar dispatch rejection codes. State changes
        // happen after reservation, while native credential access is blocked.
        changedCode = change == "history-change" ? "WS_HISTORY_STALE" : "AI_AUTHORIZATION_PAUSED";
        credentialGate.Release();
        try { await pending; throw new Exception("Changed ledger authorization sent a model request."); }
        catch (InvalidOperationException error) when (error.Message == changedCode) { }
        if (fake.Calls != 0 || reserves != 1 || dispatches != 1 || finishes != 1)
            throw new Exception("Late ledger rejection reached provider or reused the lease.");
    }
    var payload = JsonSerializer.SerializeToElement(new { accountId = args[2], conversationId = "authorized-chat", jobId = args[3], leaseToken = args[4],
        requestId = "automatic-isolated", input = "FORGED_OTHER_ACCOUNT_TEXT", provider = "teamorouter", model = "unapproved-model" });
    var result = await WsAutomaticAiCoordinator.ExecuteAsync(service, Ledger, () => args[2], payload);
    if (fake.Calls != 1 || result.GetProperty("automatic").GetBoolean() != true) throw new Exception("Native automatic call did not complete exactly once.");
    try { await WsAutomaticAiCoordinator.ExecuteAsync(service, Ledger, () => args[2], payload); throw new Exception("Replayed lease sent again."); }
    catch (InvalidOperationException error) when (error.Message == "AI_ATTEMPT_ALREADY_RESERVED") { }
    if (fake.Calls != 1) throw new Exception("Replayed authorization reached provider.");
    Console.WriteLine(result.GetRawText());
}
finally { Directory.Delete(root, true); }

sealed class ProviderHandler : HttpMessageHandler
{
    public int Calls { get; private set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        if (request.RequestUri?.AbsoluteUri != "https://api.openai.com/v1/responses") throw new Exception("Unapproved endpoint.");
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
        var value = body.RootElement;
        if (value.GetProperty("model").GetString() != "gpt-5.4-mini-2026-03-17" || value.GetProperty("max_output_tokens").GetInt32() != 4096 ||
            value.GetProperty("service_tier").GetString() != "default" || value.GetProperty("store").GetBoolean() || value.TryGetProperty("tools", out _)) throw new Exception("Unbounded provider request.");
        var prompt = value.GetProperty("input").GetString() ?? "";
        if (!prompt.Contains("SYNTHETIC_AUTHORIZED_CHAT") || prompt.Contains("FORGED_OTHER_ACCOUNT_TEXT") || prompt.Contains("SYNTHETIC_OTHER_ACCOUNT")) throw new Exception("Scope was not reconstructed by server.");
        var text = JsonSerializer.Serialize(new { summary = "Synthetic scoped analysis", confidence = .9,
            profileFacts = new { occupation = new { value = "Synthetic engineer", state = "known", confidence = .9, evidence = "I am an engineer", sourceRole = "customer" } } });
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { id = "synthetic-response", status = "completed", model = "gpt-5.4-mini-2026-03-17",
            output_text = text, usage = new { input_tokens = 100, output_tokens = 20 } }) };
    }
}
