'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..'), desktop = path.join(repo, 'desktop/src/Zhike.Desktop');
const host = fs.readFileSync(path.join(desktop, 'Views/LegacyUiHostPage.xaml.cs'), 'utf8');
function take(from, to) { const start = host.indexOf(from), end = host.indexOf(to, start); assert.ok(start >= 0 && end > start); return host.slice(start, end); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-account-metrics-'));
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const includes = ['WsAccountStore.cs', 'WsAccountMetrics.cs', 'WebViewProfileService.cs'].map(file => `<Compile Include="${escapeXml(path.join(desktop, 'Services', file))}" Link="${file}" />`).join('');
fs.writeFileSync(path.join(root, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup>${includes}</ItemGroup></Project>`);
fs.writeFileSync(path.join(root, 'Program.cs'), `
using System.Text.Json;
using Zhike.Desktop.Services;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
static string ProbeResult(bool chat, bool login = false) => JsonSerializer.Serialize(JsonSerializer.Serialize(new { chat, login, problem = false, text = "" }));
using var ui = new FixtureDispatcher();
await ui.RunAsync(async () => {
var root = Path.Combine(AppContext.BaseDirectory, "synthetic");
var profileRoot = Path.Combine(root, "profiles");
var store = new WsAccountStore(Path.Combine(root, "index"));
var profiles = new WebViewProfileService(profileRoot);
await store.SaveAsync(Enumerable.Range(0, 50).Select(i => new StoredWsAccount("a" + i, "Synthetic " + i, "已连接", DateTimeOffset.UtcNow, "已连接", i < 25 ? "ordinary" : "dedicated")));
var probe = new Probe(store, profiles);
var initial = await probe.Snapshot();
Check(initial.Accounts.Count == 50 && initial.Accounts.Count(row => row.WorkspaceMode == "dedicated") == 25, "50 offline registrations preserve both purposes");
Check(initial.Accounts.All(row => row.SavedSession == "none" && row.OnlineState == "not-observed" && !row.ForegroundInitialized && !row.CollectorInitialized && !row.CollectorRunning), "registration and historical status cannot imply sessions, online or initialized controls");
Directory.CreateDirectory(Path.Combine(profileRoot, "a0"));
Check((await probe.Snapshot()).Accounts[0].SavedSession == "unknown", "directory without native login evidence is unknown");
var view = new WebView2 { CoreWebView2 = new CoreWebView2 { Result = Task.FromResult(ProbeResult(true)) } };
var collector = new WebView2();
App.WsSessions.Rows.Add(new("a0", 1, view, collector));
Check((await probe.Call("a0", view, 1)).status == "已连接", "current native chat observation succeeds");
var signedIn = (await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0");
Check(signedIn.SavedSession == "confirmed" && signedIn.OnlineState == "recent" && signedIn.ForegroundInitialized && !signedIn.CollectorInitialized, "only initialized foreground counts; allocation alone is not initialization");
var saved = (await store.LoadAsync()).First(row => row.Id == "a0");
Check(saved.ForegroundLoginObservation?.SignedIn == true && saved.CollectorLoginObservation is null, "signed-in observation persists for exactly one surface");
var future = probe.RawSnapshot(await store.LoadAsync(), DateTimeOffset.UtcNow.AddSeconds(31)).Accounts.First(row => row.AccountId == "a0");
Check(future.OnlineState == "stale" && future.SavedSession == "confirmed", "online TTL is independent from saved login evidence");
view.CoreWebView2.Result = Task.FromResult(ProbeResult(true, true));
Check((await probe.Call("a0", view, 1)).status == "等待登录", "QR must beat stale chat DOM");
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").SavedSession == "none", "QR invalidates saved login observation");
var pending = new TaskCompletionSource<string>(); view.CoreWebView2.Result = pending.Task;
var oldProbe = probe.Call("a0", view, 1); probe.Invalidate("a0"); pending.SetResult(ProbeResult(true)); await oldProbe;
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState != "recent", "navigation invalidates a pending probe before it can publish or save");
Directory.CreateDirectory(Path.Combine(profileRoot, ".independent-collectors-v2", "a0-collector-v2"));
collector.CoreWebView2 = new CoreWebView2 { Result = Task.FromResult(ProbeResult(true)) };
await probe.Call("a0", collector, 1, false); probe.Started(collector);
var collected = (await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0");
Check(collected.SavedSession == "confirmed" && collected.CollectorSavedSession == "confirmed" && collected.OnlineState != "recent" && collected.CollectorInitialized && collected.CollectorRunning, "collector login cannot claim foreground online; independent collector counts separately");
await probe.Clear("a0");
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").SavedSession == "unknown", "clear intent invalidates persisted observations even before profile removal");
var newView = new WebView2 { CoreWebView2 = new CoreWebView2 { Result = Task.FromResult(ProbeResult(true)) } };
App.WsSessions.Rows.Clear(); App.WsSessions.Rows.Add(new("a0", 2, newView, null));
await probe.Call("a0", newView, 2); await probe.Call("a0", view, 1);
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "recent", "old-generation calls cannot invalidate the new generation");
var older = new TaskCompletionSource<string>(); newView.CoreWebView2.Result = older.Task;
var olderCall = probe.Call("a0", newView, 2); newView.CoreWebView2.Result = Task.FromResult(ProbeResult(false, true)); await probe.Call("a0", newView, 2);
older.SetResult(ProbeResult(true)); await olderCall;
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "not-online", "out-of-order positive probe cannot overwrite newer QR");
await probe.LockStatus(); probe.StatusEntered = new(TaskCreationOptions.RunContinuationsAsynchronously);
newView.CoreWebView2.Result = Task.FromResult(ProbeResult(true));
var blockedStatus = probe.Call("a0", newView, 2); await probe.StatusEntered.Task;
var priorPublish = probe.Published;
probe.Invalidate("a0"); probe.UnlockStatus(); await blockedStatus;
Check(probe.Published == priorPublish && (await store.LoadAsync()).First(row => row.Id == "a0").Status == "等待登录", "a probe invalidated while waiting for the status gate cannot persist or publish a late status");
await Task.Run(() => probe.Call("a0", newView, 2));
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "recent", "a background caller is dispatched before reading Core or Source");
var nativeCore = newView.CoreWebView2!;
var beforeFailures = probe.Published;
newView.ThrowCoreRead = true;
Check((await probe.Call("a0", newView, 2)).status == "连接失败", "initial Core getter failure is contained before reaching an async-void navigation callback");
newView.ThrowCoreRead = false;
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "not-online", "current Core read failure marks only its owned observation");
nativeCore.ThrowSourceRead = true;
Check((await probe.Call("a0", newView, 2)).status == "连接失败", "synchronous Source getter failure is contained");
nativeCore.ThrowSourceRead = false;
nativeCore.ThrowExecute = true;
Check((await probe.Call("a0", newView, 2)).status == "连接失败", "synchronous ExecuteScriptAsync failure is contained");
nativeCore.ThrowExecute = false;
Check(probe.Published == beforeFailures, "failed native startup never publishes a success");
var failingOld = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
nativeCore.Result = failingOld.Task;
var failingOldCall = probe.Call("a0", newView, 2);
nativeCore.Result = Task.FromResult(ProbeResult(true)); await probe.Call("a0", newView, 2);
failingOld.SetException(new InvalidOperationException("old asynchronous script failed"));
Check((await failingOldCall).status == "连接失败", "asynchronous script failure remains contained");
Check((await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "recent", "failed old probe cannot mark a newer online observation offline");
using var cancelled = new CancellationTokenSource();
var cancelledResult = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
nativeCore.Result = cancelledResult.Task;
var cancelledCall = probe.Call("a0", newView, 2, token: cancelled.Token); cancelled.Cancel();
try { await cancelledCall; throw new Exception("cancellation was swallowed"); } catch (OperationCanceledException) { }
nativeCore.Result = Task.FromResult(ProbeResult(true)); await probe.Call("a0", newView, 2);
var afterCancelPublish = probe.Published;
cancelledResult.SetResult(ProbeResult(false, true)); await Task.Delay(20);
Check(probe.Published == afterCancelPublish && (await probe.Snapshot()).Accounts.First(row => row.AccountId == "a0").OnlineState == "recent", "cancelled script completion cannot overwrite a newer successful observation");
using var cancelledBeforeStart = new CancellationTokenSource(); cancelledBeforeStart.Cancel();
newView.ThrowCoreRead = true;
try { await probe.Call("a0", newView, 2, token: cancelledBeforeStart.Token); throw new Exception("pre-start cancellation was swallowed"); } catch (OperationCanceledException) { }
newView.ThrowCoreRead = false;
App.WsSessions.Rows.Clear();
Check((await probe.Snapshot()).Accounts.All(row => row.OnlineState != "recent" && !row.ForegroundInitialized && !row.CollectorInitialized && !row.CollectorRunning), "destroyed sessions never remain online or initialized");
Check(CoreWebView2Environment.Calls == 0, "metrics and login evidence must never initialize an environment");
Console.WriteLine("native account metrics: 50 registrations, profile evidence, QR, TTL, collector, navigation, generation and out-of-order probes pass");
});

sealed class Probe(WsAccountStore store, WebViewProfileService profiles) {
  readonly WsAccountStore _wsAccountStore = store;
  readonly WebViewProfileService _wsProfiles = profiles;
  readonly WsAccountMetrics _wsAccountMetrics = new();
  readonly HashSet<WebView2> _wsCollectorStarted = [];
  readonly System.Collections.Concurrent.ConcurrentDictionary<string, long> _wsStatusSequence = new();
  readonly SemaphoreSlim _wsStatusGate = new(1, 1);
  readonly FakeApi? _api = null;
  FixtureDispatcher DispatcherQueue => FixtureDispatcher.Instance;
  public TaskCompletionSource? StatusEntered;
  public int Published;
  public Task<(string status,string detail)> Call(string id, WebView2 view, long generation, bool publish = true, CancellationToken token = default) => ProbeWsLoginStateAsync(id,view,generation,token,publish);
  public Task<WsAccountMetricsSnapshot> Snapshot() => RunWsProbeOnUiAsync(async () => BuildWsAccountMetrics(await store.LoadAsync()), CancellationToken.None);
  public WsAccountMetricsSnapshot RawSnapshot(IReadOnlyList<StoredWsAccount> rows, DateTimeOffset now) => _wsAccountMetrics.Snapshot(rows, App.WsSessions.Rows.Select(s => new WsAccountMetricRuntime(s.AccountId,s.Generation,s.IsReady,s.IsCollectorReady,s.CollectorState)).ToArray(),profiles.GetProfileDirectoryStamp,now);
  public void Invalidate(string id) => _wsAccountMetrics.Invalidate(id);
  public void Started(WebView2 view) => _wsCollectorStarted.Add(view);
  public Task Clear(string id) => ClearWsLoginObservationsAsync(id, CancellationToken.None);
  public Task LockStatus() => _wsStatusGate.WaitAsync();
  public void UnlockStatus() => _wsStatusGate.Release();
  void PublishWsStatus(JsonElement payload) { FixtureDispatcher.AssertUi(); Published++; }
  ${take('    private WsAccountMetricsSnapshot BuildWsAccountMetrics(', '    private async Task OpenWsOverlayAsync(')}
  ${take('    private static bool IsAllowedWsPopupNavigation(', '    private async Task HeartbeatPooledWsSessionAsync(')}
  ${take('    private async Task<(string status, string detail)> ProbeWsLoginStateAsync(', '    private async Task SetWsStatusAsync(').replace('var probeText = JsonSerializer.Deserialize<string>(json)', 'FixtureDispatcher.AssertBackground(); var probeText = JsonSerializer.Deserialize<string>(json)')}
  ${take('    private async Task SetWsStatusAsync(', '    private async Task<BridgeResponse> ExecuteWsCaptureAsync(').replace('await _wsStatusGate.WaitAsync(cancellationToken);', 'StatusEntered?.TrySetResult(); await _wsStatusGate.WaitAsync(cancellationToken);')}
}
static class App { public static FakePool WsSessions = new(); public static FakeRuntime WsRuntime = new(); }
sealed class FakeRuntime { public void RegisterAccount(string id, string name, string status) { FixtureDispatcher.AssertUi(); } public void UpdateConnectionState(string id, string status) { FixtureDispatcher.AssertUi(); } }
static class WsRuntimeCoordinator { public static string FromDisplayStatus(string value) => value; }
sealed class FakeApi { public Task UpdateWsAccountStatusAsync(string id, string status, CancellationToken token) => Task.CompletedTask; }
sealed class FakePool {
  public List<FakeSession> Rows = [];
  public IReadOnlyList<FakeSession> Sessions() => Rows;
  public bool IsCurrent(string id,long generation,WebView2? view) => Rows.Any(s => s.AccountId == id && s.Generation == generation && (ReferenceEquals(s.View,view) || ReferenceEquals(s.CollectorView,view)));
}
sealed record FakeSession(string AccountId,long Generation,WebView2 View,WebView2? CollectorView) { public bool IsReady => View.CoreWebView2 is not null; public bool IsCollectorReady => CollectorView?.CoreWebView2 is not null; public string CollectorState => "running"; }
static class RuntimeExtensions { public static Task<T> AsTask<T>(this Task<T> value) => value; }
namespace Microsoft.UI.Xaml.Controls { public sealed class WebView2 { private CoreWebView2? _core; public bool ThrowCoreRead; public CoreWebView2? CoreWebView2 { get { FixtureDispatcher.AssertUi(); if (ThrowCoreRead) throw new InvalidOperationException("synthetic Core getter failure"); return _core; } set { FixtureDispatcher.AssertUi(); _core = value; } } } }
namespace Microsoft.Web.WebView2.Core {
  public sealed class CoreWebView2 { public bool ThrowSourceRead, ThrowExecute; public string Source { get { FixtureDispatcher.AssertUi(); if (ThrowSourceRead) throw new InvalidOperationException("synthetic Source getter failure"); return "https://web.whatsapp.com/"; } } public Task<string> Result = Task.FromResult("{}"); public Task<string> ExecuteScriptAsync(string script) { FixtureDispatcher.AssertUi(); if (ThrowExecute) throw new InvalidOperationException("synthetic script startup failure"); return Result; } }
  public sealed class CoreWebView2EnvironmentOptions { }
  public sealed class CoreWebView2Environment { public static int Calls; public static Task<CoreWebView2Environment> CreateWithOptionsAsync(string? browser,string path,CoreWebView2EnvironmentOptions options) { Calls++; return Task.FromResult(new CoreWebView2Environment()); } }
}
namespace Zhike.Desktop.Services { public static class WsCollectionCapability { public static Exception Denied() => new InvalidOperationException("No copied profile"); } }
sealed class FixtureDispatcher : IDisposable {
  public static FixtureDispatcher Instance = null!;
  readonly System.Collections.Concurrent.BlockingCollection<Action> _queue = new();
  readonly Thread _thread;
  public FixtureDispatcher() { Instance = this; _thread = new Thread(() => { SynchronizationContext.SetSynchronizationContext(new FixtureContext(this)); foreach (var action in _queue.GetConsumingEnumerable()) action(); }) { IsBackground = true }; _thread.Start(); }
  public bool HasThreadAccess => Environment.CurrentManagedThreadId == _thread.ManagedThreadId;
  public bool TryEnqueue(Action action) { try { return _queue.TryAdd(action); } catch (InvalidOperationException) { return false; } }
  public Task RunAsync(Func<Task> operation) { var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); TryEnqueue(async () => { try { await operation(); done.TrySetResult(); } catch (Exception error) { done.TrySetException(error); } }); return done.Task; }
  public static void AssertUi() { if (!Instance.HasThreadAccess) throw new InvalidOperationException("WinUI property accessed off dispatcher"); }
  public static void AssertBackground() { if (Instance.HasThreadAccess) throw new InvalidOperationException("JSON parsed on UI dispatcher"); }
  public void Dispose() { _queue.CompleteAdding(); _thread.Join(5000); _queue.Dispose(); }
  sealed class FixtureContext(FixtureDispatcher owner) : SynchronizationContext { public override void Post(SendOrPostCallback callback, object? state) { if (!owner.TryEnqueue(() => callback(state))) throw new InvalidOperationException("dispatcher closed"); } }
}
`);
const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools/dotnet10/dotnet.exe');
const result = spawnSync(dotnet, ['run', '--project', path.join(root, 'Probe.csproj'), '-c', 'Release'], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60000 });
if (result.error || result.status !== 0) { console.error('Synthetic metric fixture retained at ' + root); if (result.error) throw result.error; process.exitCode = result.status || 1; }
else { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^zhike-account-metrics-/); fs.rmSync(root, { recursive: true }); }
