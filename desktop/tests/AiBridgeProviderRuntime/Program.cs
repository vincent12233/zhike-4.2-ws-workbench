using System.Net;
using System.Net.Http.Json;
using System.Diagnostics;
using System.Text.Json;
using Zhike.Desktop.Services;

var root = Path.Combine(Path.GetTempPath(), $"zhike-ai-provider-{Guid.NewGuid():N}");
var testApiKey = string.Concat("sk-", "teamo-", "test-not-a-secret-placeholder-000000");
Directory.CreateDirectory(root);
try
{
    var handler = new FakeHandler();
    var service = new AiBridgeService(root, new HttpClient(handler) { BaseAddress = new Uri("https://test.invalid") });
    await service.InvokeAsync("saveKey", JsonSerializer.SerializeToElement(new { provider = "teamorouter", apiKey = testApiKey, model = "gpt-5.4-mini" }));
    var result = await service.InvokeAsync("testConnection", JsonSerializer.SerializeToElement(new { provider = "teamorouter" }));
    if (!result.GetProperty("ok").GetBoolean()) throw new Exception("TeamoRouter 回退测试未成功");
    if (result.GetProperty("model").GetString() != "gpt-5.6-sol") throw new Exception("503 后未切换到可用模型");
    if (!result.GetProperty("modelFallback").GetBoolean()) throw new Exception("未标记模型自动回退");
    if (handler.ChatAttemptsByModel.GetValueOrDefault("gpt-5.4-mini") != 2) throw new Exception("原模型未执行一次重试");
    if (handler.ChatAttemptsByModel.GetValueOrDefault("gpt-5.6-sol") != 1) throw new Exception("备用模型请求次数不正确");

    var slowHandler = new DelayedSuccessHandler(TimeSpan.FromMilliseconds(16_200));
    var slowService = new AiBridgeService(
        root,
        new HttpClient(slowHandler) { Timeout = Timeout.InfiniteTimeSpan });
    var slowWatch = Stopwatch.StartNew();
    var slowResult = await slowService.InvokeAsync("request", JsonSerializer.SerializeToElement(new
    {
        requestId = "slow-over-fifteen-seconds",
        input = "验证慢速但有效的 AI 响应"
    }));
    slowWatch.Stop();
    if (slowWatch.Elapsed < TimeSpan.FromSeconds(15)) throw new Exception("慢请求测试没有真实跨过旧版 15 秒边界");
    if (slowResult.GetProperty("text").GetString() != "slow response completed") throw new Exception("超过 15 秒的有效响应未正常返回");

    // Scale the production 45s -> 100s provider deadline down to 450ms ->
    // 1000ms. A response that would have exceeded the retired deadline must
    // complete once, without being cancelled and retried.
    var scaledSlowHandler = new DelayedSuccessHandler(TimeSpan.FromMilliseconds(600));
    var scaledSlowService = new AiBridgeService(
        root,
        new HttpClient(scaledSlowHandler) { Timeout = Timeout.InfiniteTimeSpan },
        requestBudget: TimeSpan.FromMilliseconds(1050),
        providerAttemptBudget: TimeSpan.FromMilliseconds(1000),
        controlBudget: TimeSpan.FromMilliseconds(550));
    var scaledWatch = Stopwatch.StartNew();
    var scaledResult = await scaledSlowService.InvokeAsync("request", JsonSerializer.SerializeToElement(new
    {
        requestId = "scaled-slow-success",
        input = "验证新的单次请求预算"
    }));
    scaledWatch.Stop();
    if (scaledWatch.Elapsed < TimeSpan.FromMilliseconds(450)) throw new Exception("缩放慢请求没有跨过旧版单次预算");
    if (scaledResult.GetProperty("text").GetString() != "slow response completed") throw new Exception("缩放慢请求未正常返回");
    if (scaledSlowHandler.CallCount != 1 || scaledSlowHandler.CancellationObserved) throw new Exception("慢响应被错误取消或重复提交");

    var attemptTimeoutHandler = new DelayedSuccessHandler(TimeSpan.FromSeconds(5));
    var attemptTimeoutService = new AiBridgeService(
        root,
        new HttpClient(attemptTimeoutHandler) { Timeout = Timeout.InfiniteTimeSpan },
        requestBudget: TimeSpan.FromSeconds(2),
        providerAttemptBudget: TimeSpan.FromMilliseconds(250),
        controlBudget: TimeSpan.FromSeconds(1));
    var attemptWatch = Stopwatch.StartNew();
    try
    {
        await attemptTimeoutService.InvokeAsync("request", JsonSerializer.SerializeToElement(new
        {
            requestId = "single-attempt-timeout",
            input = "验证上游超时不盲目重试"
        }));
        throw new Exception("超过单次上游预算的请求没有被取消");
    }
    catch (InvalidOperationException error) when (error.Message.Contains("单次请求超过", StringComparison.Ordinal)) { }
    attemptWatch.Stop();
    if (attemptTimeoutHandler.CallCount != 1) throw new Exception("上游超时后重复提交了同一个慢请求");
    if (!attemptTimeoutHandler.CancellationObserved) throw new Exception("单次上游预算没有传递取消");
    if (attemptWatch.Elapsed > TimeSpan.FromSeconds(1)) throw new Exception("单次上游预算没有及时结束请求");

    var cancelledHandler = new DelayedSuccessHandler(TimeSpan.FromSeconds(5));
    var boundedService = new AiBridgeService(
        root,
        new HttpClient(cancelledHandler) { Timeout = Timeout.InfiniteTimeSpan },
        requestBudget: TimeSpan.FromMilliseconds(350),
        providerAttemptBudget: TimeSpan.FromSeconds(2),
        controlBudget: TimeSpan.FromSeconds(1));
    var cancelWatch = Stopwatch.StartNew();
    try
    {
        await boundedService.InvokeAsync("request", JsonSerializer.SerializeToElement(new
        {
            requestId = "bounded-timeout",
            input = "验证总预算取消"
        }));
        throw new Exception("超过总预算的 AI 请求没有被取消");
    }
    catch (OperationCanceledException)
    {
        // Expected: the service-wide request budget must win before either the
        // page's 115 second deadline or the provider attempt deadline.
    }
    cancelWatch.Stop();
    if (!cancelledHandler.CancellationObserved) throw new Exception("总预算到期后没有传递取消到上游 HTTP 请求");
    if (cancelWatch.Elapsed > TimeSpan.FromSeconds(2)) throw new Exception("总预算取消没有及时结束请求");

    var userCancelHandler = new DelayedSuccessHandler(TimeSpan.FromSeconds(5));
    var userCancelService = new AiBridgeService(
        root,
        new HttpClient(userCancelHandler) { Timeout = Timeout.InfiniteTimeSpan },
        requestBudget: TimeSpan.FromSeconds(4),
        providerAttemptBudget: TimeSpan.FromSeconds(3),
        controlBudget: TimeSpan.FromSeconds(1));
    var userRequest = userCancelService.InvokeAsync("request", JsonSerializer.SerializeToElement(new
    {
        requestId = "explicit-user-cancel",
        input = "验证主动取消"
    }));
    await userCancelHandler.Started.Task.WaitAsync(TimeSpan.FromSeconds(1));
    var cancelResult = await userCancelService.InvokeAsync("cancel", JsonSerializer.SerializeToElement(new { requestId = "explicit-user-cancel" }));
    if (!cancelResult.GetProperty("cancelled").GetBoolean()) throw new Exception("主动取消没有找到对应原生 AI 请求");
    try
    {
        await userRequest;
        throw new Exception("主动取消后 AI 请求仍返回成功");
    }
    catch (OperationCanceledException) { }
    if (!userCancelHandler.CancellationObserved) throw new Exception("主动取消没有传递到上游 HTTP 请求");

    Console.WriteLine($"AI bridge runtime passed: fallback, {slowWatch.Elapsed.TotalSeconds:F1}s response, scaled 100s budget, single-attempt timeout, total timeout, and explicit cancellation");
}
finally
{
    try { Directory.Delete(root, true); } catch { }
}

sealed class DelayedSuccessHandler(TimeSpan delay) : HttpMessageHandler
{
    public bool CancellationObserved { get; private set; }
    public int CallCount { get; private set; }
    public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        CallCount += 1;
        Started.TrySetResult();
        try
        {
            await Task.Delay(delay, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            CancellationObserved = true;
            throw;
        }
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    id = "chat-delayed",
                    choices = new[] { new { message = new { role = "assistant", content = "slow response completed" } } }
                }),
                System.Text.Encoding.UTF8,
                "application/json")
        };
    }
}

sealed class FakeHandler : HttpMessageHandler
{
    public Dictionary<string, int> ChatAttemptsByModel { get; } = new(StringComparer.OrdinalIgnoreCase);
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Get && request.RequestUri?.AbsolutePath.EndsWith("/models", StringComparison.OrdinalIgnoreCase) == true)
            return Task.FromResult(Json(HttpStatusCode.OK, new { @object = "list", data = new[] { new { id = "gpt-5.4-mini" }, new { id = "gpt-5.6-sol" } } }));
        if (request.Method == HttpMethod.Post && request.RequestUri?.AbsolutePath.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase) == true)
        {
            return HandleChatAsync(request, cancellationToken);
        }
        return Task.FromResult(Json(HttpStatusCode.NotFound, new { error = new { message = "not found" } }));
    }

    private async Task<HttpResponseMessage> HandleChatAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        var model = body.GetProperty("model").GetString() ?? "";
        ChatAttemptsByModel[model] = ChatAttemptsByModel.GetValueOrDefault(model) + 1;
        if (model.Equals("gpt-5.4-mini", StringComparison.OrdinalIgnoreCase))
            return Json(HttpStatusCode.ServiceUnavailable, new { error = new { message = "服务暂时无法处理此请求，请稍后重试。", type = "service_unavailable", code = 503 }, trace_id = "test-trace" });
        return Json(HttpStatusCode.OK, new { id = "chat-test", choices = new[] { new { message = new { role = "assistant", content = "OK" } } } });
    }

    private static HttpResponseMessage Json(HttpStatusCode status, object value) => new(status) { Content = new StringContent(JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json") };
}
