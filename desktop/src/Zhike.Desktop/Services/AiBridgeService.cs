using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;

namespace Zhike.Desktop.Services;

/// <summary>
/// Native counterpart of the Electron GPT bridge.  Keys are encrypted with
/// Windows DPAPI for the current user and are never returned to the page.
/// The service intentionally implements only the documented, safe AI calls.
/// </summary>
public sealed class AiBridgeService
{
    private sealed record Provider(string Name, string BaseUrl, string DefaultModel);
    private static readonly IReadOnlyDictionary<string, Provider> Providers = new Dictionary<string, Provider>(StringComparer.OrdinalIgnoreCase)
    {
        ["openai"] = new("OpenAI 官方 API", "https://api.openai.com/v1", "gpt-5-mini"),
        ["teamorouter"] = new("TeamoRouter", "https://api.teamorouter.com/v1", "gpt-5-mini"),
    };
    private readonly string _path;
    private readonly string _legacyPath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _activeRequests = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(45) };

    public AiBridgeService(string? root = null)
    {
        var directory = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike");
        Directory.CreateDirectory(directory);
        // Keep the Electron safeStorage file untouched so rollback remains
        // lossless. A native-specific file is used for DPAPI credentials.
        _path = Path.Combine(directory, "ai-credentials-winui.json");
        _legacyPath = Path.Combine(directory, "ai-credentials.json");
    }

    public async Task<JsonElement> InvokeAsync(string action, JsonElement payload, CancellationToken cancellationToken = default)
    {
        return action.ToLowerInvariant() switch
        {
            "status" => await StatusAsync(payload, cancellationToken),
            "savekey" or "save-key" => await SaveKeyAsync(payload, cancellationToken),
            "removekey" or "remove-key" => await RemoveKeyAsync(payload, cancellationToken),
            "testconnection" or "test" => await TestConnectionAsync(payload, cancellationToken),
            "listmodels" or "models" => await ListModelsAsync(payload, cancellationToken),
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
        using var response = await SendAsync(credential, "/responses", new { model = credential.Model, store = false, max_output_tokens = 8, input = "Reply OK." }, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode));
        return JsonSerializer.SerializeToElement(new { ok = true, provider = credential.ProviderKey, providerName = credential.Provider.Name, model = credential.Model });
    }

    private async Task<JsonElement> ListModelsAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var credential = await ResolveCredentialAsync(payload, cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{credential.Provider.BaseUrl}/models");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.ApiKey);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode));
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var models = document.RootElement.TryGetProperty("data", out var rows) && rows.ValueKind == JsonValueKind.Array
            ? rows.EnumerateArray().Select(row => row.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "").Where(id => !string.IsNullOrWhiteSpace(id)).Where(id => credential.ProviderKey != "teamorouter" || id.StartsWith("gpt", StringComparison.OrdinalIgnoreCase)).OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray()
            : Array.Empty<string>();
        return JsonSerializer.SerializeToElement(new { models });
    }

    private async Task<JsonElement> RequestAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var requestId = StringValue(payload, "requestId");
        using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (!string.IsNullOrWhiteSpace(requestId)) _activeRequests[requestId] = requestTimeout;
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
        var body = new Dictionary<string, object?> { ["model"] = credential.Model, ["store"] = false, ["instructions"] = instructions, ["input"] = prompt };
        if (managementMode) { body["tools"] = new[] { ManagementTool() }; body["tool_choice"] = new { type = "function", name = "propose_data_changes" }; }
        using var response = await SendAsync(credential, "/responses", body, requestTimeout.Token);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(FriendlyError(credential.ProviderKey, (int)response.StatusCode));
        using var document = JsonDocument.Parse(text);
        var output = ExtractOutputText(document.RootElement);
        var responseId = document.RootElement.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "";
        if (managementMode)
        {
            var actions = ExtractManagementActions(document.RootElement);
            return JsonSerializer.SerializeToElement(new { text = string.IsNullOrWhiteSpace(output) ? "已生成管理建议，请确认后执行。" : output, actions, model = credential.Model, providerName = credential.Provider.Name, responseId });
        }
        if (string.IsNullOrWhiteSpace(output)) throw new InvalidOperationException("AI 没有返回可显示的内容。");
        return JsonSerializer.SerializeToElement(new { text = output, model = credential.Model, providerName = credential.Provider.Name, responseId });
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(requestId) && _activeRequests.TryRemove(requestId, out var active)) active.Dispose();
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
        var request = new HttpRequestMessage(HttpMethod.Post, $"{credential.Provider.BaseUrl}{path}")
        {
            Content = new StringContent(JsonSerializer.Serialize(body, _json), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.ApiKey);
        return await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken);
    }

    private async Task<CredentialDocument> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var path = File.Exists(_path) ? _path : _legacyPath;
            if (!File.Exists(path)) return new();
            await using var stream = File.OpenRead(path);
            var document = await JsonSerializer.DeserializeAsync<CredentialDocument>(stream, _json, cancellationToken) ?? new();
            // Electron's older file may contain a single top-level key. Keep
            // it readable without ever overwriting that file during migration.
            if (document.Providers.Count == 0)
            {
                stream.Position = 0;
                using var raw = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                if (raw.RootElement.TryGetProperty("encryptedKey", out var encrypted))
                    document.Providers["openai"] = new CredentialRow { EncryptedKey = encrypted.GetString(), Model = StringValue(raw.RootElement, "model") };
            }
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
        if (provider == "teamorouter" && !model.StartsWith("gpt", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("当前模型不支持 Responses API，请更换 GPT 系列模型。");
        return model;
    }

    private static string ExtractOutputText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var direct) && direct.ValueKind == JsonValueKind.String) return direct.GetString() ?? "";
        var builder = new StringBuilder();
        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            foreach (var item in output.EnumerateArray())
                if (item.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
                    foreach (var part in content.EnumerateArray())
                        if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String) builder.Append(text.GetString());
        return builder.ToString();
    }

    private static string FriendlyError(string provider, int status)
        => status is 401 or 403 ? $"{Providers[provider].Name} API Key 无效或已被删除" : status == 402 ? $"{Providers[provider].Name} 额度不足" : $"{Providers[provider].Name} 请求失败（{status}）";

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
