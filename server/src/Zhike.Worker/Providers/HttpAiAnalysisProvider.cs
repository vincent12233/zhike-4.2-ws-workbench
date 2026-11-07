using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Zhike.Worker.Providers;

public sealed class HttpAiAnalysisProvider(HttpClient http, IConfiguration configuration) : IAiAnalysisProvider
{
    private readonly string baseUrl = (configuration["ZHike:AIBaseUrl"] ?? string.Empty).TrimEnd('/');
    private readonly string apiKey = ReadSecret(configuration["ZHike:AIKey"], configuration["ZHike:AIKeyFile"]);
    private readonly string model = configuration["ZHike:AIModel"] ?? "gpt-5-mini";

    public async Task<AiAnalysisResult> AnalyzeAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var messageId = payload.TryGetProperty("messageId", out var id) ? id.GetString() ?? string.Empty : string.Empty;
        var body = payload.TryGetProperty("body", out var text) ? text.GetString() ?? string.Empty : string.Empty;
        var accountId = payload.TryGetProperty("accountId", out var account) ? account.GetString() ?? string.Empty : string.Empty;
        if (!string.IsNullOrWhiteSpace(baseUrl) && !IsAllowedEndpoint(baseUrl))
            throw new InvalidOperationException("AI 服务地址必须使用 HTTPS；仅允许回环地址使用 HTTP。");
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(apiKey))
            return new AiAnalysisResult(string.Empty, messageId, 0, new Dictionary<string, string>(), null, Raw: payload.Clone());
        if (string.IsNullOrWhiteSpace(body)) return new AiAnalysisResult(string.Empty, messageId, 0, new Dictionary<string, string>(), null, Raw: payload.Clone());

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = "你是客户运营分析器。只分析给定的一条聊天文本，返回 JSON，不要编造未知信息。字段：summary,intent,intentScore,emotion,urgency,language,productInterest,budget,contact{name,phone,country},profile{origin,age,occupation,customerStage},confidence,followup{reasonKey,title,detail,dueAt,priority}。低置信度字段留空。" },
                new { role = "user", content = $"account={accountId}; messageId={messageId}; text={body}" },
            },
        }), Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, cancellationToken);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"AI provider returned {(int)response.StatusCode}");
        using var envelope = JsonDocument.Parse(responseText);
        var jsonText = ExtractText(envelope.RootElement);
        using var resultDocument = JsonDocument.Parse(jsonText);
        var result = resultDocument.RootElement;
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var contact = GetObject(result, "contact");
        var profile = GetObject(result, "profile");
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
        var followup = ParseFollowup(result);
        return new AiAnalysisResult(
            result.TryGetProperty("customerId", out var customer) ? customer.GetString() ?? string.Empty : string.Empty,
            messageId,
            Math.Clamp(Number(result, "confidence"), 0, 1),
            fields,
            followup,
            String(result, "summary"), String(result, "intent"), Number(result, "intentScore"), String(result, "emotion"), String(result, "urgency"), String(result, "language"), Array(result, "productInterest"), String(result, "budget"), contact, profile, result.Clone());
    }

    private static string ExtractText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var output) && output.ValueKind == JsonValueKind.String) return StripFence(output.GetString() ?? "{}");
        if (root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array && choices.GetArrayLength() > 0)
        {
            var message = choices[0].GetProperty("message");
            if (message.TryGetProperty("content", out var content)) return StripFence(content.ValueKind == JsonValueKind.String ? content.GetString() ?? "{}" : content.ToString());
        }
        throw new InvalidDataException("AI 返回格式无法识别");
    }

    private static string StripFence(string value) => value.Trim().Replace("```json", string.Empty, StringComparison.OrdinalIgnoreCase).Replace("```", string.Empty, StringComparison.Ordinal).Trim();
    private static JsonElement GetObject(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : JsonSerializer.SerializeToElement(new { });
    private static string String(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.ToString().Trim() : string.Empty;
    private static double Number(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.TryGetDouble(out var result) ? result : 0;
    private static IReadOnlyList<string> Array(JsonElement root, string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray().Select(item => item.ToString()).Where(item => item.Length > 0).Take(20).ToArray() : [];
    private static void AddField(IDictionary<string, string> fields, string target, JsonElement root, string source) { var value = String(root, source); if (!string.IsNullOrWhiteSpace(value)) fields[target] = value; }
    private static FollowupSuggestion? ParseFollowup(JsonElement root)
    {
        if (!root.TryGetProperty("followup", out var value) || value.ValueKind != JsonValueKind.Object) return null;
        var reason = String(value, "reasonKey");
        return string.IsNullOrWhiteSpace(reason) ? null : new FollowupSuggestion(reason, String(value, "title"), String(value, "detail"), DateTimeOffset.TryParse(String(value, "dueAt"), out var date) ? date : null, String(value, "priority"));
    }

    private static string ReadSecret(string? value, string? file)
    {
        if (!string.IsNullOrWhiteSpace(file))
        {
            try { return File.ReadAllText(file.Trim()).Trim(); } catch { }
        }
        return value?.Trim() ?? string.Empty;
    }

    private static bool IsAllowedEndpoint(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) && (uri.IsLoopback || uri.Host.Equals("host.docker.internal", StringComparison.OrdinalIgnoreCase)));
    }
}
