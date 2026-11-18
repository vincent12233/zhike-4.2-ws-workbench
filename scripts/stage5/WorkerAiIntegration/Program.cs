using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

Console.InputEncoding = new UTF8Encoding(false);
Console.OutputEncoding = new UTF8Encoding(false);
if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows Named Pipe integration requires Windows.");
if (Environment.GetEnvironmentVariable("ZHIKE_STAGE5_ISOLATED") != "1")
    throw new InvalidOperationException("Explicit isolated Stage 5 context required.");
if (args.Length == 1 && args[0] == "worker") { await RunWorkerAsync(); return; }
if (args.Length != 0) throw new ArgumentException("Only stdin test input is accepted.");

var rawInput = await Console.In.ReadToEndAsync();
if (Encoding.UTF8.GetByteCount(rawInput) > 128 * 1024) throw new ArgumentException("Test payload exceeds 128 KB.");
using var input = JsonDocument.Parse(rawInput);
ValidateInput(input.RootElement);
var root = Path.Combine(Path.GetTempPath(), "zhike-stage5-ai-worker-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    var flags = new WorkerFeatureFlagsSnapshot(true, true, true, "stage5-isolated-test", Path.Combine(root, "test-flags.json"), 1);
    var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test executable path unavailable.");
    var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, executable, new[] { "worker" }, Enabled: true,
        StartupTimeout: TimeSpan.FromSeconds(10), RequestTimeout: TimeSpan.FromSeconds(10)));
    JsonElement result;
    bool stopped;
    await using (var runtime = new WorkerRuntimeController(supervisor, flags, heartbeatInterval: TimeSpan.FromSeconds(1)))
    {
        var started = await runtime.StartAsync();
        if (!started.Running) throw new InvalidOperationException("Isolated Worker did not start.");
        using var response = await runtime.RequestAsync("analyze", input.RootElement, timeout: TimeSpan.FromSeconds(10));
        result = response.RootElement.GetProperty("Payload").Clone();
        if (!result.GetProperty("mock").GetBoolean() || result.GetProperty("correlationId").GetString() != input.RootElement.GetProperty("correlationId").GetString()
            || result.GetProperty("jobId").GetString() != input.RootElement.GetProperty("jobId").GetString())
            throw new InvalidOperationException("Mock Worker response identity mismatch.");
        stopped = !(await runtime.StopAsync()).Running;
    }
    Directory.Delete(root, recursive: true);
    Console.WriteLine(JsonSerializer.Serialize(new { ok = stopped, mock = true, jobId = result.GetProperty("jobId"), correlationId = result.GetProperty("correlationId"), result = result.GetProperty("result"), transport = "Windows Named Pipe", runtime = "WorkerRuntimeController", stopped, tempRootClean = !Directory.Exists(root), productionWorkerStarted = false, productionDatabaseOpened = false }));
}
finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }

static void ValidateInput(JsonElement input)
{
    if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("jobId", out var job) || job.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(job.GetString())
        || !input.TryGetProperty("correlationId", out var correlation) || correlation.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(correlation.GetString())
        || !input.TryGetProperty("fixture", out var fixture) || fixture.ValueKind != JsonValueKind.Object)
        throw new ArgumentException("jobId, correlationId and explicit Mock fixture required.");
}

static async Task RunWorkerAsync()
{
    var pipeName = Environment.GetEnvironmentVariable("ZHIKE_WORKER_PIPE") ?? throw new InvalidOperationException("Pipe missing.");
    var token = Environment.GetEnvironmentVariable("ZHIKE_WORKER_TOKEN") ?? throw new InvalidOperationException("Token missing.");
    var session = Environment.GetEnvironmentVariable("ZHIKE_WORKER_SESSION") ?? throw new InvalidOperationException("Session missing.");
    using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Impersonation, HandleInheritability.None);
    await pipe.ConnectAsync(5000);
    using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, leaveOpen: true);
    await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
    var helloId = Guid.NewGuid().ToString("N");
    await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(new WorkerIpcEnvelope(WorkerIpcProtocol.CurrentSchemaVersion, "hello", helloId, session, Guid.NewGuid().ToString("N"), WorkerIpcProtocol.ComputeProof(token, helloId, session))));
    var seen = new HashSet<string>(StringComparer.Ordinal);
    while (await reader.ReadLineAsync() is { } line)
    {
        WorkerIpcEnvelope request;
        try { request = WorkerIpcProtocol.Deserialize(line); } catch (WorkerIpcProtocolException) { continue; }
        string? rejection = request.SchemaVersion != WorkerIpcProtocol.CurrentSchemaVersion ? "UNSUPPORTED_SCHEMA"
            : request.SessionId != session || !WorkerIpcProtocol.VerifyProof(token, request) ? "AUTH_REVOKED"
            : !seen.Add(request.RequestId) ? "REPLAY_REJECTED" : null;
        if (rejection is not null) { await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(WorkerIpcProtocol.Error(request.RequestId, session, rejection, request.TraceId))); continue; }
        if (request.Kind == "cancel") continue;
        JsonElement? payload = null;
        if (request.Kind == "analyze")
        {
            if (request.Payload is not { } input) throw new InvalidOperationException("Mock payload missing.");
            ValidateInput(input);
            payload = await AnalyzeMockAsync(input, request.DeadlineUnixMs);
        }
        else if (request.Kind != "heartbeat") { await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(WorkerIpcProtocol.Error(request.RequestId, session, "INVALID_REQUEST", request.TraceId))); continue; }
        await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(new WorkerIpcEnvelope(WorkerIpcProtocol.CurrentSchemaVersion, "response", request.RequestId, session, request.TraceId, Payload: payload)));
    }
}

static async Task<JsonElement> AnalyzeMockAsync(JsonElement input, long? deadline)
{
    var node = Environment.GetEnvironmentVariable("ZHIKE_STAGE5_TEST_NODE") ?? throw new InvalidOperationException("Explicit test Node runtime required.");
    if (!Path.IsPathFullyQualified(node) || !File.Exists(node) || !string.Equals(Path.GetFileName(node), "node.exe", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Test Node runtime path invalid.");
    var info = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false), WorkingDirectory = AppContext.BaseDirectory };
    info.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "mock-provider-runner.cjs"));
    using var child = Process.Start(info) ?? throw new InvalidOperationException("Mock Provider process unavailable.");
    var remaining = deadline.HasValue ? deadline.Value - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() : 8000;
    using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Clamp(remaining, 1, 8000)));
    try
    {
        await child.StandardInput.WriteAsync(input.GetRawText()); child.StandardInput.Close();
        var output = child.StandardOutput.ReadToEndAsync(timeout.Token); var error = child.StandardError.ReadToEndAsync(timeout.Token);
        await child.WaitForExitAsync(timeout.Token); await error;
        if (child.ExitCode != 0) throw new InvalidOperationException("Isolated Mock Provider failed.");
        using var result = JsonDocument.Parse(await output); return result.RootElement.Clone();
    }
    finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
}
