using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Zhike.Desktop.Services;

// Actual profile, scheduler, pool and coordinator with synthetic platform APIs.
// The test never starts a browser or reads an existing account/profile.
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
    throw new InvalidOperationException("Retired profile preparation did not reject authenticated copying");
}
try
{
    var existing = Path.Combine(root, "profiles");
    Directory.CreateDirectory(Path.Combine(existing, "visible-a", "IndexedDB"));
    File.WriteAllText(Path.Combine(existing, "visible-a", "IndexedDB", "synthetic-marker.txt"), "synthetic fixture only; not authentication data");
    Directory.CreateDirectory(Path.Combine(existing, "visible-a-collector"));
    File.WriteAllText(Path.Combine(existing, "visible-a-collector", "preserve-existing.txt"), "synthetic prior collector must remain untouched");
    var profiles = new WebViewProfileService(existing);
    await Check("retired preparation rejects before copying, replacing or creating profiles", async () =>
    {
        var before = Digest(existing); var count = CoreWebView2Environment.Created;
        await Blocked(() => profiles.PrepareCollectorProfileAsync("visible-a"));
        await Blocked(() => profiles.PrepareCollectorProfileAsync("visible-a", new CancellationToken(true)));
        var missing = Path.Combine(root, "must-not-be-created");
        await Blocked(() => new WebViewProfileService(missing).PrepareCollectorProfileAsync("missing"));
        Assert(Digest(existing) == before && CoreWebView2Environment.Created == count && !Directory.Exists(missing), "Retired copy API changed files or environments");
    });
    await Check("independent collector starts empty and never copies foreground or legacy authentication", async () =>
    {
        var before = Digest(existing);
        var foreground = await profiles.GetOrCreateProfileAsync("visible-a");
        var collector = await profiles.GetOrCreateCollectorProfileAsync("visible-a");
        Assert(!ReferenceEquals(foreground, collector), "Collector inherited the foreground environment");
        Assert(foreground.ProfilePath == Path.Combine(existing, "visible-a"), "Foreground profile location changed");
        Assert(collector.ProfilePath == Path.Combine(existing, ".independent-collectors-v2", "visible-a-collector-v2"), "Collector must use its reserved independent namespace");
        Assert(!Directory.EnumerateFileSystemEntries(collector.ProfilePath).Any(), "Independent profile was populated from another session");
        Assert(Digest(existing) == before, "Opening collector changed foreground/legacy files");
        Assert(ReferenceEquals(foreground, await profiles.GetOrCreateProfileAsync("visible-a")), "Foreground cache was replaced");
        Assert(ReferenceEquals(collector, await profiles.GetOrCreateCollectorProfileAsync("visible-a")), "Collector cache was not retained");
    });
    await Check("account suffixes and unsafe identifiers cannot collide with collector paths or cache", async () =>
    {
        var collector = await profiles.GetOrCreateCollectorProfileAsync("visible-a");
        var suffixAccount = await profiles.GetOrCreateProfileAsync("visible-a-collector-v2");
        var otherCollector = await profiles.GetOrCreateCollectorProfileAsync("visible-b");
        var unsafeCollector = await profiles.GetOrCreateCollectorProfileAsync("../visible-a");
        Assert(new[] { collector.ProfilePath, suffixAccount.ProfilePath, otherCollector.ProfilePath, unsafeCollector.ProfilePath }.Distinct().Count() == 4, "Account or role profiles collided");
        Assert(Path.GetDirectoryName(unsafeCollector.ProfilePath) == Path.Combine(existing, ".independent-collectors-v2"), "Unsafe account escaped collector root");
        Assert(!ReferenceEquals(collector, suffixAccount) && !ReferenceEquals(collector, otherCollector), "Environment cache crossed an account or role boundary");
    });
    await Check("failed collector environment is evicted so explicit retry can recover", async () =>
    {
        CoreWebView2Environment.FailNext = true;
        try { await profiles.GetOrCreateCollectorProfileAsync("retry"); throw new InvalidOperationException("Expected synthetic failure"); }
        catch (IOException error) when (error.Message == "synthetic environment failure") { }
        var recovered = await profiles.GetOrCreateCollectorProfileAsync("retry");
        Assert(ReferenceEquals(recovered, await profiles.GetOrCreateCollectorProfileAsync("retry")), "Retry did not cache recovered collector");
    });
    await Check("explicit account clearing removes its independent profile but preserves other accounts", async () =>
    {
        var selected = await profiles.GetOrCreateCollectorProfileAsync("clear-me");
        var neighbor = await profiles.GetOrCreateProfileAsync("clear-me-collector-v2");
        var oldSuffixNeighbor = await profiles.GetOrCreateProfileAsync("clear-me-collector");
        File.WriteAllText(Path.Combine(selected.ProfilePath, "synthetic.txt"), "selected");
        File.WriteAllText(Path.Combine(neighbor.ProfilePath, "synthetic.txt"), "neighbor");
        File.WriteAllText(Path.Combine(oldSuffixNeighbor.ProfilePath, "synthetic.txt"), "independent");
        Assert(await profiles.ClearProfileAsync("clear-me"), "Selected profile did not clear");
        Assert(!Directory.Exists(selected.ProfilePath), "Selected independent profile remains");
        Assert(File.ReadAllText(Path.Combine(neighbor.ProfilePath, "synthetic.txt")) == "neighbor", "Unrelated suffix account was cleared");
        Assert(File.ReadAllText(Path.Combine(oldSuffixNeighbor.ProfilePath, "synthetic.txt")) == "independent", "Foreground profile sharing the legacy collector suffix was cleared");
        Assert(ReferenceEquals(oldSuffixNeighbor, await profiles.GetOrCreateProfileAsync("clear-me-collector")), "Other account lost its cached foreground environment");
        Assert(!ReferenceEquals(selected, await profiles.GetOrCreateCollectorProfileAsync("clear-me")), "Cleared environment remained cached");
    });
    await Check("ordinary ticks never create, navigate or authenticate unopened collectors", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var factories = 0; var driven = new List<bool>(); var flushed = 0;
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => { factories++; return Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2 { CoreWebView2 = null })); }, (session, drive, token) => { driven.Add(drive); return Task.CompletedTask; }, token => { flushed++; return Task.CompletedTask; });
        coordinator.RegisterAccount("a", "Synthetic A", WsAccountRuntimeState.Connected);
        coordinator.RegisterAccount("b", "Synthetic B", WsAccountRuntimeState.Connected);
        var a = await runtime.ShowAccountAsync("a");
        for (var index = 0; index < 4; index++) await runtime.TickAsync();
        Assert(factories == 1 && driven.Count == 4 && driven.All(drive => !drive), "Foreground authentication implicitly activated a collector");
        Assert(a.Session.CollectorView?.CoreWebView2 is null && a.Session.CollectorView?.Source is null, "Tick initialized/navigated collector");
        Assert(flushed == 4, "Local flush lifecycle changed");
        await runtime.ShutdownAsync();
    });
    await Check("independent login hands off once after a live collector probe and keeps inspection visible", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool);
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2())), (session, drive, token) => Task.CompletedTask, token => Task.CompletedTask);
        var pairing = (await runtime.ShowAccountAsync("pairing")).Session;
        var other = (await runtime.ShowAccountAsync("inspection")).Session;
        runtime.SetCollectorState("pairing", "login-visible");
        runtime.SetCollectorState("inspection", "login-visible");
        pairing.StartAfterPairing = true;
        Assert(!other.ShouldResumeAfterLogin(true, true), "A different account consumed the pairing intent");
        Assert(!pairing.ShouldResumeAfterLogin(false, true), "Unpaired collector left the login surface");
        Assert(pairing.ShouldResumeAfterLogin(true, true) && !pairing.ShouldResumeAfterLogin(true, true), "A verified pairing must hand off exactly once");
        Assert(!other.ShouldResumeAfterLogin(false, false) && other.ShouldResumeAfterLogin(true, false), "Leaving an inspection through workspace navigation must resume only an independently signed-in collector");
        pairing.StartAfterPairing = true;
        runtime.SetCollectorState("pairing", "paused");
        Assert(!pairing.ShouldResumeAfterLogin(true, false), "A paused collector resumed from a late login probe");
        await runtime.CloseAccountAsync("pairing");
        var reopened = (await runtime.ShowAccountAsync("pairing")).Session;
        runtime.SetCollectorState("pairing", "login-visible");
        Assert(!reopened.ShouldResumeAfterLogin(true, true), "A retired collector transferred its intent to the next generation");
        await runtime.ShutdownAsync();
    });
    await Check("running independent collector is driven while the same account chats in foreground", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var driven = new List<(string account, bool collect)>();
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2())), (session, drive, token) => { driven.Add((session.AccountId, drive)); return Task.CompletedTask; }, token => Task.CompletedTask);
        var a = await runtime.ShowAccountAsync("a");
        Assert(runtime.SetCollectorState("a", "running"), "Failed to set running state");
        await runtime.TickAsync();
        Assert(driven.Contains(("a", false)) && driven.Contains(("a", true)), "Foreground account did not keep simultaneous independent collection");
        Assert(coordinator.Snapshot().ForegroundAccountId == "a" && runtime.ActiveAccountId == "a", "Background tick changed foreground selection");
        Assert(a.Session.View.Source?.AbsoluteUri == "https://web.whatsapp.com/", "Background tick navigated foreground view");
        driven.Clear(); runtime.SetCollectorState("a", "paused"); await runtime.TickAsync();
        Assert(driven.All(item => !item.collect), "Paused collector still received driving heartbeat");
        runtime.SetCollectorState("a", "running"); runtime.HideForeground(); driven.Clear(); await runtime.TickAsync();
        Assert(driven.SequenceEqual(new[] { ("a", true) }), "Hiding foreground stopped the independent running collector");
        await runtime.ShutdownAsync();
    });
    await Check("collector lifecycle states are account scoped, validated and deduplicated", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var changes = 0;
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2())), (session, drive, token) => Task.CompletedTask, token => Task.CompletedTask);
        var a = await runtime.ShowAccountAsync("a"); var b = await runtime.ShowAccountAsync("b");
        runtime.SessionsChanged += (_, _) => changes++;
        Assert(runtime.SetCollectorState("a", "awaiting-login"), "Known state rejected");
        Assert(a.Session.CollectorState == "awaiting-login" && b.Session.CollectorState == "not-started", "Collector state crossed accounts");
        runtime.SetCollectorState("a", "awaiting-login");
        Assert(changes == 1, "Duplicate heartbeat emitted redundant state changes");
        Assert(!runtime.SetCollectorState("missing", "running"), "Unknown account was created by state update");
        try { runtime.SetCollectorState("a", "invented-state"); throw new InvalidOperationException("Invalid state accepted"); }
        catch (ArgumentOutOfRangeException) { }
        Assert(a.Session.CollectorState == "awaiting-login", "Invalid state mutated session");
        await runtime.ShutdownAsync();
    });
    await Check("close and reopen fence old collector identity and stop collection without recreation", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var factories = 0; var driven = 0;
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => { factories++; var collector = new WebView2(); return Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), view => { view.Close(); collector.Close(); }, collector)); }, (session, drive, token) => { if (drive) driven++; return Task.CompletedTask; }, token => Task.CompletedTask);
        var old = (await runtime.ShowAccountAsync("a")).Session; runtime.SetCollectorState("a", "running");
        Assert(pool.IsCurrent("a", old.Generation, old.CollectorView), "Current collector view not recognized");
        await runtime.CloseAccountAsync("a"); await runtime.TickAsync();
        Assert(factories == 1 && driven == 0 && old.View.Closed && old.CollectorView!.Closed, "Close leaked/recreated/driven old session");
        var replacement = (await runtime.ShowAccountAsync("a")).Session;
        Assert(replacement.Generation > old.Generation && replacement.CollectorState == "not-started", "Reopen inherited old generation/collector state");
        Assert(!pool.IsCurrent("a", old.Generation, old.CollectorView) && !pool.IsCurrent("a", replacement.Generation, old.CollectorView), "Retired collector identity remained valid");
        await runtime.ShutdownAsync();
    });
    await Check("collector failure is isolated from foreground connection and other account collection", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool); var driven = new List<string>();
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2())), (session, drive, token) =>
        {
            if (drive && session.AccountId == "a") throw new IOException("synthetic collector failure");
            if (drive) driven.Add(session.AccountId);
            return Task.CompletedTask;
        }, token => Task.CompletedTask);
        await runtime.ShowAccountAsync("a"); await runtime.ShowAccountAsync("b");
        runtime.SetCollectorState("a", "running"); runtime.SetCollectorState("b", "running");
        coordinator.UpdateConnectionState("a", WsAccountRuntimeState.Connected);
        await runtime.TickAsync();
        Assert(runtime.Sessions().Single(session => session.AccountId == "a").CollectorState == "error", "Collector failure was not recorded separately");
        Assert(coordinator.Snapshot().Accounts.Single(account => account.AccountId == "a").State == WsAccountRuntimeState.Connected, "Collector error changed foreground connection state");
        Assert(driven.SequenceEqual(new[] { "b" }), "One collector failure prevented another account heartbeat");
        await runtime.ShutdownAsync();
    });
    await Check("cancellation after factory completion releases both unpublished views", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        using var cancellation = new CancellationTokenSource();
        var foreground = new WebView2(); var collector = new WebView2();
        try
        {
            await pool.GetOrCreateAsync("cancelled", (id, generation, token) =>
            {
                cancellation.Cancel();
                return Task.FromResult(new WsWebViewSessionRegistration(foreground, null, collector));
            }, cancellation.Token);
            throw new InvalidOperationException("Expected cancelled factory publication");
        }
        catch (OperationCanceledException) { }
        Assert(pool.Sessions().Count == 0 && foreground.Closed && collector.Closed, "Cancellation leaked an unpublished foreground or collector view");
    });
    await Check("host-owned collector identity rejects forged roles, accounts, stale views and paused packets", async () =>
    {
        var coordinator = new WsRuntimeCoordinator(); var pool = new WsWebViewSessionPool(coordinator);
        var runtime = new WsRuntimeService(coordinator, pool);
        runtime.BindHost(new DispatcherQueue(), (id, generation, token) => Task.FromResult(new WsWebViewSessionRegistration(new WebView2(), null, new WebView2())), (session, drive, token) => Task.CompletedTask, token => Task.CompletedTask);
        var session = (await runtime.ShowAccountAsync("a")).Session;
        var other = (await runtime.ShowAccountAsync("b")).Session;
        runtime.SetCollectorState("a", "running");
        bool Authorize(WebView2 view, string account = "a", string role = "background", long? generation = null)
            => WsCollectorIngress.TryAuthorize(session, generation ?? session.Generation, view, account, role, out _);
        Assert(WsCollectorIngress.TryAuthorize(session, session.Generation, session.CollectorView!, "a", "background", out var collector) && collector, "Genuine running collector rejected");
        Assert(!Authorize(session.View), "Foreground page granted itself collector authority");
        Assert(!Authorize(other.CollectorView!) && !Authorize(new WebView2()), "An unrelated control gained collector authority");
        Assert(!Authorize(session.CollectorView!, "b") && !Authorize(session.CollectorView!, ""), "Collector packet crossed or omitted account identity");
        Assert(!Authorize(session.CollectorView!, role: "foreground"), "Collector packet hid its source role");
        Assert(!Authorize(session.CollectorView!, generation: session.Generation + 1), "Stale generation packet accepted");
        foreach (var state in new[] { "not-started", "awaiting-login", "login-visible", "paused", "error" })
        {
            runtime.SetCollectorState("a", state);
            Assert(!Authorize(session.CollectorView!), "Non-running collector accepted a packet: " + state);
        }
        runtime.SetCollectorState("a", "running");
        session.CollectorView!.CoreWebView2 = null;
        Assert(!Authorize(session.CollectorView), "Uninitialized collector accepted a packet");
        Assert(WsCollectorIngress.TryAuthorize(session, session.Generation, session.View, "a", "foreground", out collector) && !collector, "Legitimate foreground/manual source rejected");
        await runtime.ShutdownAsync();
    });
    await Check("capability reports independent support without implying login or automatic AI", () =>
    {
        var capability = JsonSerializer.SerializeToElement(WsCollectionCapability.Current);
        Assert(capability.GetProperty("state").GetString() == "available" && capability.GetProperty("code").GetString() == "COLLECTION_INDEPENDENT_SESSION", "Capability protocol differs");
        Assert(capability.GetProperty("provider").GetString() == "native-independent-session" && capability.GetProperty("protocolVersion").GetInt32() == 1, "Capability provider/version differs");
        foreach (var field in new[] { "manualVisibleImport", "backgroundCollection", "automaticHistory", "groupMonitoring" }) Assert(capability.GetProperty(field).GetBoolean(), "Supported function disabled: " + field);
        foreach (var field in new[] { "foregroundFallback", "automaticAi" }) Assert(!capability.GetProperty(field).GetBoolean(), "Unrequested automatic capability enabled: " + field);
        Assert(!capability.TryGetProperty("status", out _), "Foreground connection status was replaced");
        Assert(typeof(WsCollectionCapability).GetConstructors().Length == 0 && typeof(WsCollectionCapability).GetProperties().All(property => !property.CanWrite), "Capability must remain immutable");
        return Task.CompletedTask;
    });
}
finally
{
    var resolved = Path.GetFullPath(root);
    Assert(Path.GetDirectoryName(resolved) == Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) && Path.GetFileName(resolved).StartsWith("zhike-rd02-native-", StringComparison.Ordinal), "Refuse cleanup outside exact synthetic root");
    Directory.Delete(resolved, recursive: true);
}
Console.WriteLine(JsonSerializer.Serialize(new { suite = "independent collector linked production C# boundaries", passed, failed = failures.Count, syntheticDirectoriesOnly = true, platformAdapters = "synthetic; not native WinUI acceptance", realProfile = false, realWhatsApp = false, realSqlite = false }));
return failures.Count == 0 ? 0 : 1;
