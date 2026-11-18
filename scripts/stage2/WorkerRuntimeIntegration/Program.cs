using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

if (args.FirstOrDefault() == "worker")
{
    await RunWorkerAsync(args);
    return;
}

if (args.FirstOrDefault() == "io-boundaries")
{
    await RunIoBoundaryProbeAsync();
    return;
}

if (args.FirstOrDefault() == "flags")
{
    RunFeatureFlagProbe();
    return;
}

if (args.FirstOrDefault() == "disabled")
{
    await RunDisabledProbeAsync();
    return;
}

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, status = "NotTested", reason = "Named Pipe ACL requires Windows" }));
    return;
}

var tempRoot = Path.Combine(Path.GetTempPath(), "zhike-stage2-worker-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(tempRoot);
var clock = Stopwatch.StartNew();
var traceGate = new object();
var traceWriteFailures = 0;
var tracePath = Environment.GetEnvironmentVariable("ZHIKE_WORKER_TEST_TRACE");
if (!string.IsNullOrWhiteSpace(tracePath))
{
    var traceRoot = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, ".tools", "stage52-worker-raw"));
    tracePath = Path.GetFullPath(tracePath);
    if (!File.Exists(Path.Combine(Environment.CurrentDirectory, "scripts", "stage2", "WorkerRuntimeIntegration", "Program.cs")) ||
        !tracePath.StartsWith(traceRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Worker test trace is outside its isolated diagnostics directory.");
    for (var directory = new DirectoryInfo(Path.GetDirectoryName(tracePath)!); directory is not null; directory = directory.Parent)
    {
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Worker test trace reparse path is forbidden.");
        if (string.Equals(directory.FullName, traceRoot, StringComparison.OrdinalIgnoreCase)) break;
    }
}
void Step(string phase, WorkerRuntimeStatus? status = null)
{
    var line = JsonSerializer.Serialize(new { phase, elapsedMs = clock.ElapsedMilliseconds, pid = Environment.ProcessId,
        generation = status?.Generation, state = status?.State, workerPid = status?.WorkerPid });
    lock (traceGate)
    {
        try
        {
            Console.WriteLine(line);
            if (!string.IsNullOrWhiteSpace(tracePath)) File.AppendAllText(tracePath, line + Environment.NewLine);
        }
        catch (IOException) { traceWriteFailures++; }
        catch (UnauthorizedAccessException) { traceWriteFailures++; }
    }
}
Step("fixture-created");
var workerExecutable = Environment.ProcessPath ?? throw new InvalidOperationException("worker host path unavailable");
var flags = new WorkerFeatureFlagsSnapshot(true, true, true, "isolated-test", Path.Combine(tempRoot, "worker-feature-flags.json"), 1);
var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(
    tempRoot,
    workerExecutable,
    new[] { "worker" },
    Enabled: true,
    StartupTimeout: TimeSpan.FromSeconds(10),
    RequestTimeout: TimeSpan.FromSeconds(2)));
await using var runtime = new WorkerRuntimeController(supervisor, flags,
    heartbeatInterval: TimeSpan.FromMilliseconds(100),
    heartbeatTimeout: TimeSpan.FromMilliseconds(500),
    maxRecoveryAttempts: 3);
if (!string.IsNullOrWhiteSpace(tracePath))
{
    runtime.TestTrace = phase => Step("runtime." + phase);
    supervisor.TestTrace = phase => Step("supervisor." + phase);
}

Step("start.begin", runtime.Status);
var started = await runtime.StartAsync();
Step("start.end", runtime.Status);
var startedOk = started.Running && started.Enabled && started.State == "running";
using (var echo = await runtime.RequestAsync("echo"))
    startedOk &= echo.RootElement.GetProperty("Kind").GetString() == "response";
Step("echo.end", runtime.Status);

await Task.Delay(350);
var heartbeatObserved = runtime.Status.LastHeartbeatUtc is not null && runtime.Status.WorkerWorkingSetBytes is not null;
Step("heartbeat.observed", runtime.Status);

var requestCancelled = false;
Step("cancel.begin", runtime.Status);
try { using var slow = await runtime.RequestAsync("slow", timeout: TimeSpan.FromMilliseconds(100)); }
catch (TimeoutException) { requestCancelled = true; }
Step("cancel.end", runtime.Status);

Step("crash.begin", runtime.Status);
try { using var crash = await runtime.RequestAsync("crash", timeout: TimeSpan.FromMilliseconds(500)); }
catch { }
Step("crash.request-ended", runtime.Status);

var recoveryDeadline = DateTime.UtcNow.AddSeconds(8);
while (DateTime.UtcNow < recoveryDeadline && (runtime.Status.RecoveryCount < 1 || !runtime.Status.Running))
    await Task.Delay(100);
var crashRecovered = runtime.Status.RecoveryCount >= 1 && runtime.Status.Running;
Step("crash.recovered", runtime.Status);

var beforeGeneration = runtime.Status.Generation;
Step("rotation.begin", runtime.Status);
var rotation = await runtime.RotateTokenAsync();
var tokenRotated = rotation.Generation > beforeGeneration && rotation.PreviousToken != rotation.CurrentToken;
using (var echoAfterRotation = await runtime.RequestAsync("echo"))
    tokenRotated &= echoAfterRotation.RootElement.GetProperty("Kind").GetString() == "response";
Step("rotation.end", runtime.Status);

var concurrentRotation = false;
var concurrentRotationBaseline = runtime.Status.Generation;
var concurrentRotationGenerations = Array.Empty<long>();
string? concurrentRotationError = null;
try
{
    Step("concurrent-rotation.begin", runtime.Status);
    var rotationBaseline = concurrentRotationBaseline;
    var firstRotation = runtime.RotateTokenAsync();
    var secondRotation = runtime.RotateTokenAsync();
    var rotations = await Task.WhenAll(firstRotation, secondRotation);
    concurrentRotationGenerations = rotations.Select(result => result.Generation).OrderBy(generation => generation).ToArray();
    using var echoAfterConcurrentRotation = await runtime.RequestAsync("echo");
    concurrentRotation = rotations.Length == 2 &&
        concurrentRotationGenerations[0] == rotationBaseline + 1 &&
        concurrentRotationGenerations[1] == rotationBaseline + 2 &&
        runtime.Status.Running &&
        echoAfterConcurrentRotation.RootElement.GetProperty("Kind").GetString() == "response";
}
catch (Exception error) { concurrentRotation = false; concurrentRotationError = $"{error.GetType().Name}: {error.Message}"; }
Step("concurrent-rotation.end", runtime.Status);

var restartStorm = true;
try
{
    for (var attempt = 0; attempt < 3; attempt++)
    {
        Step("restart." + attempt + ".begin", runtime.Status);
        var restart = await runtime.RestartAsync();
        using var echoAfterRestart = await runtime.RequestAsync("echo");
        restartStorm &= restart.Running && runtime.Status.Running &&
            echoAfterRestart.RootElement.GetProperty("Kind").GetString() == "response";
        Step("restart." + attempt + ".end", runtime.Status);
    }
}
catch { restartStorm = false; }

var concurrentLifecycle = false;
try
{
    Step("concurrent-lifecycle.begin", runtime.Status);
    var rotationTask = runtime.RotateTokenAsync();
    var restartTask = runtime.RestartAsync();
    await Task.WhenAll(rotationTask, restartTask);
    using var echoAfterConcurrentLifecycle = await runtime.RequestAsync("echo");
    concurrentLifecycle = runtime.Status.Running &&
        echoAfterConcurrentLifecycle.RootElement.GetProperty("Kind").GetString() == "response";
}
catch { concurrentLifecycle = false; }
Step("concurrent-lifecycle.end", runtime.Status);

Step("stop.begin", runtime.Status);
var stopped = (await runtime.StopAsync()).State == "stopped" && !runtime.Status.Running;
Step("stop.end", runtime.Status);
await runtime.DisposeAsync();
Step("dispose.end", runtime.Status);
try { Directory.Delete(tempRoot, recursive: true); } catch { }

Console.WriteLine(JsonSerializer.Serialize(new
{
    ok = startedOk && heartbeatObserved && requestCancelled && crashRecovered && tokenRotated &&
        concurrentRotation && restartStorm && concurrentLifecycle && stopped && traceWriteFailures == 0 && supervisor.TestTraceErrors == 0 && runtime.TestTraceErrors == 0,
    traceWriteFailures,
    traceObserverErrors = supervisor.TestTraceErrors + runtime.TestTraceErrors,
    flags = new
    {
        workerRuntimeEnabled = flags.WorkerRuntimeEnabled,
        workerQueueAdapterEnabled = flags.WorkerQueueAdapterEnabled,
        workerFencingEnabled = flags.WorkerFencingEnabled,
    },
    started = startedOk,
    heartbeatObserved,
    requestCancelled,
    crashRecovered,
    tokenRotated,
    concurrentRotation,
    concurrentLifecycle,
    concurrentRotationBaseline,
    concurrentRotationGenerations,
    concurrentRotationError,
    restartStorm,
    stopped,
    isolatedWorkerStarted = true,
    productionWorkerStarted = false,
    productionDatabaseOpened = false,
    tempRootClean = !Directory.Exists(tempRoot),
    currentSidVerified = WindowsIdentity.GetCurrent().User is not null,
}, new JsonSerializerOptions { WriteIndented = false }));

static async Task RunWorkerAsync(string[] workerArguments)
{
    var pipeName = Environment.GetEnvironmentVariable("ZHIKE_WORKER_PIPE") ?? throw new InvalidOperationException("pipe env missing");
    var token = Environment.GetEnvironmentVariable("ZHIKE_WORKER_TOKEN") ?? throw new InvalidOperationException("token env missing");
    var sessionId = Environment.GetEnvironmentVariable("ZHIKE_WORKER_SESSION") ?? throw new InvalidOperationException("session env missing");
    using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
        TokenImpersonationLevel.Impersonation, HandleInheritability.None);
    await pipe.ConnectAsync(5000);
    using var reader = new StreamReader(pipe, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, leaveOpen: true);
    await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
    var helloId = Guid.NewGuid().ToString("N");
    await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(new WorkerIpcEnvelope(
        WorkerIpcProtocol.CurrentSchemaVersion, "hello", helloId, sessionId,
        Guid.NewGuid().ToString("N"), WorkerIpcProtocol.ComputeProof(token, helloId, sessionId))));
    var ioMode = workerArguments.ElementAtOrDefault(1);
    var ioMarker = workerArguments.ElementAtOrDefault(2);
    if (ioMode == "stall-reader-once" && ioMarker is not null && !File.Exists(ioMarker))
    {
        var markerPath = Path.GetFullPath(ioMarker);
        var markerRoot = Path.GetDirectoryName(markerPath)!;
        if (!string.Equals(Path.GetDirectoryName(markerRoot), Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(markerRoot).StartsWith("zhike-stage2-io-", StringComparison.Ordinal))
            throw new InvalidOperationException("IO probe marker is outside its temporary root.");
        File.WriteAllText(markerPath, "isolated-reader-stalled-once");
        await Task.Delay(TimeSpan.FromSeconds(20));
        return;
    }
    var writeGate = new SemaphoreSlim(1, 1);
    var pending = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
    async Task SendAsync(WorkerIpcEnvelope response)
    {
        await writeGate.WaitAsync();
        try { await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(response)); }
        finally { writeGate.Release(); }
    }

    while (true)
    {
        var line = await reader.ReadLineAsync();
        if (line is null) return;
        WorkerIpcEnvelope request;
        try { request = WorkerIpcProtocol.Deserialize(line); }
        catch (WorkerIpcProtocolException) { continue; }
        if (!WorkerIpcProtocol.VerifyProof(token, request))
        {
            await SendAsync(WorkerIpcProtocol.Error(request.RequestId, sessionId, "AUTH_REVOKED", request.TraceId));
            continue;
        }
        if (request.Kind == "crash") Environment.Exit(78);
        if (ioMode == "ignore-cancel" && request.Kind is "slow" or "cancel") continue;
        if (request.Kind == "cancel")
        {
            if (pending.TryRemove(request.RequestId, out var cancelled)) cancelled.Cancel();
            continue;
        }
        if (request.Kind == "slow")
        {
            var slowCancellation = new CancellationTokenSource();
            pending[request.RequestId] = slowCancellation;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), slowCancellation.Token);
                    await SendAsync(new WorkerIpcEnvelope(WorkerIpcProtocol.CurrentSchemaVersion, "response", request.RequestId, sessionId, request.TraceId));
                }
                catch (OperationCanceledException)
                {
                    await SendAsync(WorkerIpcProtocol.Error(request.RequestId, sessionId, "CANCELLED", request.TraceId));
                }
                finally { pending.TryRemove(request.RequestId, out _); slowCancellation.Dispose(); }
            });
            continue;
        }
        await SendAsync(new WorkerIpcEnvelope(
            WorkerIpcProtocol.CurrentSchemaVersion, "response", request.RequestId, sessionId, request.TraceId));
    }
}

static async Task RunIoBoundaryProbeAsync()
{
    var root = Path.Combine(Path.GetTempPath(), "zhike-stage2-io-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var executable = Environment.ProcessPath ?? throw new InvalidOperationException("test apphost unavailable");
    var results = new List<object>();
    try
    {
        foreach (var callerCancellation in new[] { false, true })
        {
            var marker = Path.Combine(root, callerCancellation ? "caller-stalled" : "deadline-stalled");
            await using var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, executable,
                new[] { "worker", "stall-reader-once", marker }, Enabled: true,
                StartupTimeout: TimeSpan.FromSeconds(5), RequestTimeout: TimeSpan.FromMilliseconds(150)));
            await supervisor.StartAsync();
            var oldGeneration = supervisor.Status.Generation;
            var oldPipe = supervisor.PipeName;
            var oldPid = supervisor.WorkerProcess!.Id;
            var oldStart = supervisor.WorkerProcess.StartTime.ToUniversalTime();
            using var caller = new CancellationTokenSource();
            if (callerCancellation) caller.CancelAfter(75);
            var clock = Stopwatch.StartNew();
            var operation = supervisor.RequestAsync("echo", JsonSerializer.SerializeToElement(new { text = new string('x', 128 * 1024) }),
                timeout: callerCancellation ? TimeSpan.FromSeconds(2) : TimeSpan.FromMilliseconds(150), cancellationToken: caller.Token);
            var expectedError = false;
            try { using var unexpected = await operation.WaitAsync(TimeSpan.FromSeconds(3)); }
            catch (TimeoutException) when (!callerCancellation)
            {
                if (!operation.IsCompleted) throw new InvalidOperationException("Initial pipe write exceeded its unchanged request deadline.");
                expectedError = true;
            }
            catch (OperationCanceledException) when (callerCancellation) { expectedError = true; }
            if (!expectedError || supervisor.IsRunning) throw new InvalidOperationException("Partial write did not invalidate its captured connection.");
            var elapsed = clock.ElapsedMilliseconds;
            await supervisor.RotateTokenAsync();
            var restarted = supervisor.Status;
            using var echo = await supervisor.RequestAsync("echo", timeout: TimeSpan.FromSeconds(2));
            var newConnectionWorks = restarted.Generation > oldGeneration && supervisor.PipeName != oldPipe && echo.RootElement.GetProperty("Kind").GetString() == "response";
            if (!newConnectionWorks) throw new InvalidOperationException("A fresh authenticated generation did not recover after the partial write.");
            AssertOwnedProcessExited(oldPid, oldStart);
            results.Add(new { caseName = callerCancellation ? "caller-cancellation-during-write" : "deadline-during-write", elapsedMs = elapsed, oldConnectionInvalidated = true, freshGenerationWorks = newConnectionWorks, previousProcessExited = true });
            var livePid = supervisor.WorkerProcess!.Id;
            var liveStart = supervisor.WorkerProcess.StartTime.ToUniversalTime();
            await supervisor.StopAsync();
            AssertOwnedProcessExited(livePid, liveStart);
        }
        await using (var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, executable,
            new[] { "worker", "ignore-cancel" }, Enabled: true, StartupTimeout: TimeSpan.FromSeconds(5))))
        {
            await supervisor.StartAsync();
            var clock = Stopwatch.StartNew();
            var operation = supervisor.RequestAsync("slow", timeout: TimeSpan.FromMilliseconds(100));
            try { using var unexpected = await operation.WaitAsync(TimeSpan.FromSeconds(3)); throw new InvalidOperationException("Missing cancellation acknowledgement was accepted."); }
            catch (TimeoutException) { if (!operation.IsCompleted) throw new InvalidOperationException("Cancel write/drain was not bounded by its existing cleanup allowance."); }
            if (supervisor.IsRunning) throw new InvalidOperationException("Unacknowledged cancellation left the old stream reusable.");
            results.Add(new { caseName = "missing-cancel-acknowledgement", elapsedMs = clock.ElapsedMilliseconds, oldConnectionInvalidated = true });
            var livePid = supervisor.WorkerProcess!.Id;
            var liveStart = supervisor.WorkerProcess.StartTime.ToUniversalTime();
            await supervisor.StopAsync();
            AssertOwnedProcessExited(livePid, liveStart);
        }
        // Force the real Process.HasExited failure path between acquisition
        // and request setup. The second call must not inherit a leaked gate.
        await using (var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, Enabled: true)))
        {
            var field = typeof(WorkerSupervisor).GetField("_worker", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
            var disposed = new Process(); disposed.Dispose(); field.SetValue(supervisor, disposed);
            var setupRejected = false;
            try { using var unexpected = await supervisor.RequestAsync("echo"); }
            catch (InvalidOperationException) { setupRejected = true; }
            if (!setupRejected) throw new InvalidOperationException("Disposed process was accepted.");
            field.SetValue(supervisor, null);
            using var deadline = new CancellationTokenSource(200);
            var rejectedWithoutGateLeak = false;
            try { using var unexpected = await supervisor.RequestAsync("echo", cancellationToken: deadline.Token); }
            catch (InvalidOperationException) { rejectedWithoutGateLeak = true; }
            if (!rejectedWithoutGateLeak) throw new InvalidOperationException("Request setup exception leaked its semaphore.");
            results.Add(new { caseName = "setup-exception-gate-release", rejectedWithoutGateLeak });
        }
        await using (var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, Enabled: true)))
        {
            await supervisor.RotateTokenAsync();
            if (supervisor.WorkerProcess is not null || supervisor.IsRunning) throw new InvalidOperationException("Rotation unexpectedly started a never-started Worker.");
            await supervisor.StopAsync();
            await supervisor.RotateTokenAsync();
            if (supervisor.WorkerProcess is not null || supervisor.IsRunning) throw new InvalidOperationException("Rotation unexpectedly started a stopped Worker.");
            results.Add(new { caseName = "stopped-rotation-does-not-start-worker", noProcessStarted = true });
        }
        Console.WriteLine(JsonSerializer.Serialize(new { ok = true, cases = results, productionWorkerStarted = false, productionDatabaseOpened = false }));
    }
    finally { Directory.Delete(root, recursive: true); }
}

static void AssertOwnedProcessExited(int pid, DateTime startedUtc)
{
    try
    {
        using var process = Process.GetProcessById(pid);
        if (process.StartTime.ToUniversalTime() == startedUtc && !process.HasExited)
            throw new InvalidOperationException("An owned Worker remained alive after its lifecycle operation returned.");
    }
    catch (ArgumentException) { }
}

static void RunFeatureFlagProbe()
{
    var root = Path.Combine(Path.GetTempPath(), "zhike-stage2-flags-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    try
    {
        var missing = WorkerFeatureFlags.Load(root);
        File.WriteAllText(Path.Combine(root, "worker-feature-flags.json"), "{\"schemaVersion\":999,\"WorkerRuntimeEnabled\":true,\"WorkerQueueAdapterEnabled\":true,\"WorkerFencingEnabled\":true}");
        var invalid = WorkerFeatureFlags.Load(root);
        File.WriteAllText(Path.Combine(root, "worker-feature-flags.json"), "{\"schemaVersion\":1,\"revision\":7,\"WorkerRuntimeEnabled\":true,\"WorkerQueueAdapterEnabled\":true,\"WorkerFencingEnabled\":false}");
        var valid = WorkerFeatureFlags.Load(root);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = !missing.WorkerRuntimeEnabled && !missing.WorkerQueueAdapterEnabled && !missing.WorkerFencingEnabled &&
                 !invalid.WorkerRuntimeEnabled && !invalid.WorkerQueueAdapterEnabled && !invalid.WorkerFencingEnabled &&
                 valid.WorkerRuntimeEnabled && valid.WorkerQueueAdapterEnabled && !valid.WorkerFencingEnabled &&
                 valid.Source == "file" && valid.Revision == 7,
            missing = new { runtime = missing.WorkerRuntimeEnabled, queue = missing.WorkerQueueAdapterEnabled, fencing = missing.WorkerFencingEnabled },
            invalid = new { runtime = invalid.WorkerRuntimeEnabled, queue = invalid.WorkerQueueAdapterEnabled, fencing = invalid.WorkerFencingEnabled },
            valid = new { runtime = valid.WorkerRuntimeEnabled, queue = valid.WorkerQueueAdapterEnabled, fencing = valid.WorkerFencingEnabled },
            validSource = valid.Source,
            validRevision = valid.Revision,
        }));
    }
    finally { try { Directory.Delete(root, recursive: true); } catch { } }
}

static async Task RunDisabledProbeAsync()
{
    var root = Path.Combine(Path.GetTempPath(), "zhike-stage2-disabled-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var flags = WorkerFeatureFlagsSnapshot.Disabled(Path.Combine(root, "worker-feature-flags.json"));
    await using var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(
        root, Path.Combine(root, "missing-worker.exe"), Enabled: true));
    await using var runtime = new WorkerRuntimeController(supervisor, flags);
    var status = await runtime.StartAsync();
    var result = new
    {
        ok = status.State == "disabled" && !status.Running && supervisor.WorkerProcess is null,
        state = status.State,
        running = status.Running,
        workerProcessStarted = supervisor.WorkerProcess is not null,
        productionWorkerStarted = false,
    };
    await runtime.DisposeAsync();
    try { Directory.Delete(root, recursive: true); } catch { }
    Console.WriteLine(JsonSerializer.Serialize(result));
}
