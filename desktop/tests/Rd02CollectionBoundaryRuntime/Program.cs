using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Zhike.Desktop.Services;

var root = Path.Combine(Path.GetTempPath(), "zhike-rd02-native-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var failures = new List<string>(); var passed = 0;
void Assert(bool valid, string message) { if (!valid) throw new InvalidOperationException(message); }
async Task Check(string name, Func<Task> test)
{
    try { await test(); passed++; Console.WriteLine("[PASS] " + name); }
    catch (Exception error) { failures.Add(name); Console.WriteLine("[FAIL] " + name + ": " + error.Message); }
}
string Digest(string folder) => string.Join("|", Directory.Exists(folder) ? Directory.GetFiles(folder, "*", SearchOption.AllDirectories).Order().Select(file => Path.GetRelativePath(folder, file) + ":" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)))) : []);
async Task Blocked(Func<Task> invoke)
{
    try { await invoke(); } catch (InvalidOperationException error) when (error.Message.Contains("COLLECTION_CAPABILITY_BLOCKED", StringComparison.Ordinal)) { return; }
    throw new InvalidOperationException("Collector operation did not return COLLECTION_CAPABILITY_BLOCKED before filesystem/environment activity");
}
try
{
    var existing = Path.Combine(root, "profiles");
    Directory.CreateDirectory(Path.Combine(existing, "visible-a", "IndexedDB"));
    File.WriteAllText(Path.Combine(existing, "visible-a", "IndexedDB", "synthetic-marker.txt"), "synthetic fixture only; not authentication data");
    Directory.CreateDirectory(Path.Combine(existing, "visible-a-collector"));
    File.WriteAllText(Path.Combine(existing, "visible-a-collector", "preserve-existing.txt"), "synthetic prior collector must remain untouched");
    var profiles = new WebViewProfileService(existing);
    await Check("prepare rejects before copying or replacing existing synthetic profiles", async () =>
    {
        var before = Digest(existing);
        try { await Blocked(() => profiles.PrepareCollectorProfileAsync("visible-a")); }
        finally { Assert(Digest(existing) == before, "Synthetic profile contents changed through collector preparation"); }
    });
    await Check("collector environment is denied without creating a profile or environment", async () =>
    {
        var before = Digest(existing); var count = CoreWebView2Environment.Created;
        try { await Blocked(async () => { await profiles.GetOrCreateCollectorProfileAsync("visible-b"); }); }
        finally { Assert(Digest(existing) == before && !Directory.Exists(Path.Combine(existing, "visible-b-collector")) && CoreWebView2Environment.Created == count, "Collector directory/environment was created"); }
    });
    await Check("missing roots and cancelled collector calls remain blocked with no directory creation", async () =>
    {
        var missing = Path.Combine(root, "must-not-be-created"); var blocked = new WebViewProfileService(missing);
        await Blocked(() => blocked.PrepareCollectorProfileAsync("missing"));
        await Blocked(() => blocked.PrepareCollectorProfileAsync("missing", new CancellationToken(true)));
        await Blocked(async () => { await blocked.GetOrCreateCollectorProfileAsync("missing"); });
        Assert(!Directory.Exists(missing), "A denied collector call created its data root");
    });
    await Check("foreground environment and its cache remain usable without changing existing data", async () =>
    {
        var before = Digest(existing); var first = await profiles.GetOrCreateProfileAsync("visible-a");
        var second = await profiles.GetOrCreateProfileAsync("visible-a");
        Assert(ReferenceEquals(first, second), "Foreground environment cache was not preserved");
        Assert(Digest(existing) == before, "Opening a foreground environment changed existing fixture files");
    });
    await Check("ordinary scheduler ticks do not lease, create, navigate or drive hidden accounts", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var factories = 0; var driven = new List<bool>(); var flushed = 0;
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => { factories++; return Task.FromResult(new WsWebViewSessionRegistration(new WebView2())); }, (session, drive, token) => { driven.Add(drive); return Task.CompletedTask; }, token => { flushed++; return Task.CompletedTask; });
        coordinator.RegisterAccount("a", "Synthetic A", WsAccountRuntimeState.Connected);
        coordinator.RegisterAccount("b", "Synthetic B", WsAccountRuntimeState.Connected);
        await runtime.ShowAccountAsync("a");
        for (var index = 0; index < 12; index++) await runtime.TickAsync();
        Assert(factories == 1, "Scheduler created an inactive account without an explicit foreground request");
        Assert(driven.Count == 12 && driven.All(drive => !drive), "Scheduler drove hidden collection");
        Assert(coordinator.Snapshot().BackgroundAccountId is null, "Scheduler acquired a background collection lease");
        Assert(flushed == 12, "Existing local flush lifecycle changed");
        await runtime.ShutdownAsync();
    });
    await Check("manual A-B-A switches retain pooled foreground views and safe shutdown", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var factories = 0;
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => { factories++; return Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), view => view.Close())); }, (session, drive, token) => Task.CompletedTask, token => Task.CompletedTask);
        var a = await runtime.ShowAccountAsync("a"); var b = await runtime.ShowAccountAsync("b"); var again = await runtime.ShowAccountAsync("a");
        Assert(factories == 2 && ReferenceEquals(a.Session.View, again.Session.View), "Manual switching recreated an existing foreground view");
        Assert(a.Session.CollectorView is null && b.Session.CollectorView is null, "The registration unexpectedly contains a collector");
        runtime.HideForeground(); await runtime.TickAsync(); Assert(factories == 2, "Route hide recreated background account views");
        await runtime.ShutdownAsync(); Assert(runtime.Sessions().Count == 0 && a.Session.View.Closed && b.Session.View.Closed, "Foreground pool did not release normally");
    });
    await Check("typed capability is immutable, explicit and separate from connection state", () =>
    {
        var capability = JsonSerializer.SerializeToElement(WsCollectionCapability.Current);
        Assert(capability.GetProperty("state").GetString() == "blocked" && capability.GetProperty("code").GetString() == "COLLECTION_CAPABILITY_BLOCKED", "Capability protocol differs from the frozen contract");
        Assert(capability.GetProperty("manualVisibleImport").GetBoolean(), "Manual import was incorrectly disabled");
        foreach (var field in new[] { "backgroundCollection", "automaticHistory", "groupMonitoring", "foregroundFallback" }) Assert(!capability.GetProperty(field).GetBoolean(), "An automatic capability was enabled");
        Assert(!capability.TryGetProperty("status", out _), "Connection status must not be replaced by collection capability");
        Assert(typeof(WsCollectionCapability).GetConstructors().Length == 0 && typeof(WsCollectionCapability).GetProperties().All(property => !property.CanWrite), "Capability must not contain a mutable enable bypass");
        foreach (var action in new[] { "open", "close", "probe", "reload", "send-text", "send-media", "capture-visible-messages", "capture-selection", "pause-group-monitor", "stop-group-monitor" }) Assert(!WsCollectionCapability.BlocksAction(action), "A foreground/manual/safe-stop action was blocked");
        return Task.CompletedTask;
    });
#if RD02_HOST_HARNESS
    await Check("actual Native handler denies automatic actions before account/session operations", async () =>
    {
        foreach (var action in new[] { "discover-conversations", "collect-all-read", "configure-group-monitor", "start-group-monitor", "configure-vip-groups", "configure-ws-groups" })
        {
            var host = new NativeRouteHarness(); var response = await host.Invoke(action);
            Assert(!response.Ok && response.ErrorCode == WsCollectionCapability.ErrorCode, "Automatic action was not explicitly blocked: " + action);
            Assert(host.ActiveAccountId == "foreground-a" && host.UnexpectedCalls == 0 && host.SendInvalidations == 0, "Blocked action touched account/session/foreground state");
            Assert(response.Data is { } data && !data.GetProperty("retryable").GetBoolean() && data.GetProperty("collectionCapability").GetProperty("state").GetString() == "blocked", "Denied action must not schedule retry or hide its capability");
        }
    });
    await Check("actual pause/stop handlers only acknowledge local inactive monitor state", async () =>
    {
        foreach (var action in new[] { "pause-group-monitor", "stop-group-monitor" })
        {
            var host = new NativeRouteHarness(); var response = await host.Invoke(action);
            Assert(response.Ok && host.UnexpectedCalls == 0, "Safe local stop executed a backend/WebView operation");
            Assert(response.Data is { } data && data.GetProperty("localOnly").GetBoolean() && data.GetProperty("collectionCapability").GetProperty("state").GetString() == "blocked", "Safe stop must not imply platform monitoring is available");
        }
    });
#endif
}
finally
{
    var resolved = Path.GetFullPath(root);
    Assert(Path.GetDirectoryName(resolved) == Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) && Path.GetFileName(resolved).StartsWith("zhike-rd02-native-", StringComparison.Ordinal), "Refuse cleanup outside the exact synthetic test root");
    Directory.Delete(resolved, recursive: true);
}
Console.WriteLine(JsonSerializer.Serialize(new { suite = "RD02 linked production C# boundaries", passed, failed = failures.Count, syntheticDirectoriesOnly = true, platformAdapters = "synthetic; not native WinUI acceptance", realProfile = false, realWhatsApp = false, realSqlite = false }));
return failures.Count == 0 ? 0 : 1;
