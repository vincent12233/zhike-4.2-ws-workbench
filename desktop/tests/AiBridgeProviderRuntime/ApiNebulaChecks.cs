using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zhike.Desktop.Services;

internal static class ApiNebulaChecks
{
    public static async Task RunAsync(string directory)
    {
        const string provider = "apinebula";
        const string model = "gpt-6-astra";
        const string alias = "nebula-custom-alias";
        var nebulaKey = $"nebula-fixture-{Guid.NewGuid():N}";
        var openAiKey = $"sk-fixture-{Guid.NewGuid():N}";
        var handler = new RecordingHandler(nebulaKey, openAiKey);
        using var http = new HttpClient(handler);
        var service = new AiBridgeService(directory, http);
        Task<JsonElement> Invoke(string method, object args) => service.InvokeAsync(method, JsonSerializer.SerializeToElement(args));

        await Invoke("saveKey", new { provider = "openai", apiKey = openAiKey });
        var saved = await Invoke("saveKey", new { provider, apiKey = nebulaKey });
        Check(saved.GetProperty("provider").GetString() == provider && saved.GetProperty("model").GetString() == model, "Nebula default model");
        Check(!saved.GetRawText().Contains(nebulaKey), "status must not expose the saved credential");
        service = new AiBridgeService(directory, http);
        var models = await Invoke("listModels", new { provider });
        Check(models.GetProperty("models").EnumerateArray().Any(item => item.GetString() == alias), "catalog includes custom aliases");
        var connected = await Invoke("testConnection", new { provider });
        Check(connected.GetProperty("ok").GetBoolean() && connected.GetProperty("model").GetString() == model, "connection test model");
        try
        {
            await Invoke("testConnection", new { provider, model = "unlisted-alias" });
            throw new Exception("Connection test accepted a model absent from the catalog.");
        }
        catch (InvalidOperationException) { }

        await Invoke("saveKey", new { provider, model = alias });
        var result = await Invoke("request", new { input = "synthetic-question" });
        Check(result.GetProperty("text").GetString() == "synthetic-answer" && result.GetProperty("model").GetString() == alias, "chat completion result");
        var plan = await Invoke("request", new { mode = "manage", input = "synthetic-plan" });
        Check(plan.GetProperty("actions").GetArrayLength() == 1 && plan.GetProperty("actions")[0].GetProperty("note").GetString() == "synthetic-note", "chat tool proposal");
        handler.EmptyProposal = true;
        var empty = await Invoke("request", new { mode = "manage", input = "synthetic-empty" });
        Check(empty.GetProperty("actions").GetArrayLength() == 0 && !empty.GetProperty("text").GetString()!.Contains("已生成管理建议"), "empty proposal");
        handler.RejectNebula = true;
        try
        {
            await Invoke("request", new { provider, input = "synthetic-denied" });
            throw new Exception("401 accepted");
        }
        catch (InvalidOperationException error) when (error.Message.Contains("APINebula", StringComparison.OrdinalIgnoreCase)) { }
        await Invoke("request", new { provider = "openai", input = "synthetic-other-provider" });
        await Invoke("removeKey", new { provider });
        Check(!(await Invoke("status", new { provider })).GetProperty("configured").GetBoolean(), "Nebula credential removed");
        Check((await Invoke("status", new { provider = "openai" })).GetProperty("configured").GetBoolean(), "OpenAI credential retained");
        Check(handler.Calls.SequenceEqual(new[] { "models", "models", "models", alias, alias, alias, alias, "openai" }), "expected requests and models without cross-provider fallback");
        Console.WriteLine("APINebula runtime passed: model catalog, request routing, saved model, credential isolation and 401 handling.");
    }

    private static void Check(bool condition, string reason)
    {
        if (!condition) throw new Exception($"Provider contract failed: {reason}");
    }

    private sealed class RecordingHandler(string nebulaKey, string openAiKey) : HttpMessageHandler
    {
        public readonly List<string> Calls = [];
        public bool RejectNebula { get; set; }
        public bool EmptyProposal { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            var uri = request.RequestUri!.AbsoluteUri;
            var openAi = uri == "https://api.openai.com/v1/responses";
            var auth = request.Headers.Authorization;
            Check(auth?.Scheme == "Bearer" && auth.Parameter == (openAi ? openAiKey : nebulaKey), "bearer bound to destination");
            if (openAi)
            {
                Check(request.Method == HttpMethod.Post, "OpenAI method");
                Calls.Add("openai");
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { output_text = "official-answer" }) };
            }
            if (uri == "https://apinebula.ai/v1/models")
            {
                Check(request.Method == HttpMethod.Get, "catalog method");
                Calls.Add("models");
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { data = new[] { new { id = "nebula-custom-alias" }, new { id = "gpt-6-astra" } } }) };
            }
            Check(uri == "https://apinebula.ai/v1/chat/completions" && request.Method == HttpMethod.Post, "APINebula chat URI and method");
            var body = await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken: token);
            var selected = body.GetProperty("model").GetString()!;
            Calls.Add(selected);
            if (RejectNebula) return new(HttpStatusCode.Unauthorized) { Content = JsonContent.Create(new { error = new { message = "synthetic denial" } }) };
            var messages = body.GetProperty("messages").EnumerateArray().ToArray();
            Check(messages.Any(m => m.GetProperty("role").GetString() == "system"), "system instructions");
            var prompt = messages.Single(m => m.GetProperty("role").GetString() == "user").GetProperty("content").GetString()!;
            if (body.TryGetProperty("tools", out var tools))
            {
                Check(prompt.Contains(EmptyProposal ? "synthetic-empty" : "synthetic-plan"), "management input");
                Check(tools.GetArrayLength() == 1 && tools[0].GetProperty("function").GetProperty("name").GetString() == "propose_data_changes"
                    && body.GetProperty("tool_choice").GetProperty("function").GetProperty("name").GetString() == "propose_data_changes", "permitted management tool");
                var function = new { name = "propose_data_changes", arguments = """{"summary":"fixture","operations":[{"note":"synthetic-note"}]}""" };
                var toolCalls = new[] { new { type = "function", function } };
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { choices = new[] { new { message = new { role = "assistant", content = (string?)null, tool_calls = EmptyProposal ? [] : toolCalls } } } }) };
            }
            Check(prompt.Contains("synthetic-question"), "user input in chat messages");
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { choices = new[] { new { message = new { content = "synthetic-answer" } } } }) };
        }
    }
}
