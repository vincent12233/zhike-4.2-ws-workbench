using System.Text.Json;
using Zhike.Desktop.Services;

var root = Path.Combine(Path.GetTempPath(), $"zhike-ai-credential-{Guid.NewGuid():N}");
var testApiKey = string.Concat("sk-", "teamo-", "test-not-a-secret-placeholder-000000");
Directory.CreateDirectory(root);
try
{
    var payload = JsonSerializer.SerializeToElement(new
    {
        provider = "teamorouter",
        apiKey = testApiKey,
        model = "gpt-5.4-mini",
        defaultIncludePhone = false,
    });
    var writer = new AiBridgeService(root);
    var saved = await writer.InvokeAsync("saveKey", payload);
    if (!saved.GetProperty("configured").GetBoolean()) throw new Exception("保存后未配置");
    var reader = new AiBridgeService(root);
    var status = await reader.InvokeAsync("status", JsonSerializer.SerializeToElement(new { provider = "teamorouter" }));
    if (!status.GetProperty("configured").GetBoolean()) throw new Exception("重启服务后凭据丢失");
    if (status.GetProperty("model").GetString() != "gpt-5.4-mini") throw new Exception("模型未持久化");
    if (!File.Exists(Path.Combine(root, "ai-credentials-winui.json"))) throw new Exception("凭据文件未创建");
    Console.WriteLine("AI 凭据 DPAPI 保存与重启读取测试通过");
}
finally
{
    try { Directory.Delete(root, true); } catch { }
}
