using System.Collections.Concurrent;
using System.Text.Json;
using System.Diagnostics;
using System.Reflection;
using Zhike.Desktop.Services;

if (args.Length != 1) throw new ArgumentException("Explicit repository app resource root required.");
var root = Path.Combine(Path.GetTempPath(), "zhike-stage51-readiness-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
// Poison only this test process, never the machine/user environment. A normal
// host must not turn inherited development toggles into sidecar authority.
var inheritedFlags = new Dictionary<string, string?>();
foreach (var entry in new Dictionary<string, string> {
    ["ZHIKE_FENCING_MODE"] = "isolated", ["ZHIKE_GROUP_MANAGER_MODE"] = "isolated",
    ["ZHIKE_STAGE3_MOCK"] = "1", ["ZHIKE_AI_PIPELINE_MODE"] = "isolated", ["ZHIKE_STAGE4_MOCK"] = "1" })
{
    inheritedFlags[entry.Key] = Environment.GetEnvironmentVariable(entry.Key);
    Environment.SetEnvironmentVariable(entry.Key, entry.Value);
}
var service = new LocalServiceManager(Path.GetFullPath(args[0]), root);
var paused = new PausedContext();
var watch = Stopwatch.StartNew();
Task<LocalServiceInfo> start;
SynchronizationContext.SetSynchronizationContext(paused);
try { start = service.StartAsync(); } finally { SynchronizationContext.SetSynchronizationContext(null); }
// Existing service budget: three 15s health attempts, each with bounded stop;
// this wait covers that budget without providing a UI message pump.
var readyWithoutUiPump = await Task.WhenAny(start, Task.Delay(75000)) == start && start.IsCompletedSuccessfully;
var startupMs = watch.ElapsedMilliseconds;
// Clean up the real isolated sidecar even when reproducing the old defect.
for (var n = 0; n < 400 && !start.IsCompleted; n++) { paused.Drain(); await Task.Delay(25); }
try
{
    if (!start.IsCompletedSuccessfully) throw new Exception("Isolated readiness probe failed to initialize.");
    if (!readyWithoutUiPump) throw new Exception("Sidecar readiness incorrectly depends on a running UI synchronization context.");
    using var authenticated = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    authenticated.DefaultRequestHeaders.Add("X-Zhike-Api-Token", start.Result.ApiToken);
    foreach (var route in new[] { "api/ws/fencing", "api/ws/group-manager/groups", "api/ws/ai-pipeline/jobs" })
    {
        using var gateResponse = await authenticated.GetAsync(new Uri(start.Result.BaseAddress, route));
        if (gateResponse.StatusCode != System.Net.HttpStatusCode.NotFound)
            throw new Exception($"Normal host inherited isolated authority at {route}: HTTP {(int)gateResponse.StatusCode}.");
    }
    using var healthResponse = await authenticated.GetAsync(new Uri(start.Result.BaseAddress, "api/health"));
    using var health = JsonDocument.Parse(await healthResponse.Content.ReadAsStringAsync());
    if (!healthResponse.IsSuccessStatusCode || health.RootElement.GetProperty("databaseStatus").GetString() != "queryable"
        || health.RootElement.GetProperty("workerStatus").GetString() != "unknown"
        || health.RootElement.GetProperty("databaseCheck").GetString() != "schema-read"
        || health.RootElement.GetProperty("sidecarStatus").GetString() != "running")
        throw new Exception("Health must distinguish a successful SQLite query from integrity and unobserved Worker liveness.");
    using var unauthenticated = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    using var invalidStop = new HttpRequestMessage(HttpMethod.Post, new Uri(start.Result.BaseAddress, "api/shutdown"));
    invalidStop.Headers.Add("X-Zhike-Shutdown-Token", start.Result.ApiToken);
    using var rejected = await unauthenticated.SendAsync(invalidStop);
    if (rejected.StatusCode != System.Net.HttpStatusCode.Unauthorized || !service.IsRunning) throw new Exception("Shutdown authorization boundary regression.");
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    var cancellationPropagated = false;
    try { await service.StopAsync(cancelled.Token); } catch (OperationCanceledException) { cancellationPropagated = true; }
    if (!cancellationPropagated || !service.IsRunning) throw new Exception("Caller cancellation was swallowed or stopped an unrequested process.");
    var owned = (Process?)typeof(LocalServiceManager).GetField("_process", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(service) ?? throw new Exception("Owned process missing.");
    using var observed = Process.GetProcessById(owned.Id);
    _ = observed.SafeHandle;
    await service.StopAsync();
    if (!observed.HasExited || observed.ExitCode != 0) throw new Exception("Sidecar failed authenticated graceful shutdown.");
    await VerifyCancelledStartupAsync(Path.GetFullPath(args[0]), Path.Combine(root, "cancelled-start"));
    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, inheritedIsolationRejected = true, healthScopeTruthful = true, readyWithoutUiPump, cancellationPropagated, unauthorizedShutdownRejected = true, authenticatedGracefulShutdown = true, exitCode = observed.ExitCode, cancelledStartAndRestartRetired = true, startupMs, productionOpened = false, pendingUiCallbacks = paused.Count }));
}
finally {
    foreach (var entry in inheritedFlags) Environment.SetEnvironmentVariable(entry.Key, entry.Value);
    await service.DisposeAsync(); Directory.Delete(root, recursive: true);
}

static async Task VerifyCancelledStartupAsync(string resourceRoot, string dataRoot)
{
    using var paused = new PauseNextHealthHandler();
    await using var service = new LocalServiceManager(resourceRoot, dataRoot);
    // The linked production service still owns a real Node child and its
    // isolated data directory. Hold only the first health request so cancellation
    // is deterministic even when the local fixture starts quickly.
    var httpField = typeof(LocalServiceManager).GetField("_http", BindingFlags.Instance | BindingFlags.NonPublic)!;
    var defaultClient = (HttpClient)httpField.GetValue(service)!;
    httpField.SetValue(service, new HttpClient(paused, disposeHandler: false) { Timeout = TimeSpan.FromSeconds(5) });
    defaultClient.Dispose();

    await CancelDuringHealthAsync(service, paused, restart: false);
    await service.StartAsync();
    await CancelDuringHealthAsync(service, paused, restart: true);
    var ready = await service.StartAsync();
    if (!service.IsRunning || service.Info != ready || !await service.HealthAsync())
        throw new Exception("A fresh start after cancelled readiness did not reach health.");
    await service.StopAsync();
}

static async Task CancelDuringHealthAsync(LocalServiceManager service, PauseNextHealthHandler handler, bool restart)
{
    using var cancelled = new CancellationTokenSource();
    var enteredHealth = handler.PauseNextRequest();
    var start = restart ? service.RestartAsync(cancelled.Token) : service.StartAsync(cancelled.Token);
    await enteredHealth.WaitAsync(TimeSpan.FromSeconds(10));
    var processField = typeof(LocalServiceManager).GetField("_process", BindingFlags.Instance | BindingFlags.NonPublic)!;
    var owned = (Process?)processField.GetValue(service) ?? throw new Exception("Missing pending sidecar process.");
    using var observed = Process.GetProcessById(owned.Id);
    _ = observed.SafeHandle;
    var advertisedWhileWaiting = service.IsRunning || service.Info is not null;
    cancelled.Cancel();
    try { await start.WaitAsync(TimeSpan.FromSeconds(12)); }
    catch (OperationCanceledException) when (cancelled.IsCancellationRequested)
    {
        if (!observed.HasExited || service.IsRunning || service.Info is not null || advertisedWhileWaiting)
            throw new Exception($"Cancelled {(restart ? "restart" : "start")} left an owned child alive or advertised its unvalidated endpoint.");
        return;
    }
    throw new Exception($"Cancelled {(restart ? "restart" : "start")} did not propagate caller cancellation.");
}

sealed class PauseNextHealthHandler() : DelegatingHandler(new HttpClientHandler())
{
    private TaskCompletionSource? _pending;

    public Task PauseNextRequest()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (Interlocked.CompareExchange(ref _pending, entered, null) is not null)
            throw new InvalidOperationException("A controlled health request is already armed.");
        return entered.Task;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Get && request.RequestUri?.AbsolutePath == "/api/health" &&
            Interlocked.Exchange(ref _pending, null) is { } entered)
        {
            entered.SetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
        return await base.SendAsync(request, cancellationToken);
    }
}

sealed class PausedContext : SynchronizationContext
{
    private readonly ConcurrentQueue<(SendOrPostCallback callback, object? state)> queue = new();
    public int Count => queue.Count;
    public override void Post(SendOrPostCallback callback, object? state) => queue.Enqueue((callback, state));
    public void Drain() { while (queue.TryDequeue(out var item)) item.callback(item.state); }
}
namespace Zhike.Desktop { public static class App { public static LocalServiceManager? LocalService => null; } }
