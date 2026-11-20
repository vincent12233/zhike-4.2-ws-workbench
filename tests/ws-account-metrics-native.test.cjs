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
App.WsSessions.Rows.Clear();
Check((await probe.Snapshot()).Accounts.All(row => row.OnlineState != "recent" && !row.ForegroundInitialized && !row.CollectorInitialized && !row.CollectorRunning), "destroyed sessions never remain online or initialized");
Check(CoreWebView2Environment.Calls == 0, "metrics and login evidence must never initialize an environment");
Console.WriteLine("native account metrics: 50 registrations, profile evidence, QR, TTL, collector, navigation, generation and out-of-order probes pass");

sealed class Probe(WsAccountStore store, WebViewProfileService profiles) {
  readonly WsAccountStore _wsAccountStore = store;
  readonly WebViewProfileService _wsProfiles = profiles;
  readonly WsAccountMetrics _wsAccountMetrics = new();
  readonly HashSet<WebView2> _wsCollectorStarted = [];
  public Task<(string status,string detail)> Call(string id, WebView2 view, long generation, bool publish = true) => ProbeWsLoginStateAsync(id,view,generation,publishStatus:publish);
  public async Task<WsAccountMetricsSnapshot> Snapshot() => BuildWsAccountMetrics(await store.LoadAsync());
  public WsAccountMetricsSnapshot RawSnapshot(IReadOnlyList<StoredWsAccount> rows, DateTimeOffset now) => _wsAccountMetrics.Snapshot(rows, App.WsSessions.Rows.Select(s => new WsAccountMetricRuntime(s.AccountId,s.Generation,s.IsReady,s.IsCollectorReady,s.CollectorState)).ToArray(),profiles.GetProfileDirectoryStamp,now);
  public void Invalidate(string id) => _wsAccountMetrics.Invalidate(id);
  public void Started(WebView2 view) => _wsCollectorStarted.Add(view);
  public Task Clear(string id) => ClearWsLoginObservationsAsync(id, CancellationToken.None);
  Task SetWsStatusAsync(string id, string status, CancellationToken token) => Task.CompletedTask;
  void PublishWsStatus(JsonElement payload) { }
  ${take('    private WsAccountMetricsSnapshot BuildWsAccountMetrics(', '    private async Task OpenWsOverlayAsync(')}
  ${take('    private static bool IsAllowedWsPopupNavigation(', '    private async Task HeartbeatPooledWsSessionAsync(')}
  ${take('    private async Task<(string status, string detail)> ProbeWsLoginStateAsync(', '    private async Task SetWsStatusAsync(')}
}
static class App { public static FakePool WsSessions = new(); }
sealed class FakePool {
  public List<FakeSession> Rows = [];
  public IReadOnlyList<FakeSession> Sessions() => Rows;
  public bool IsCurrent(string id,long generation,WebView2? view) => Rows.Any(s => s.AccountId == id && s.Generation == generation && (ReferenceEquals(s.View,view) || ReferenceEquals(s.CollectorView,view)));
}
sealed record FakeSession(string AccountId,long Generation,WebView2 View,WebView2? CollectorView) { public bool IsReady => View.CoreWebView2 is not null; public bool IsCollectorReady => CollectorView?.CoreWebView2 is not null; public string CollectorState => "running"; }
static class RuntimeExtensions { public static Task<T> AsTask<T>(this Task<T> value) => value; }
namespace Microsoft.UI.Xaml.Controls { public sealed class WebView2 { public CoreWebView2? CoreWebView2 { get; set; } } }
namespace Microsoft.Web.WebView2.Core {
  public sealed class CoreWebView2 { public string Source = "https://web.whatsapp.com/"; public Task<string> Result = Task.FromResult("{}"); public Task<string> ExecuteScriptAsync(string script) => Result; }
  public sealed class CoreWebView2EnvironmentOptions { }
  public sealed class CoreWebView2Environment { public static int Calls; public static Task<CoreWebView2Environment> CreateWithOptionsAsync(string? browser,string path,CoreWebView2EnvironmentOptions options) { Calls++; return Task.FromResult(new CoreWebView2Environment()); } }
}
namespace Zhike.Desktop.Services { public static class WsCollectionCapability { public static Exception Denied() => new InvalidOperationException("No copied profile"); } }
`);
const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools/dotnet10/dotnet.exe');
const result = spawnSync(dotnet, ['run', '--project', path.join(root, 'Probe.csproj'), '-c', 'Release'], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60000 });
if (result.error || result.status !== 0) { console.error('Synthetic metric fixture retained at ' + root); if (result.error) throw result.error; process.exitCode = result.status || 1; }
else { assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^zhike-account-metrics-/); fs.rmSync(root, { recursive: true }); }
