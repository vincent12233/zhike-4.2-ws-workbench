using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

// Actual service + DPAPI; temporary roots and synthetic credentials only.
var cases = new List<(string Name, Func<Task> Run)>();
var diagnosticContext = "";
var childMode = args.Length == 4 && args[0] == "--isolated-writer";
var testDataRoot = childMode ? Path.GetFullPath(args[1]) : Path.Combine(Path.GetTempPath(), $"zhike-ai-credential-{Guid.NewGuid():N}");
if (!Path.GetFullPath(testDataRoot).StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(testDataRoot).StartsWith("zhike-ai-credential-", StringComparison.Ordinal)) throw new Exception("isolated root identity required");
Directory.CreateDirectory(testDataRoot);
string Key(string provider, string suffix) => provider == "teamorouter" ? $"sk-teamo-synthetic-{suffix}-not-a-real-key" : $"sk-synthetic-{suffix}-not-a-real-key";
object Save(string provider, string suffix = "default", string model = "gpt-synthetic") => new { provider, apiKey = Key(provider, suffix), model, defaultIncludePhone = false };
AiBridgeService Service(string root) => new(root, new HttpClient(new DenyNetwork()));
Task<JsonElement> Call(AiBridgeService service, string action, object? payload = null, CancellationToken token = default) => service.InvokeAsync(action, JsonSerializer.SerializeToElement(payload ?? new { }), token);
string NewRoot(string name) { var root = Path.Combine(testDataRoot, name); Directory.CreateDirectory(root); return root; }
string FilePath(string root) => Path.Combine(root, "ai-credentials-winui.json");
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
async Task MustReject(Func<Task> action, string expected) {
    try { await action(); }
    catch (Exception error) when (error is not OperationCanceledException) {
        Check(error.Message.Contains(expected, StringComparison.Ordinal), "failure must have a stable storage classification");
        Check(!error.ToString().Contains("synthetic-", StringComparison.Ordinal), "failure must not reveal credential or corrupted contents");
        Check(!error.ToString().Contains(testDataRoot, StringComparison.OrdinalIgnoreCase), "failure must not reveal the storage path");
        return;
    }
    throw new Exception("invalid storage was silently accepted");
}
cases.Add(("DPAPI persistence and status minimization", async () => {
    var root = NewRoot("persistence");
    await Call(Service(root), "saveKey", Save("teamorouter", "restart", "gpt-synthetic-persist"));
    var status = await Call(Service(root), "status", new { provider = "teamorouter" });
    Check(status.GetProperty("configured").GetBoolean(), "credential must survive service reconstruction");
    Check(status.GetProperty("model").GetString() == "gpt-synthetic-persist", "model must persist");
    var stored = await File.ReadAllTextAsync(FilePath(root));
    Check(!stored.Contains(Key("teamorouter", "restart"), StringComparison.Ordinal), "stored JSON must not contain plaintext");
    Check(!status.GetRawText().Contains(Key("teamorouter", "restart"), StringComparison.Ordinal), "status must not expose plaintext");
}));
if (childMode) {
    var root = Path.Combine(testDataRoot, "process");
    var ready = Path.Combine(testDataRoot, "process-start");
    var until = DateTime.UtcNow.AddSeconds(15);
    while (!File.Exists(ready) && DateTime.UtcNow < until) await Task.Delay(10);
    if (!File.Exists(ready)) return 2;
    await Call(Service(root), "saveKey", Save(args[2], "process", args[3]));
    return 0;
}
foreach (var (name, value) in new[] { ("malformed", "{synthetic-corrupt"), ("null-document", "null"), ("missing-document-shape", "{}"), ("null-providers", "{\"providers\":null}"), ("null-active-provider", "{\"activeProvider\":null,\"providers\":{}}") }) {
    cases.Add(($"Corrupt {name} is rejected without replacement", async () => {
        var root = NewRoot(name); await File.WriteAllTextAsync(FilePath(root), value);
        var before = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
        await MustReject(async () => { await Call(Service(root), "status"); }, "AI_CREDENTIAL_CORRUPT");
        await MustReject(async () => { await Call(Service(root), "saveKey", Save("openai", "must-not-overwrite")); }, "AI_CREDENTIAL_CORRUPT");
        await MustReject(async () => { await Call(Service(root), "removeKey", new { provider = "openai" }); }, "AI_CREDENTIAL_CORRUPT");
        var after = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
        Check(before.SequenceEqual(after), "invalid original must remain byte-for-byte unchanged");
    }));
}
cases.Add(("Undecryptable DPAPI blocks all mutations", async () => {
    var root = NewRoot("unreadable"); await Call(Service(root), "saveKey", Save("openai", "preserved"));
    var json = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(await File.ReadAllTextAsync(FilePath(root)))!;
    var providers = JsonSerializer.Deserialize<Dictionary<string, object>>(json["providers"].GetRawText())!;
    providers["teamorouter"] = new { encryptedKey = Convert.ToBase64String(Encoding.UTF8.GetBytes("synthetic-invalid-dpapi")), model = "gpt-synthetic" };
    await File.WriteAllTextAsync(FilePath(root), JsonSerializer.Serialize(new { activeProvider = "openai", defaultIncludePhone = false, providers }));
    var before = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    await MustReject(async () => { await Call(Service(root), "status", new { provider = "openai" }); }, "AI_CREDENTIAL_UNREADABLE");
    await MustReject(async () => { await Call(Service(root), "saveKey", Save("openai", "replace")); }, "AI_CREDENTIAL_UNREADABLE");
    await MustReject(async () => { await Call(Service(root), "removeKey", new { provider = "teamorouter" }); }, "AI_CREDENTIAL_UNREADABLE");
    var after = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    Check(before.SequenceEqual(after), "undecipherable original and unrelated provider must be preserved");
}));
cases.Add(("Concurrent service instances preserve both providers", async () => {
    for (var round = 0; round < 12; round++) {
        var root = NewRoot("concurrent-" + round);
        diagnosticContext = $"round={round};phase=save-both";
        await Task.WhenAll(Call(Service(root), "saveKey", Save("openai", "parallel-a")), Call(Service(root), "saveKey", Save("teamorouter", "parallel-b")));
        diagnosticContext = $"round={round};phase=verify-both";
        var status = await Call(Service(root), "status"); var configured = status.GetProperty("configuredProviders");
        Check(configured.GetProperty("openai").GetBoolean() && configured.GetProperty("teamorouter").GetBoolean(), "read-modify-write race lost a provider");
        diagnosticContext = $"round={round};phase=remove-and-save";
        await Task.WhenAll(Call(Service(root), "removeKey", new { provider = "openai" }), Call(Service(root), "saveKey", Save("teamorouter", "new-b", "gpt-synthetic-updated")));
        diagnosticContext = $"round={round};phase=verify-update";
        status = await Call(Service(root), "status", new { provider = "teamorouter" });
        Check(!status.GetProperty("configuredProviders").GetProperty("openai").GetBoolean(), "concurrent save resurrected a removed provider");
        Check(status.GetProperty("model").GetString() == "gpt-synthetic-updated", "concurrent removal lost another update");
    }
}));
cases.Add(("Independent processes preserve both provider updates", async () => {
    var root = NewRoot("process");
    Process Start(string provider, string model) {
        var executable = Environment.ProcessPath ?? throw new Exception("current test executable is unavailable");
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) info.ArgumentList.Add(typeof(DenyNetwork).Assembly.Location);
        foreach (var arg in new[] { "--isolated-writer", testDataRoot, provider, model }) info.ArgumentList.Add(arg);
        return Process.Start(info)!;
    }
    using var a = Start("openai", "gpt-process-a"); using var b = Start("teamorouter", "gpt-process-b");
    try {
        await File.WriteAllTextAsync(Path.Combine(testDataRoot, "process-start"), "ready");
        using var budget = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        await Task.WhenAll(a.WaitForExitAsync(budget.Token), b.WaitForExitAsync(budget.Token));
        Check(a.ExitCode == 0 && b.ExitCode == 0, "isolated child writer failed");
        var status = await Call(Service(root), "status"); var configured = status.GetProperty("configuredProviders");
        Check(configured.GetProperty("openai").GetBoolean() && configured.GetProperty("teamorouter").GetBoolean(), "cross-process transaction lost a provider");
    } finally {
        foreach (var process in new[] { a, b }) if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
    }
}));
cases.Add(("Cancellation while waiting for ownership never writes", async () => {
    var root = NewRoot("cancel"); await Call(Service(root), "saveKey", Save("openai", "untouched"));
    var before = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    await using (var held = new FileStream(FilePath(root) + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
        using var cancel = new CancellationTokenSource(80);
        try { await Call(Service(root), "saveKey", Save("teamorouter", "cancelled"), cancel.Token); throw new Exception("cancelled writer unexpectedly committed"); }
        catch (OperationCanceledException) { }
    }
    var after = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    Check(before.SequenceEqual(after), "cancelled writer changed original bytes");
    Check(!Directory.EnumerateFiles(root, "*.tmp").Any(), "cancelled writer leaked an encrypted staging file");
    await Call(Service(root), "saveKey", Save("teamorouter", "later"));
}));
cases.Add(("Failed atomic replacement preserves original and clears staging file", async () => {
    var root = NewRoot("failed-replace"); await Call(Service(root), "saveKey", Save("openai", "original"));
    var before = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    await using (var held = new FileStream(FilePath(root), FileMode.Open, FileAccess.Read, FileShare.Read)) {
        await MustReject(async () => { await Call(Service(root), "saveKey", Save("teamorouter", "uncommitted")); }, "AI_CREDENTIAL_IO");
    }
    var after = SHA256.HashData(await File.ReadAllBytesAsync(FilePath(root)));
    Check(before.SequenceEqual(after), "replacement failure changed original bytes");
    Check(!Directory.EnumerateFiles(root, "*.tmp").Any(), "failed writer leaked an encrypted staging file");
    await Call(Service(root), "saveKey", Save("teamorouter", "retry"));
}));
var failed = 0;
try {
    foreach (var (name, run) in cases) {
        diagnosticContext = "";
        try { await run(); Console.WriteLine("PASS " + name); }
        catch (Exception error) {
            failed++;
            // Only stable storage classifications and synthetic phase names:
            // no raw exception paths, file contents or credential values.
            var storageCode = new[] { "AI_CREDENTIAL_CORRUPT", "AI_CREDENTIAL_UNREADABLE", "AI_CREDENTIAL_BUSY", "AI_CREDENTIAL_IO" }
                .FirstOrDefault(code => error.Message.Contains("[" + code + "]", StringComparison.Ordinal));
            var safeError = error is InvalidOperationException ? storageCode ?? "unexpected storage failure" : error.Message;
            Console.WriteLine("FAIL " + name + ": " + safeError + (diagnosticContext.Length == 0 ? "" : " (" + diagnosticContext + ")"));
        }
    }
    Console.WriteLine($"AI credential isolated runtime: {cases.Count - failed}/{cases.Count}; network calls=0");
}
finally {
    var resolved = Path.GetFullPath(testDataRoot);
    if (resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase) && Path.GetFileName(resolved).StartsWith("zhike-ai-credential-", StringComparison.Ordinal)) Directory.Delete(resolved, true);
}
return failed == 0 ? 0 : 1;
sealed class DenyNetwork : HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => throw new Exception("Network forbidden in credential tests");
}
