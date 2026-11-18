using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Zhike.Desktop.Services;

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, status = "NotTested", reason = "Named Pipe ACL requires Windows" }));
    return;
}

if (args.FirstOrDefault() == "worker")
{
    await RunWorkerAsync(args.Skip(1).ToArray());
    return;
}

if (args.FirstOrDefault() == "cross-host")
{
    await RunCrossSidHostAsync(args.Skip(1).ToArray());
    return;
}

if (args.FirstOrDefault() == "cross-client")
{
    await RunCrossSidClientAsync(args.Skip(1).ToArray());
    return;
}

await RunProbeAsync();

static async Task RunCrossSidHostAsync(string[] args)
{
    if (args.Length < 1) throw new ArgumentException("cross-host requires an endpoint file path.");
    var endpointFile = Path.GetFullPath(args[0]);
    var root = Path.GetDirectoryName(endpointFile) ?? throw new InvalidOperationException("Endpoint directory is required.");
    Directory.CreateDirectory(root);
    var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Worker harness executable path unavailable");
    var currentSid = WindowsIdentity.GetCurrent().User?.Value ?? string.Empty;
    var delayMs = args.Length > 1 && int.TryParse(args[1], out var parsedDelay) ? Math.Clamp(parsedDelay, 0, 30000) : 5000;
    var resultFile = endpointFile + ".host-result.json";
    var supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(
        root, executable, new[] { "worker", $"delay-connect-ms={delayMs}" }, Enabled: true,
        StartupTimeout: TimeSpan.FromSeconds(20), RequestTimeout: TimeSpan.FromSeconds(5)));
    try
    {
        var startTask = supervisor.StartAsync();
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (string.IsNullOrWhiteSpace(supervisor.PipeName) && DateTime.UtcNow < deadline)
            await Task.Delay(25);
        if (string.IsNullOrWhiteSpace(supervisor.PipeName))
            throw new InvalidOperationException("Supervisor did not publish a pipe endpoint.");
        await File.WriteAllTextAsync(endpointFile, JsonSerializer.Serialize(new
        {
            pipeName = supervisor.PipeName,
            hostSid = currentSid,
            workspaceRoot = root,
            createdUtc = DateTimeOffset.UtcNow,
            note = "No token is written; this file is only a test endpoint."
        }, new JsonSerializerOptions { WriteIndented = true }));

        string status;
        string? error = null;
        try
        {
            var started = await startTask;
            status = started.Running ? "A_CONNECTED" : "A_NOT_RUNNING";
        }
        catch (Exception exception)
        {
            status = exception is UnauthorizedAccessException ? "PEER_SID_REJECTED" : "HOST_FAILED";
            error = exception.GetType().Name;
        }
        await File.WriteAllTextAsync(resultFile, JsonSerializer.Serialize(new
        {
            status,
            error,
            hostSid = currentSid,
            peerSid = supervisor.PeerSid,
            pipeName = supervisor.PipeName,
            productionWorkerStarted = false,
            productionDatabaseOpened = false
        }, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = status == "A_CONNECTED",
            mode = "cross-host",
            status,
            endpointFile,
            resultFile,
            hostSid = currentSid,
            peerSid = supervisor.PeerSid,
            productionWorkerStarted = false,
            productionDatabaseOpened = false
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
    finally
    {
        await supervisor.DisposeAsync();
    }
}

static async Task RunCrossSidClientAsync(string[] args)
{
    if (args.Length < 1) throw new ArgumentException("cross-client requires an endpoint file path.");
    var endpointFile = Path.GetFullPath(args[0]);
    var endpoint = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(endpointFile));
    var pipeName = endpoint.GetProperty("pipeName").GetString() ?? throw new InvalidOperationException("Endpoint pipe name missing.");
    var clientSid = WindowsIdentity.GetCurrent().User?.Value ?? string.Empty;
    var resultFile = endpointFile + ".client-result.json";
    var connected = false;
    string? errorType = null;
    string? errorCode = null;
    try
    {
        using var client = new NamedPipeClientStream(
            ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
            TokenImpersonationLevel.Impersonation, HandleInheritability.None);
        await client.ConnectAsync(3000);
        connected = true;
        // No token or business payload is available to this process. A
        // connected B process is itself an ACL failure; it never executes a
        // Worker command. Closing the stream leaves the host unchanged.
    }
    catch (Exception exception)
    {
        errorType = exception.GetType().Name;
        errorCode = exception.HResult.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    var result = new
    {
        mode = "cross-client",
        clientSid,
        hostPipeConnected = connected,
        aclDenied = !connected,
        businessOperationExecuted = false,
        errorType,
        errorCode,
        productionWorkerStarted = false,
        productionDatabaseOpened = false
    };
    await File.WriteAllTextAsync(resultFile, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
}

static async Task RunProbeAsync()
{
    var root = Path.Combine(Path.GetTempPath(), "zhike-stage1-5-ipc-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Worker harness executable path unavailable");
    var currentSid = System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value ?? "";
    var wrongTokenRejected = false;
    var rotationRejected = false;
    var invalidFrameRejected = false;
    var crashRecovered = false;
    var timeoutCancelled = false;
    var callerCancelled = false;
    WorkerSupervisor? supervisor = null;
    try
    {
        // Wrong proof must fail during the real supervisor handshake.
        await using (var bad = new WorkerSupervisor(new WorkerSupervisorOptions(root, executable, new[] { "worker", "wrong" }, Enabled: true, StartupTimeout: TimeSpan.FromSeconds(5))))
        {
            try { await bad.StartAsync(); }
            catch (WorkerIpcProtocolException error) when (error.Code == "AUTH_REVOKED") { wrongTokenRejected = true; }
        }

        supervisor = new WorkerSupervisor(new WorkerSupervisorOptions(root, executable, new[] { "worker" }, Enabled: true, StartupTimeout: TimeSpan.FromSeconds(5), RequestTimeout: TimeSpan.FromSeconds(2)));
        var started = await supervisor.StartAsync();
        if (!started.Running || started.PeerSid != currentSid || !started.PipeName.StartsWith("Zhike6-", StringComparison.Ordinal))
            throw new InvalidOperationException("Supervisor did not establish a current-SID Named Pipe session.");

        using (var echo = await supervisor.RequestAsync("echo"))
        {
            if (echo.RootElement.GetProperty("Kind").GetString() != "response") throw new InvalidOperationException("echo response missing");
        }

        try { await supervisor.RequestAsync("slow", timeout: TimeSpan.FromMilliseconds(150)); }
        catch (TimeoutException) { timeoutCancelled = true; }

        using (var callerCancellation = new CancellationTokenSource(100))
        {
            try
            {
                await supervisor.RequestAsync("slow", timeout: TimeSpan.FromSeconds(2), cancellationToken: callerCancellation.Token);
            }
            catch (OperationCanceledException) when (callerCancellation.IsCancellationRequested)
            {
                callerCancelled = true;
            }
        }

        var oldPipeName = supervisor.PipeName;
        var oldToken = supervisor.CurrentToken;
        var oldGeneration = supervisor.Status.Generation;
        var rotation = await supervisor.RotateTokenAsync();
        if (rotation.PreviousToken != oldToken || rotation.CurrentToken == oldToken || rotation.Generation <= oldGeneration)
            throw new InvalidOperationException("token rotation did not create a new generation");
        // The old session is closed before the new one is exposed. A client
        // holding the old pipe name/token cannot reconnect to it.
        try
        {
            using var oldClient = new NamedPipeClientStream(".", oldPipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await oldClient.ConnectAsync(250);
        }
        catch (Exception error) when (error is IOException or TimeoutException)
        {
            rotationRejected = true;
        }
        using (var echoAfterRotation = await supervisor.RequestAsync("echo"))
        {
            if (echoAfterRotation.RootElement.GetProperty("Kind").GetString() != "response")
                throw new InvalidOperationException("rotated session did not recover");
        }

        await supervisor.RestartAsync();
        try { await supervisor.RequestAsync("invalid"); }
        catch (WorkerIpcProtocolException error) when (error.Code == "INVALID_REQUEST") { invalidFrameRejected = true; }

        await supervisor.RestartAsync();
        try { await supervisor.RequestAsync("crash"); }
        catch (Exception) { }
        await Task.Delay(100);
        await supervisor.RestartAsync();
        using (var echoAfterCrash = await supervisor.RequestAsync("echo"))
        {
            crashRecovered = echoAfterCrash.RootElement.GetProperty("Kind").GetString() == "response";
        }

        await supervisor.StopAsync();
        try { Directory.Delete(root, recursive: true); } catch { }
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = wrongTokenRejected && rotationRejected && timeoutCancelled && callerCancelled && invalidFrameRejected && crashRecovered,
            // The same-user host/Worker integration is Passed, but the
            // required second Windows SID is unavailable in this environment.
            // Keep the aggregate gate NotTested instead of overstating IPC as
            // production-ready.
            status = wrongTokenRejected && rotationRejected && timeoutCancelled && callerCancelled && invalidFrameRejected && crashRecovered ? "NotTested" : "Failed",
            integrationStatus = wrongTokenRejected && rotationRejected && timeoutCancelled && callerCancelled && invalidFrameRejected && crashRecovered ? "Passed" : "Failed",
            transport = "Windows Named Pipe",
            currentSid,
            peerSid = started.PeerSid,
            acl = "current SID only",
            anonymous = false,
            wrongTokenRejected,
            tokenRotationRejected = rotationRejected,
            timeoutCancelled,
            callerCancelled,
            invalidFrameRejected,
            crashRecovered,
            reconnect = crashRecovered,
            differentWindowsUser = "NotTested",
            productionWorkerStarted = false,
            productionDatabaseOpened = false,
            tempRootClean = !Directory.Exists(root),
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
    finally
    {
        if (supervisor is not null) await supervisor.DisposeAsync();
        try { Directory.Delete(root, recursive: true); } catch { }
    }
}

static async Task RunWorkerAsync(string[] args)
{
    var pipeName = Environment.GetEnvironmentVariable("ZHIKE_WORKER_PIPE") ?? throw new InvalidOperationException("pipe env missing");
    var token = Environment.GetEnvironmentVariable("ZHIKE_WORKER_TOKEN") ?? throw new InvalidOperationException("token env missing");
    var sessionId = Environment.GetEnvironmentVariable("ZHIKE_WORKER_SESSION") ?? throw new InvalidOperationException("session env missing");
    var wrong = args.Contains("wrong", StringComparer.OrdinalIgnoreCase);
    var delayArgument = args.FirstOrDefault(value => value.StartsWith("delay-connect-ms=", StringComparison.OrdinalIgnoreCase));
    if (delayArgument is not null && int.TryParse(delayArgument["delay-connect-ms=".Length..], out var delayMs))
        await Task.Delay(Math.Clamp(delayMs, 0, 30000));
    // Allow the server to perform the required SID check after the hello
    // frame. The default Identification level is insufficient for
    // GetImpersonationUserName on Windows.
    using var pipe = new NamedPipeClientStream(
        ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
        TokenImpersonationLevel.Impersonation, HandleInheritability.None);
    await pipe.ConnectAsync(5000);
    using var reader = new StreamReader(pipe, new UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, leaveOpen: true);
    await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
    var helloId = Guid.NewGuid().ToString("N");
    var helloToken = wrong ? token + "-invalid" : token;
    await writer.WriteLineAsync(WorkerIpcProtocol.Serialize(new WorkerIpcEnvelope(
        WorkerIpcProtocol.CurrentSchemaVersion,
        "hello",
        helloId,
        sessionId,
        Guid.NewGuid().ToString("N"),
        WorkerIpcProtocol.ComputeProof(helloToken, helloId, sessionId))));
    if (wrong) { await Task.Delay(300); return; }

    var pending = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
    var writeGate = new SemaphoreSlim(1, 1);
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
        catch (WorkerIpcProtocolException)
        {
            await writer.WriteLineAsync("not-json");
            continue;
        }
        if (!WorkerIpcProtocol.VerifyProof(token, request))
        {
            await SendAsync(WorkerIpcProtocol.Error(request.RequestId, sessionId, "AUTH_REVOKED"));
            continue;
        }
        if (request.Kind == "cancel")
        {
            if (pending.TryRemove(request.RequestId, out var cts)) cts.Cancel();
            continue;
        }
        if (request.Kind == "slow")
        {
            var cts = new CancellationTokenSource();
            pending[request.RequestId] = cts;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), cts.Token);
                    await SendAsync(new WorkerIpcEnvelope(1, "response", request.RequestId, sessionId, request.TraceId));
                }
                catch (OperationCanceledException)
                {
                    await SendAsync(WorkerIpcProtocol.Error(request.RequestId, sessionId, "CANCELLED", request.TraceId));
                }
                finally { pending.TryRemove(request.RequestId, out _); cts.Dispose(); }
            });
            continue;
        }
        if (request.Kind == "invalid")
        {
            await writer.WriteLineAsync("{invalid");
            continue;
        }
        if (request.Kind == "crash") Environment.Exit(77);
        await SendAsync(new WorkerIpcEnvelope(1, "response", request.RequestId, sessionId, request.TraceId));
    }
}



