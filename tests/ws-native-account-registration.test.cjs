'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const desktop = path.join(repo, 'desktop/src/Zhike.Desktop');
const source = fs.readFileSync(path.join(desktop, 'Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools/dotnet10/dotnet.exe');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-ws-account-registration-'));
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
function take(from, to) {
  const begin = source.indexOf(from), end = source.indexOf(to, begin);
  assert.ok(begin >= 0 && end > begin, 'Run the shipped native bridge methods in the synthetic host');
  return source.slice(begin, end);
}

const services = ['WsAccountStore.cs', 'ApiClient.cs', 'BridgeContracts.cs']
  .map(name => `<Compile Include="${escapeXml(path.join(desktop, 'Services', name))}" Link="${name}" />`).join('');
const project = path.join(root, 'Probe.csproj');
fs.writeFileSync(project, `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>
  <TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>
  </PropertyGroup><ItemGroup>${services}</ItemGroup></Project>`);
fs.writeFileSync(path.join(root, 'Program.cs'), `
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zhike.Desktop.Services;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
var dir = Path.Combine(AppContext.BaseDirectory, "synthetic-account-index");
var store = new WsAccountStore(dir);
var original = new StoredWsAccount("old-native-only", "保留的本机账号", "等待登录");
await store.SaveAsync([original]);
var sidecar = new Sidecar();
using var http = new HttpClient(sidecar) { BaseAddress = new Uri("http://localhost/") };
var bridge = new Probe(store, new ApiClient(http));

sidecar.NextPost = HttpStatusCode.ServiceUnavailable;
var failed = await bridge.Call(new { action = "create", account = new { id = "fixture-retry", displayName = "Synthetic" } });
Check(!failed.Ok && failed.ErrorCode == "WS_ACCOUNT_SYNC_FAILED", "Failed write must reach the UI as a failed bridge response");
Check((await store.LoadAsync()).SequenceEqual([original]), "An unsuccessful sidecar write leaves the native index unchanged");
await bridge.Call(new { action = "list" });
Check(sidecar.Posted.SequenceEqual(["fixture-retry"]), "Listing must not re-create unmatched native accounts");

var retry = await bridge.Call(new { action = "create", account = new { id = "fixture-retry", displayName = "Synthetic" } });
Check(retry.Ok && sidecar.Posted.SequenceEqual(["fixture-retry", "fixture-retry"]), "Retry uses the original account id");
var existing = await bridge.Call(new { action = "create", account = new { id = "fixture-retry", displayName = "Do not overwrite" } });
Check(existing.Ok && sidecar.Posted.Count == 2 && sidecar.Rows["fixture-retry"].DisplayName == "Synthetic", "Found account is reused without mutation");
Check((await store.LoadAsync()).Contains(original), "The existing native account was retained");

var orphan = await bridge.Call(new { action = "create", account = new { id = "old-native-only", displayName = "Do not overwrite" } });
Check(orphan.Ok && sidecar.Rows["old-native-only"].DisplayName == original.DisplayName, "Explicit retry can register a legacy native-only ID");
Check((await store.LoadAsync()).Contains(original), "Recovery preserves existing native runtime metadata");

sidecar.NextPost = HttpStatusCode.Conflict;
sidecar.InsertOnConflict = true;
Check((await bridge.Call(new { action = "create", account = new { id = "same-id-conflict", displayName = "Synthetic" } })).Ok,
    "A conflict is successful only after exact-ID readback");
sidecar.NextPost = HttpStatusCode.Conflict;
sidecar.InsertOnConflict = false;
var conflict = await bridge.Call(new { action = "create", account = new { id = "unknown-conflict", displayName = "Synthetic" } });
Check(!conflict.Ok && conflict.ErrorCode == "WS_ACCOUNT_SYNC_FAILED", "Unconfirmed conflict remains a failure");
var caseConflict = await bridge.Call(new { action = "create", account = new { id = "FIXTURE-RETRY", displayName = "Synthetic" } });
Check(caseConflict.Ok && !sidecar.Rows.ContainsKey("FIXTURE-RETRY"), "Native canonical spelling is used on a case-only retry");

var index = Path.Combine(dir, "accounts.json");
var intact = await File.ReadAllTextAsync(index);
await File.WriteAllTextAsync(index, "{");
var partial = await bridge.Call(new { action = "create", account = new { id = "fixture-index-failure", displayName = "Synthetic" } });
Check(!partial.Ok && partial.ErrorCode == "WS_ACCOUNT_INDEX_WRITE_FAILED", "The bridge reports the failed native index write");
Check(sidecar.Rows.ContainsKey("fixture-index-failure") && await File.ReadAllTextAsync(index) == "{", "The sidecar row and unreadable local file are kept");
await File.WriteAllTextAsync(index, intact);
Check((await bridge.Call(new { action = "list" })).Ok && (await store.LoadAsync()).Any(row => row.Id == "fixture-index-failure"), "A later list restores the confirmed sidecar account");

const string targetId = "fixture-forget";
const string forgetId = "FIXTURE-FORGET";
var target = new StoredWsAccount(targetId, "Synthetic rollback target", "未连接");
var defaultRow = new StoredWsAccount("default", "Synthetic default", "未连接");
var concurrentRow = new StoredWsAccount("fixture-concurrent", "Added during release", "未连接");
sidecar.Rows.Add(targetId, new WsAccountDto(target.Id, target.DisplayName, target.Status, null));
var beforeForget = await store.UpdateAsync(rows => rows.Append(target).Append(defaultRow));
var originalSidecarIds = sidecar.Rows.Keys.Order().ToArray();
var originalSidecarWrites = sidecar.Posted.Count;

// These ordinary marker files belong solely to the synthetic fixture. The
// native release seam records the expected call without opening a WebView.
var marker = Path.Combine(AppContext.BaseDirectory, "synthetic-profile-marker.txt");
await File.WriteAllTextAsync(marker, "fixture marker");
var defaultForget = await bridge.Call(new { action = "forget", accountId = "default" });
Check(!defaultForget.Ok && defaultForget.ErrorCode == "INVALID_REQUEST" && bridge.Released.Count == 0,
    "The default account cannot be forgotten or released");

bridge.OnRelease = token => store.UpdateAsync(rows => rows.Append(concurrentRow), token);
var forget = await bridge.Call(new { action = "forget", accountId = forgetId });
Check(forget.Ok && forget.Data?.GetProperty("forgotten").GetBoolean() == true &&
    forget.Data?.GetProperty("accountId").GetString() == forgetId, "Forget confirms the requested id");
Check(bridge.Released.SequenceEqual([forgetId]) && App.WsRuntime.Removed.SequenceEqual([forgetId]),
    "Only the requested account reaches the native release and runtime removal seams");
var afterForget = await store.LoadAsync();
Check(afterForget.OrderBy(row => row.Id).SequenceEqual(beforeForget.Where(row => row.Id != targetId).Append(concurrentRow).OrderBy(row => row.Id)),
    "Forget removes only the matching native index row and preserves a concurrent index addition");
Check(sidecar.Rows.Keys.Order().SequenceEqual(originalSidecarIds) && sidecar.Posted.Count == originalSidecarWrites,
    "Forget leaves the sidecar account records and writes untouched");
Check(await File.ReadAllTextAsync(marker) == "fixture marker", "Forget leaves the fixture marker untouched");
Console.WriteLine("Native WS account registration and forget passed: stable retry, exact readback, index recovery and target-only rollback");

static class DesktopBridgeService { public const string CurrentVersion = "fixture"; }
static class App { public static Runtime WsRuntime { get; } = new(); }
sealed class Runtime {
    public List<string> Removed { get; } = [];
    public void RegisterAccounts(IEnumerable<StoredWsAccount> rows) {}
    public void RemoveAccount(string id) => Removed.Add(id);
}
sealed class Sidecar : HttpMessageHandler {
    public Dictionary<string, WsAccountDto> Rows { get; } = [];
    public List<string> Posted { get; } = [];
    public HttpStatusCode NextPost { get; set; } = HttpStatusCode.Created;
    public bool InsertOnConflict { get; set; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        if (request.RequestUri?.AbsolutePath != "/api/ws/accounts") throw new InvalidOperationException("Unexpected endpoint");
        if (request.Method == HttpMethod.Get) return Reply(HttpStatusCode.OK, new { accounts = Rows.Values });
        if (request.Method != HttpMethod.Post) throw new InvalidOperationException("Unexpected method");
        var account = await request.Content!.ReadFromJsonAsync<WsAccountRequest>(cancellationToken);
        Posted.Add(account!.Id);
        var status = NextPost;
        NextPost = HttpStatusCode.Created;
        var row = new WsAccountDto(account.Id, account.DisplayName, "未连接", null);
        if (status == HttpStatusCode.Created || (status == HttpStatusCode.Conflict && InsertOnConflict)) Rows.Add(account.Id, row);
        return Reply(status, new { account = row });
    }
    static HttpResponseMessage Reply(HttpStatusCode status, object body) => new(status) { Content = JsonContent.Create(body) };
}
sealed class Probe(WsAccountStore store, ApiClient api) {
    readonly WsAccountStore _wsAccountStore = store;
    readonly SemaphoreSlim _wsAccountMutationGate = new(1, 1);
    readonly ApiClient? _api = api;
    public List<string> Released { get; } = [];
    public Func<CancellationToken, Task>? OnRelease { get; set; }
    public Task<BridgeResponse> Call(object payload) => HandleWsAccountsAsync("probe", JsonSerializer.SerializeToElement(payload), CancellationToken.None);
    static string StringValue(JsonElement element, string name) => element.TryGetProperty(name, out var value) ? value.ToString().Trim() : string.Empty;
    Task ReleaseForgottenWsAccountAsync(string id, CancellationToken token) {
        Released.Add(id);
        return OnRelease?.Invoke(token) ?? Task.CompletedTask;
    }
${take('    private async Task<BridgeResponse> HandleWsAccountsAsync(', '    private async Task ReleaseForgottenWsAccountAsync(')}
${take('    private async Task<List<StoredWsAccount>> LoadWsAccountsAsync(', '    private async Task OpenWsOverlayAsync(')}
}
namespace Zhike.Desktop {
    static class App { public static FixtureSidecar? LocalService => null; }
    sealed class FixtureSidecar {
        public bool IsRunning => false;
        public ApiClient CreateApiClient() => throw new InvalidOperationException("No native service in this fixture");
    }
}
`);
const result = spawnSync(dotnet, ['run', '--project', project, '-c', 'Release'], {
  cwd: root, stdio: 'inherit', timeout: 45000, windowsHide: true,
});
if (result.error || result.status !== 0) {
  console.error('Synthetic account fixture retained at ' + root);
  if (result.error) throw result.error;
  process.exitCode = result.status || 1;
} else {
  const realRoot = fs.realpathSync(root);
  assert.equal(path.dirname(realRoot), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(realRoot), /^zhike-ws-account-registration-[a-zA-Z0-9]+$/);
  fs.rmSync(realRoot, { recursive: true });
}
