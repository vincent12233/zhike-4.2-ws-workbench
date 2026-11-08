using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Zhike.Contracts;

namespace Zhike.Worker.Providers;

public sealed class AiAnalysisUnavailableException(string message)
    : AiProviderException(message, AiProviderFailureKind.Unavailable, true);

public sealed class AiAnalysisSkippedException(string message)
    : InvalidOperationException(message);

/// <summary>
/// OpenAI/TeamoRouter-compatible provider. Prompt and parser stay together so
/// gateway responses cannot bypass the profile state/evidence contract.
/// </summary>
public sealed class HttpAiAnalysisProvider(HttpClient http, IConfiguration configuration) : IAiAnalysisProvider
{
    private const double MinimumConfidence = 0.60;
    private static readonly string[] ProfileFields =
    [
        "preferred_name", "age", "gender", "occupation", "work_context",
        "is_investor", "investment_years", "holdings", "investment_habits",
        "investment_preferences", "family_context", "life_interests", "future_plans",
    ];
    private static readonly Regex SensitiveText = new(
        "password|passcode|token|cookie|secret|验证码|校验码|密码|银行卡|收款码|二维码|身份证|护照|付款|退款|金融承诺|法律承诺|医疗建议|价格保证|交付保证",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public async Task<AiAnalysisResult> AnalyzeAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var messageId = String(payload, "messageId");
        var body = String(payload, "body", "text");
        var accountId = String(payload, "accountId");
        var conversationId = String(payload, "conversationId");
        if (string.IsNullOrWhiteSpace(body))
            throw new AiAnalysisSkippedException("消息没有可分析的文本内容");

        var baseUrl = (configuration["ZHike:AIBaseUrl"] ?? string.Empty).TrimEnd('/');
        var apiKey = ReadSecret(configuration["ZHike:AIKey"], configuration["ZHike:AIKeyFile"]);
        var model = configuration["ZHike:AIModel"] ?? "gpt-5-mini";
        if (!string.IsNullOrWhiteSpace(baseUrl) && !IsAllowedEndpoint(baseUrl))
            throw new AiProviderException("AI 服务地址必须使用 HTTPS；仅允许回环地址使用 HTTP。", AiProviderFailureKind.Transport, false);
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(apiKey))
            throw new AiAnalysisUnavailableException("AI 服务尚未配置；本条消息会保留待分析，配置后自动继续。");

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = BuildPrompt(payload) },
                new { role = "user", content = JsonSerializer.Serialize(new { conversationId, messageId, text = body, context = Context(payload) }) },
            },
        }), Encoding.UTF8, "application/json");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(35));
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AiAnalysisTimeoutException("AI 服务响应超时。");
        }
        catch (HttpRequestException error)
        {
            throw new AiProviderException("AI 服务网络连接失败。", AiProviderFailureKind.Transport, true, error);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var kind = response.StatusCode == HttpStatusCode.TooManyRequests
                    ? AiProviderFailureKind.Quota
                    : (int)response.StatusCode >= 500 || response.StatusCode == HttpStatusCode.RequestTimeout
                        ? AiProviderFailureKind.Transport
                        : AiProviderFailureKind.Unknown;
                if (kind == AiProviderFailureKind.Quota)
                    throw new AiAnalysisQuotaException("AI 服务额度或请求频率受限。", null);
                throw new AiProviderException("AI 服务暂时不可用。", kind, kind == AiProviderFailureKind.Transport);
            }

            string responseText;
            try { responseText = await response.Content.ReadAsStringAsync(cancellationToken); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            { throw new AiAnalysisTimeoutException("读取 AI 响应超时。"); }

            JsonDocument envelope;
            try { envelope = JsonDocument.Parse(responseText); }
            catch (JsonException error) { throw new AiAnalysisSchemaException("AI 返回不是有效 JSON。", error); }
            using (envelope)
            {
                var jsonText = ExtractText(envelope.RootElement);
                JsonDocument resultDocument;
                try { resultDocument = JsonDocument.Parse(jsonText); }
                catch (JsonException error) { throw new AiAnalysisSchemaException("AI 返回的内容不是结构化 JSON。", error); }
                using (resultDocument)
                {
                    return ParseResult(resultDocument.RootElement, messageId, accountId);
                }
            }
        }
    }

    /// <summary>Versioned natural-chat prompt; never asks the model to emit a survey.</summary>
    public static string BuildPrompt(JsonElement payload)
    {
        var context = Context(payload);
        return $"""
            你是知客的自然聊天客户运营分析器（prompt_version=hot-chat-2）。
            只能根据用户提供的当前聊天和有限上下文进行渐进式推断；不要编造未知信息。
            不要生成调查问卷，不要连续追问，不要一次性索要全部资料，不要把客户当成被调查对象。
            只识别客户自然表达出的姓名/称呼、年龄、性别、职业工作、是否股民、股龄、持仓、投资习惯与偏好、家庭、兴趣和未来规划。
            缺少的信息必须保持空值并列入 missingFields；naturalNextTopics 只能给出一到三条自然、轻量的聊天切入点。
            根据上下文判断客户是否暂未回复（noReply），给出尊重客户意愿的冷却建议，不得建议连续催促。
            输出严格 JSON，字段必须包含：summary,intent,intentScore,emotion,urgency,language,productInterest,budget,
            contact,profile,confidence,profileFacts,missingFields,naturalNextTopics,customerTemperature,statusColor,noReply,replySuggestion,followup。
            profileFacts 的键只能是：{string.Join(',', ProfileFields)}。
            每个 profileFacts 值必须是 {{value,state,confidence,evidence}}；state 只能是 known/missing/pending/declined。
            known 必须有原文 evidence 且 confidence>=0.6；低置信度只能 pending；不确定不得猜测。
            replySuggestion 仅供人工预览，requiresConfirmation 必须为 true；涉及付款、退款、密码、验证码、身份、金融、法律、医疗、价格或交付保证时必须标记 sensitive=true。
            不得自动发送消息，不得输出密码、Cookie、Token、二维码或秘密。
            context_hint={context}
            """;
    }

    private static AiAnalysisResult ParseResult(JsonElement result, string messageId, string accountId)
    {
        if (result.ValueKind != JsonValueKind.Object)
            throw new AiAnalysisSchemaException("AI 顶层结果必须是 JSON 对象。");

        var confidence = Math.Clamp(Number(result, "confidence"), 0, 1);
        var contact = GetObject(result, "contact").Clone();
        var profile = GetObject(result, "profile").Clone();
        contact = Sanitize(contact).Clone();
        profile = Sanitize(profile).Clone();
        var facts = ParseFacts(result, messageId, confidence);
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        AddField(fields, "name", contact, "name");
        AddField(fields, "phone", contact, "phone");
        AddField(fields, "country", contact, "country");
        AddField(fields, "source", profile, "origin");
        AddField(fields, "occupation", profile, "occupation");
        AddField(fields, "stage", profile, "customerStage");
        AddField(fields, "budget", result, "budget");
        AddField(fields, "language", result, "language");
        AddField(fields, "intent_level", result, "intent");
        AddField(fields, "product_interest", result, "productInterest");

        var followup = confidence >= MinimumConfidence ? ParseFollowup(result) : null;
        var reply = ParseReply(result);
        var raw = result.Clone();
        raw = Sanitize(raw).Clone();
        return new AiAnalysisResult(
            String(result, "customerId"), messageId, confidence, fields, followup,
            String(result, "summary"), String(result, "intent"), Number(result, "intentScore"),
            String(result, "emotion"), String(result, "urgency"), String(result, "language"),
            Array(result, "productInterest"), String(result, "budget"), contact, profile, raw)
        {
            ProfileFacts = facts,
            MissingFields = Array(result, "missingFields").Where(item => ProfileFields.Contains(item, StringComparer.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
            NaturalNextTopics = Array(result, "naturalNextTopics").Take(3).ToArray(),
            NoReply = ParseNoReply(result),
            ReplySuggestion = reply,
            CustomerTemperature = String(result, "customerTemperature"),
            StatusColor = NormalizeColor(String(result, "statusColor")),
            IsStructured = true,
        };
    }

    private static IReadOnlyDictionary<string, AiProfileFact> ParseFacts(JsonElement root, string messageId, double resultConfidence)
    {
        var facts = new Dictionary<string, AiProfileFact>(StringComparer.OrdinalIgnoreCase);
        if (!root.TryGetProperty("profileFacts", out var node) || node.ValueKind != JsonValueKind.Object) return facts;
        foreach (var field in ProfileFields)
        {
            if (!node.TryGetProperty(field, out var item)) continue;
            var value = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("value", out var nested) ? nested.Clone() : item.Clone();
            var state = item.ValueKind == JsonValueKind.Object ? String(item, "state") : "";
            var confidence = item.ValueKind == JsonValueKind.Object ? Math.Clamp(Number(item, "confidence"), 0, 1) : resultConfidence;
            var evidence = item.ValueKind == JsonValueKind.Object ? Redact(String(item, "evidence", "sourceText", "quote")) : "";
            if (string.IsNullOrWhiteSpace(state)) state = value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "missing" : (confidence >= MinimumConfidence && !string.IsNullOrWhiteSpace(evidence) ? "known" : "pending");
            if (state is not ("known" or "missing" or "pending" or "declined")) state = "pending";
            if (state == "known" && (confidence < MinimumConfidence || string.IsNullOrWhiteSpace(evidence))) state = "pending";
            facts[field] = new AiProfileFact(field, Sanitize(value).Clone(), state, confidence, evidence, messageId);
        }
        return facts;
    }

    private static AiNoReplyAssessment? ParseNoReply(JsonElement root)
    {
        if (!root.TryGetProperty("noReply", out var value) || value.ValueKind != JsonValueKind.Object) return null;
        var noReply = Bool(value, "noReply") || Bool(value, "isNoReply");
        var cooldown = Math.Clamp((int)Number(value, "cooldownDays"), 1, 30);
        var suggested = DateTimeOffset.TryParse(String(value, "suggestedAt", "nextAt"), out var parsed) ? parsed : (DateTimeOffset?)null;
        return new AiNoReplyAssessment(noReply, Redact(String(value, "reason")), cooldown, suggested);
    }

    private static AiReplySuggestion? ParseReply(JsonElement root)
    {
        if (!root.TryGetProperty("replySuggestion", out var value)) return null;
        var text = Redact(value.ValueKind == JsonValueKind.Object ? String(value, "text", "content") : value.ToString());
        if (string.IsNullOrWhiteSpace(text)) return null;
        var sensitive = SensitiveText.IsMatch(text);
        var reason = sensitive ? "回复涉及敏感承诺或隐私内容，必须人工确认。" : "AI 回复建议仅可预览，不会自动发送。";
        return new AiReplySuggestion(text, true, sensitive, reason);
    }

    private static string ExtractText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var output) && output.ValueKind == JsonValueKind.String)
            return StripFence(output.GetString() ?? "{}");
        if (root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array && choices.GetArrayLength() > 0)
        {
            var message = choices[0].TryGetProperty("message", out var item) ? item : default;
            if (message.ValueKind == JsonValueKind.Object && message.TryGetProperty("content", out var content))
                return StripFence(content.ValueKind == JsonValueKind.String ? content.GetString() ?? "{}" : content.ToString());
        }
        throw new AiAnalysisSchemaException("AI 返回格式无法识别。");
    }

    private static string StripFence(string value) => value.Trim().Replace("```json", string.Empty, StringComparison.OrdinalIgnoreCase).Replace("```", string.Empty, StringComparison.Ordinal).Trim();
    private static JsonElement GetObject(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : JsonSerializer.SerializeToElement(new { });
    private static string String(JsonElement root, params string[] names) => names.Select(name => root.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString().Trim() : string.Empty).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;
    private static double Number(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.Number && value.TryGetDouble(out var result) ? result : 0;
    private static bool Bool(JsonElement root, string name) => root.TryGetProperty(name, out var value) && (value.ValueKind == JsonValueKind.True || (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed) && parsed));
    private static IReadOnlyList<string> Array(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Select(item => item.ToString().Trim()).Where(item => item.Length > 0).Take(30).ToArray() : [];
    private static void AddField(IDictionary<string, string> fields, string target, JsonElement root, string source) { var value = String(root, source); if (!string.IsNullOrWhiteSpace(value)) fields[target] = Redact(value); }
    private static FollowupSuggestion? ParseFollowup(JsonElement root)
    {
        if (!root.TryGetProperty("followup", out var value) || value.ValueKind != JsonValueKind.Object) return null;
        var reason = Redact(String(value, "reasonKey"));
        return string.IsNullOrWhiteSpace(reason) ? null : new FollowupSuggestion(reason, Redact(String(value, "title")), Redact(String(value, "detail")), DateTimeOffset.TryParse(String(value, "dueAt"), out var date) ? date : null, Redact(String(value, "priority")));
    }

    private static string Context(JsonElement payload)
    {
        if (!payload.TryGetProperty("context", out var value)) return "当前消息";
        return value.ValueKind switch { JsonValueKind.Array => $"上下文消息 {Math.Min(20, value.GetArrayLength())} 条", JsonValueKind.Object => "包含有限会话上下文", _ => "当前消息" };
    }

    private static JsonElement Sanitize(JsonElement value)
    {
        object? Clean(JsonElement item)
        {
            if (item.ValueKind == JsonValueKind.Object)
                return item.EnumerateObject().ToDictionary(p => p.Name, p => SensitiveText.IsMatch(p.Name) ? "[已脱敏]" : Clean(p.Value));
            if (item.ValueKind == JsonValueKind.Array) return item.EnumerateArray().Select(Clean).ToArray();
            if (item.ValueKind == JsonValueKind.String) return Redact(item.GetString() ?? string.Empty);
            if (item.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
            if (item.ValueKind is JsonValueKind.True or JsonValueKind.False) return item.GetBoolean();
            if (item.ValueKind == JsonValueKind.Number && item.TryGetDecimal(out var number)) return number;
            return item.ToString();
        }
        return JsonSerializer.SerializeToElement(Clean(value));
    }

    private static string Redact(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var redacted = Regex.Replace(value, "(?i)(password|passcode|token|cookie|secret|验证码|校验码|密码|银行卡(?:号)?|收款码|二维码|身份证(?:号)?|护照(?:号)?)\\s*[:：]?\\s*[^\\s，。；;]+", "[已脱敏]");
        return redacted.Length > 4000 ? redacted[..4000] : redacted;
    }

    private static string ReadSecret(string? value, string? file)
    {
        if (!string.IsNullOrWhiteSpace(file))
        {
            try { return File.ReadAllText(file.Trim()).Trim(); } catch { }
        }
        return value?.Trim() ?? string.Empty;
    }

    private static string NormalizeColor(string value) => value is "green" or "blue" or "amber" or "red" or "gray" ? value : "gray";
    private static bool IsAllowedEndpoint(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) && (uri.IsLoopback || uri.Host.Equals("host.docker.internal", StringComparison.OrdinalIgnoreCase)));
    }
}
