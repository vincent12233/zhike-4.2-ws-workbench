using System.Net.Http.Headers;
using System.Net;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;

namespace Zhike.Desktop.Services;

/// <summary>
/// Native GPT service for the 6.0 workbench. Keys are encrypted with Windows
/// DPAPI for the current user and are never returned to the page.
/// The service intentionally implements only the documented, safe AI calls.
/// </summary>
public sealed class AiBridgeService
{
    private const int MaxResponseBytes = 4 * 1024 * 1024;
    private const int MaxOutputCharacters = 100_000;
    private static readonly TimeSpan DefaultRequestBudget = TimeSpan.FromSeconds(105);
    private static readonly TimeSpan DefaultProviderAttemptBudget = TimeSpan.FromSeconds(100);
    private static readonly TimeSpan DefaultControlBudget = TimeSpan.FromSeconds(55);
    private sealed record Provider(string Name, string BaseUrl, string DefaultModel);
    private sealed record AiSendResult(HttpResponseMessage Response, string Model, bool ModelFallback);
    private sealed class ProviderAttemptTimeoutException(string message, Exception innerException)
        : OperationCanceledException(message, innerException);
    private static readonly string[] TeamorouterFallbackModels = { "gpt-5.6-sol", "gpt-5.4", "gpt-5.5", "gpt-6.1-sol", "gpt-5.4-mini" };
    private static readonly IReadOnlyDictionary<string, Provider> Providers = new Dictionary<string, Provider>(StringComparer.OrdinalIgnoreCase)
    {
        ["openai"] = new("OpenAI 官方 API", "https://api.openai.com/v1", "gpt-5-mini"),
        ["teamorouter"] = new("TeamoRouter", "https://api.teamorouter.com/v1", "gpt-5.6-sol"),
    };
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _activeRequests = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http;
    private readonly TimeSpan _requestBudget;
    private readonly TimeSpan _providerAttemptBudget;
    private readonly TimeSpan _controlBudget;

    public AiBridgeService(
        string? root = null,
        HttpClient? httpClient = null,
        TimeSpan? requestBudget = null,
        TimeSpan? providerAttemptBudget = null,
        TimeSpan? controlBudget = null)
    {
        var directory = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6");
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "ai-credentials-winui.json");
        _requestBudget = PositiveBudget(requestBudget ?? DefaultRequestBudget, nameof(requestBudget));
        _providerAttemptBudget = PositiveBudget(providerAttemptBudget ?? DefaultProviderAttemptBudget, nameof(providerAttemptBudget));
        _controlBudget = PositiveBudget(controlBudget ?? DefaultControlBudget, nameof(controlBudget));
        // The page bridge and this service own the total request budget.  A
        // second HttpClient-wide timeout would race that budget and used to
        // abort otherwise healthy TeamoRouter responses at 45 seconds.
        _http = httpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public async Task<JsonElement> InvokeAsync(string action, JsonElement payload, CancellationToken cancellationToken = default)
    {
        return action.ToLowerInvariant() switch
        {
            "status" => await StatusAsync(payload, cancellationToken),
            "savekey" or "save-key" => await SaveKeyAsync(payload, cancellationToken),
            "removekey" or "remove-key" => await RemoveKeyAsync(payload, cancellationToken),
            "testconnection" or "test" => await RunWithBudgetAsync(token => TestConnectionAsync(payload, token), _controlBudget, cancellationToken),
            "listmodels" or "models" => await RunWithBudgetAsync(token => ListModelsAsync(payload, token), _controlBudget, cancellationToken),
            "request" => await RequestAsync(payload, cancellationToken),
            "cancel" => CancelRequest(payload),
            "selectworkspace" => JsonSerializer.SerializeToElement(new { canceled = true, files = Array.Empty<object>() }),
            _ => throw new InvalidOperationException($"unsupported AI action: {action}"),
        };
    }

    private async Task<JsonElement> StatusAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var document = await ReadAsync(cancellationToken);
        var providerKey = CleanProvider(StringValue(payload, "provider"), document.ActiveProvider);
        var provider = Providers[providerKey];
        var key = ReadKey(document, providerKey);
        return JsonSerializer.SerializeToElement(new
        {
            configured = !string.IsNullOrWhiteSpace(key),
            provider = providerKey,
            providerName = provider.Name,
            model = ReadModel(document, providerKey, provider.DefaultModel),
            keyTail = key.Length > 0 ? key[^Math.Min(4, key.Length)..] : "",
            defaultIncludePhone = document.DefaultIncludePhone,
            secureStorage = true,
            configuredProviders = Providers.Keys.ToDictionary(item => item, item => !string.IsNullOrWhiteSpace(ReadKey(document, item)), StringComparer.OrdinalIgnoreCase),
        });
    }

    private async Task<JsonElement> SaveKeyAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var providerKey = CleanProvider(StringValue(payload, "provider"), "openai");
        var document = await ReadAsync(cancellationToken);
        var requestedModel = StringValue(payload, "model");
        var model = string.IsNullOrWhiteSpace(requestedModel) ? ReadModel(document, providerKey, Providers[providerKey].DefaultModel) : ValidateModel(providerKey, requestedModel);
        // Older installations stored gpt-5-mini before the gateway exposed the
        // currently supported model. Transparently migrate that stale choice.
        if (providerKey == "teamorouter" && string.Equals(model, "gpt-5-mini", StringComparison.OrdinalIgnoreCase)) model = Providers[providerKey].DefaultModel;
        var entered = StringValue(payload, "apiKey");
        var existing = document.Providers.TryGetValue(providerKey, out var row) ? row : new CredentialRow();
        if (!string.IsNullOrWhiteSpace(entered))
        {
            if (!entered.StartsWith("sk-", StringComparison.OrdinalIgnoreCase) || entered.Length < 12)
                throw new InvalidOperationException("API Key 格式不正确。");
            if (providerKey == "teamorouter" && !entered.StartsWith("sk-teamo-", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("TeamoRouter API Key 通常以 sk-teamo- 开头。");
            existing.EncryptedKey = Convert.ToBase64String(Dpapi.Protect(Encoding.UTF8.GetBytes(entered)));
        }
        existing.Model = model;
        document.Providers[providerKey] = existing;
        document.ActiveProvider = providerKey;
        document.DefaultIncludePhone = payload.TryGetProperty("defaultIncludePhone", out var include) && include.ValueKind == JsonValueKind.True;
        await WriteAsync(document, cancellationToken);
        return await StatusAsync(JsonSerializer.SerializeToElement(new { provider = providerKey }), cancellationToken);
    }

    private async Task<JsonElement> RemoveKeyAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var providerKey = CleanProvider(StringValue(payload, "provider"), "openai");
        var document = await ReadAsync(cancellationToken);
        document.Providers.Remove(providerKey);
        await WriteAsync(document, cancellationToken);
        return JsonSerializer.SerializeToElement(new { removed = true });
    }

    private async Task<JsonElement> TestConnectionAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var credential = await ResolveCredentialAsync(payload, cancellationToken);
        var sent = await SendAiWithRecoveryAsync(credential, "Reply OK.", 8, cancellationToken);
        using var response = sent.Response;
        var responseText = await ReadContentWithLimitAsync(response, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode, responseText));
        return JsonSerializer.SerializeToElement(new
        {
            ok = true,
            provider = credential.ProviderKey,
            providerName = credential.Provider.Name,
            model = sent.Model,
            requestedModel = credential.Model,
            modelFallback = sent.ModelFallback,
            message = sent.ModelFallback ? $"原模型 {credential.Model} 暂不可用，已自动切换到 {sent.Model}。" : "连接成功。",
        });
    }

    private async Task<JsonElement> ListModelsAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var credential = await ResolveCredentialAsync(payload, cancellationToken);
        var models = await FetchModelsAsync(credential, cancellationToken);
        return JsonSerializer.SerializeToElement(new { models });
    }

    private async Task<JsonElement> RequestAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var requestId = StringValue(payload, "requestId");
        using var budgetTimeout = new CancellationTokenSource(_requestBudget);
        using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, budgetTimeout.Token);
        if (!string.IsNullOrWhiteSpace(requestId))
        {
            _activeRequests.AddOrUpdate(
                requestId,
                requestTimeout,
                (_, previous) =>
                {
                    try { previous.Cancel(); } catch (ObjectDisposedException) { }
                    return requestTimeout;
                });
        }
        try
        {
            var credential = await ResolveCredentialAsync(payload, requestTimeout.Token);
            var input = StringValue(payload, "input");
            if (string.IsNullOrWhiteSpace(input)) throw new InvalidOperationException("请输入要分析的内容。");
            var context = payload.TryGetProperty("context", out var contextValue) ? contextValue.GetRawText() : "";
            var history = payload.TryGetProperty("history", out var historyValue) ? historyValue.GetRawText() : "";
            var instructions = "你是知客客户运营助手。只根据给定内容回答，不编造未知信息；涉及付款、退款、密码、验证码、身份、金融、法律、医疗、价格或交付承诺时只给出人工确认建议，不自动发送。";
            var attachments = BuildAttachments(payload);
            var assistantMode = StringValue(payload, "assistantMode");
            var managementMode = string.Equals(StringValue(payload, "mode"), "manage", StringComparison.OrdinalIgnoreCase);
            if (assistantMode is "code" or "operations") instructions += " 当前模式：" + assistantMode + "，请优先给出结构化、可核对的分析。";
            var prompt = $"用户问题：{input}\n\n最近对话：{history}\n\n{attachments}\n本地上下文：{context}";
            var body = new Dictionary<string, object?> { ["model"] = credential.Model, ["store"] = false, ["max_output_tokens"] = 4096, ["instructions"] = instructions, ["input"] = prompt };
            if (managementMode) { body["tools"] = new[] { ManagementTool() }; body["tool_choice"] = new { type = "function", name = "propose_data_changes" }; }
            var sent = credential.ProviderKey.Equals("teamorouter", StringComparison.OrdinalIgnoreCase)
                ? await SendAiWithRecoveryAsync(credential, prompt, 4096, requestTimeout.Token)
                : new AiSendResult(await SendAsync(credential, "/responses", body, requestTimeout.Token), credential.Model, false);
            using var response = sent.Response;
            var text = await ReadContentWithLimitAsync(response, requestTimeout.Token);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode, text));
            using var document = JsonDocument.Parse(text);
            var output = ExtractOutputText(document.RootElement);
            if (output.Length > MaxOutputCharacters) output = output[..MaxOutputCharacters];
            var responseId = document.RootElement.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "";
            if (managementMode)
            {
                var actions = ExtractManagementActions(document.RootElement);
                return JsonSerializer.SerializeToElement(new { text = string.IsNullOrWhiteSpace(output) ? "已生成管理建议，请确认后执行。" : output, actions, model = sent.Model, requestedModel = credential.Model, modelFallback = sent.ModelFallback, providerName = credential.Provider.Name, responseId });
            }
            if (string.IsNullOrWhiteSpace(output)) throw new InvalidOperationException("AI 没有返回可显示的内容。");
            return JsonSerializer.SerializeToElement(new { text = output, model = sent.Model, requestedModel = credential.Model, modelFallback = sent.ModelFallback, providerName = credential.Provider.Name, responseId });
        }
        catch (OperationCanceledException error) when (budgetTimeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            throw new OperationCanceledException($"AI 请求超过 {_requestBudget.TotalSeconds:0} 秒总预算，已取消，可稍后重试。", error, budgetTimeout.Token);
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(requestId))
            {
                var pair = new KeyValuePair<string, CancellationTokenSource>(requestId, requestTimeout);
                ((ICollection<KeyValuePair<string, CancellationTokenSource>>)_activeRequests).Remove(pair);
            }
        }
    }

    private JsonElement CancelRequest(JsonElement payload)
    {
        var id = StringValue(payload, "requestId");
        CancellationTokenSource? source = null;
        var cancelled = !string.IsNullOrWhiteSpace(id) && _activeRequests.TryGetValue(id, out source);
        if (cancelled) source!.Cancel();
        return JsonSerializer.SerializeToElement(new { cancelled });
    }

    private static string BuildAttachments(JsonElement payload)
    {
        if (!payload.TryGetProperty("attachments", out var list) || list.ValueKind != JsonValueKind.Array) return "附件：无";
        var rows = list.EnumerateArray().Take(10).Select((item, index) =>
        {
            var name = item.TryGetProperty("name", out var n) ? n.ToString() : $"附件 {index + 1}";
            var type = item.TryGetProperty("type", out var t) ? t.ToString() : "text/plain";
            var text = item.TryGetProperty("text", out var body) ? body.ToString() : "";
            return $"--- 附件 {index + 1}：{name} ({type}) ---\n{text[..Math.Min(text.Length, 600_000)]}";
        });
        return "附件内容：\n" + string.Join("\n", rows);
    }

    private static object ManagementTool() => new
    {
        type = "function",
        name = "propose_data_changes",
        description = "提出客户资料和跟进记录变更计划；只输出建议，不直接执行。",
        strict = true,
        parameters = new
        {
            type = "object",
            additionalProperties = false,
            properties = new
            {
                summary = new { type = "string" },
                operations = new { type = "array", maxItems = 100, items = new { type = "object" } }
            },
            required = new[] { "summary", "operations" }
        }
    };

    private static object[] ExtractManagementActions(JsonElement root)
    {
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array) return Array.Empty<object>();
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("type", out var type) || type.GetString() != "function_call") continue;
            if (!item.TryGetProperty("name", out var name) || name.GetString() != "propose_data_changes") continue;
            if (!item.TryGetProperty("arguments", out var args)) continue;
            try
            {
                using var document = JsonDocument.Parse(args.GetString() ?? "{}");
                if (document.RootElement.TryGetProperty("operations", out var operations) && operations.ValueKind == JsonValueKind.Array)
                    return operations.EnumerateArray().Take(100).Select(value => (object)value.Clone()).ToArray();
            }
            catch { }
        }
        return Array.Empty<object>();
    }

    private async Task<Credential> ResolveCredentialAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var document = await ReadAsync(cancellationToken);
        var providerKey = CleanProvider(StringValue(payload, "provider"), document.ActiveProvider);
        var key = StringValue(payload, "apiKey");
        if (string.IsNullOrWhiteSpace(key)) key = ReadKey(document, providerKey);
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException($"请先设置 {Providers[providerKey].Name} API Key。");
        var requestedModel = StringValue(payload, "model");
        var model = string.IsNullOrWhiteSpace(requestedModel) ? ReadModel(document, providerKey, Providers[providerKey].DefaultModel) : ValidateModel(providerKey, requestedModel);
        return new Credential(providerKey, Providers[providerKey], key, model);
    }

    private async Task<HttpResponseMessage> SendAsync(Credential credential, string path, object body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{credential.Provider.BaseUrl}{path}")
        {
            Content = new StringContent(JsonSerializer.Serialize(body, _json), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.ApiKey);
        return await SendProviderAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
    }

    private async Task<HttpResponseMessage> SendProviderAsync(
        HttpRequestMessage request,
        HttpCompletionOption completionOption,
        CancellationToken cancellationToken)
    {
        using var attemptTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        attemptTimeout.CancelAfter(_providerAttemptBudget);
        try
        {
            return await _http.SendAsync(request, completionOption, attemptTimeout.Token);
        }
        catch (OperationCanceledException error) when (!cancellationToken.IsCancellationRequested && attemptTimeout.IsCancellationRequested)
        {
            throw new ProviderAttemptTimeoutException(
                $"AI 单次请求超过 {_providerAttemptBudget.TotalSeconds:0} 秒，已取消本次尝试。",
                error);
        }
    }

    // TeamoRouter currently exposes the OpenAI-compatible chat endpoint as the
    // reliable desktop route; its Responses endpoint may return a generic 400
    // even when the key and model are valid. Keep OpenAI on Responses while
    // routing TeamoRouter through chat completions and normalize the response.
    private async Task<HttpResponseMessage> SendAiAsync(Credential credential, string prompt, int maxTokens, CancellationToken cancellationToken)
    {
        var body = new
        {
            model = credential.Model,
            temperature = 0,
            max_tokens = maxTokens,
            messages = new[] { new { role = "user", content = prompt } },
        };
        return await SendAsync(credential, "/chat/completions", body, cancellationToken);
    }

    private async Task<AiSendResult> SendAiWithRecoveryAsync(Credential credential, string prompt, int maxTokens, CancellationToken cancellationToken)
    {
        var first = await SendAiWithRetryAsync(credential, prompt, maxTokens, cancellationToken);
        if (first.IsSuccessStatusCode || !credential.ProviderKey.Equals("teamorouter", StringComparison.OrdinalIgnoreCase) || !IsTransient(first.StatusCode))
            return new(first, credential.Model, false);

        first.Dispose();
        string[] available;
        try { available = await FetchModelsAsync(credential, cancellationToken); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { available = Array.Empty<string>(); }
        var fallback = TeamorouterFallbackModels.FirstOrDefault(candidate =>
            !candidate.Equals(credential.Model, StringComparison.OrdinalIgnoreCase) &&
            (available.Length == 0 || available.Contains(candidate, StringComparer.OrdinalIgnoreCase)));
        if (string.IsNullOrWhiteSpace(fallback))
        {
            // Keep the final response shape predictable for the caller when
            // the provider is unavailable and no catalog can be read.
            var final = await SendAiWithRetryAsync(credential, prompt, maxTokens, cancellationToken);
            return new(final, credential.Model, false);
        }
        var alternate = credential with { Model = fallback };
        var recovered = await SendAiWithRetryAsync(alternate, prompt, maxTokens, cancellationToken);
        return new(recovered, fallback, recovered.IsSuccessStatusCode);
    }

    private async Task<HttpResponseMessage> SendAiWithRetryAsync(Credential credential, string prompt, int maxTokens, CancellationToken cancellationToken)
    {
        HttpResponseMessage? response = null;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            // A provider timeout means the request was still generating, not
            // that the model rejected it. Retrying the same slow request used
            // to spend 45 seconds twice and guaranteed a 90-second failure.
            // Only an actual transient HTTP response is safe to retry here.
            response = await SendAiAsync(credential, prompt, maxTokens, cancellationToken);
            if (response.IsSuccessStatusCode || !IsTransient(response.StatusCode) || attempt == 1) return response;
            response.Dispose();
            await Task.Delay(TimeSpan.FromMilliseconds(350), cancellationToken);
        }
        return response!;
    }

    private async Task<string[]> FetchModelsAsync(Credential credential, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{credential.Provider.BaseUrl}/models");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.ApiKey);
        using var response = await SendProviderAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var text = await ReadContentWithLimitAsync(response, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode, text));
        using var document = JsonDocument.Parse(text);
        return document.RootElement.TryGetProperty("data", out var rows) && rows.ValueKind == JsonValueKind.Array
            ? rows.EnumerateArray()
                .Select(row => row.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "")
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Where(id => !credential.ProviderKey.Equals("teamorouter", StringComparison.OrdinalIgnoreCase) || id.StartsWith("gpt", StringComparison.OrdinalIgnoreCase))
                .OrderBy(id => id, StringComparer.OrdinalIgnoreCase)
                .ToArray()
            : Array.Empty<string>();
    }

    private static bool IsTransient(HttpStatusCode status) => status is HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;

    private static TimeSpan PositiveBudget(TimeSpan value, string parameterName)
    {
        if (value <= TimeSpan.Zero || value == Timeout.InfiniteTimeSpan)
            throw new ArgumentOutOfRangeException(parameterName, "AI timeout budget must be positive and finite.");
        return value;
    }

    private static async Task<T> RunWithBudgetAsync<T>(
        Func<CancellationToken, Task<T>> operation,
        TimeSpan budget,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(budget);
        return await operation(timeout.Token);
    }

    private static async Task<string> ReadContentWithLimitAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength is > MaxResponseBytes)
            throw new InvalidOperationException("AI 服务响应超过 4 MB，已拒绝读取。");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        var total = 0;
        while (true)
        {
            var read = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length), cancellationToken);
            if (read == 0) break;
            total += read;
            if (total > MaxResponseBytes)
                throw new InvalidOperationException("AI 服务响应超过 4 MB，已拒绝读取。");
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private async Task<CredentialDocument> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path)) return new();
            await using var stream = File.OpenRead(_path);
            var document = await JsonSerializer.DeserializeAsync<CredentialDocument>(stream, _json, cancellationToken) ?? new();
            return document;
        }
        catch { return new(); }
        finally { _gate.Release(); }
    }

    private async Task WriteAsync(CredentialDocument value, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(value, _json), cancellationToken);
            File.Move(temporary, _path, true);
        }
        finally { _gate.Release(); }
    }

    private static string ReadKey(CredentialDocument document, string provider)
    {
        try
        {
            if (!document.Providers.TryGetValue(provider, out var row) || string.IsNullOrWhiteSpace(row.EncryptedKey)) return "";
            return Encoding.UTF8.GetString(Dpapi.Unprotect(Convert.FromBase64String(row.EncryptedKey)));
        }
        catch { return ""; }
    }

    private static string ReadModel(CredentialDocument document, string provider, string fallback)
        => document.Providers.TryGetValue(provider, out var row) && !string.IsNullOrWhiteSpace(row.Model) ? row.Model! : fallback;

    private static string CleanProvider(string? value, string? fallback)
        => Providers.ContainsKey(value ?? "") ? value!.ToLowerInvariant() : (Providers.ContainsKey(fallback ?? "") ? fallback!.ToLowerInvariant() : "openai");

    private static string ValidateModel(string provider, string? value)
    {
        var model = string.IsNullOrWhiteSpace(value) ? Providers[provider].DefaultModel : value.Trim()[..Math.Min(80, value.Trim().Length)];
        if (provider == "teamorouter" && !model.StartsWith("gpt", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("当前模型不支持 TeamoRouter 的 GPT 兼容接口，请更换 GPT 系列模型。");
        return model;
    }

    private static string ExtractOutputText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var direct) && direct.ValueKind == JsonValueKind.String) return direct.GetString() ?? "";
        if (root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array)
        {
            var first = choices.EnumerateArray().FirstOrDefault();
            if (first.ValueKind == JsonValueKind.Object && first.TryGetProperty("message", out var message) && message.TryGetProperty("content", out var content))
                return content.ValueKind == JsonValueKind.String ? content.GetString() ?? "" : content.ToString();
        }
        var builder = new StringBuilder();
        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            foreach (var item in output.EnumerateArray())
                if (item.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
                    foreach (var part in content.EnumerateArray())
                        if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String) builder.Append(text.GetString());
        return builder.ToString();
    }

    private static string FriendlyError(string provider, int status, string responseBody = "")
    {
        var name = Providers[provider].Name;
        var message = "";
        var code = "";
        var trace = "";
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            if (document.RootElement.TryGetProperty("error", out var error))
            {
                if (error.TryGetProperty("message", out var messageValue)) message = messageValue.GetString() ?? "";
                if (error.TryGetProperty("code", out var codeValue)) code = codeValue.ToString();
            }
            if (document.RootElement.TryGetProperty("trace_id", out var traceValue)) trace = traceValue.GetString() ?? "";
        }
        catch { }
        if (status is 401 or 403) return $"{name} API Key 无效或已被删除。";
        if (status == 402 || code.Contains("insufficient", StringComparison.OrdinalIgnoreCase)) return $"{name} 额度不足，请先检查账户余额。";
        if (status == 400 && (code.Contains("model", StringComparison.OrdinalIgnoreCase) || message.Contains("model", StringComparison.OrdinalIgnoreCase))) return $"{name} 模型不可用：{message.Trim()} 请点击“获取可用模型”后选择目录中的 GPT 模型。";
        if (status is 502 or 503 or 504)
        {
            var detail = string.IsNullOrWhiteSpace(message) ? "服务端暂时无法处理请求" : message.Trim();
            var traceText = string.IsNullOrWhiteSpace(trace) ? "" : $" 追踪号：{trace}";
            return $"{name} 暂时不可用（{status}）。已自动重试并检查可用模型；服务端提示：{detail}{traceText}";
        }
        return string.IsNullOrWhiteSpace(message) ? $"{name} 请求失败（{status}）。" : $"{name} 请求失败（{status}）：{message.Trim()}";
    }

    private static string StringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined ? value.ToString().Trim() : "";

    private sealed class CredentialDocument
    {
        public string ActiveProvider { get; set; } = "openai";
        public bool DefaultIncludePhone { get; set; }
        public Dictionary<string, CredentialRow> Providers { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }
    private sealed class CredentialRow
    {
        public string? EncryptedKey { get; set; }
        public string? Model { get; set; }
    }
    private sealed record Credential(string ProviderKey, Provider Provider, string ApiKey, string Model);

    private static class Dpapi
    {
        [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptProtectData(ref Blob dataIn, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptUnprotectData(ref Blob dataIn, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr handle);

        public static byte[] Protect(byte[] value) => Transform(value, encrypt: true);
        public static byte[] Unprotect(byte[] value) => Transform(value, encrypt: false);

        private static byte[] Transform(byte[] value, bool encrypt)
        {
            var handle = GCHandle.Alloc(value, GCHandleType.Pinned);
            try
            {
                var input = new Blob { Length = value.Length, Data = handle.AddrOfPinnedObject() };
                var output = new Blob();
                var ok = encrypt
                    ? CryptProtectData(ref input, "Zhike AI credential", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref output)
                    : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref output);
                if (!ok) throw new CryptographicException(Marshal.GetLastWin32Error());
                try
                {
                    var result = new byte[output.Length];
                    Marshal.Copy(output.Data, result, 0, output.Length);
                    return result;
                }
                finally { if (output.Data != IntPtr.Zero) LocalFree(output.Data); }
            }
            finally { handle.Free(); }
        }
    }
}
