'use strict';
// Compile the actual production native handlers with inert session/API/Core
// adapters. No UI process, profile, WS, database or network is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'), 'utf8');
const take = (begin, end) => { const a = source.indexOf(begin), b = source.indexOf(end, a); assert.ok(a > 0 && b > a, begin); return source.slice(a, b); };
const extracted = take('    private async Task<BridgeResponse> HandleWsActionAsync(', '    private async Task<BridgeResponse> SendWsTextAsync(')
  + take('    private async Task<BridgeResponse> SendWsTextAsync(', '    /// <summary>\n    /// Sends one already selected media item'.replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n'))
  + take('    private async Task<BridgeResponse> SendWsMediaAsync(', '    private async Task<BridgeResponse> BroadcastWsTextAsync(')
  + take('    private async Task<BridgeResponse> BroadcastWsTextAsync(', '    private static string BuildWsSendTextScript(')
  + take('    private static string BuildWsSendTextScript(', '    private Task<BridgeResponse> ConfigureVipGroupsAsync(')
  + take('    private static JsonElement ParseWebViewJsonResult(', '    private async void OnWsWebMessageReceived(')
  + take('    private static BridgeResponse WsCollectionBlocked(', '    private void PublishWsStatus(');
const out = path.join(repo, '.tools/stage55c-native-send'); fs.mkdirSync(out, { recursive: true });
assert.ok(fs.existsSync(path.join(repo, 'desktop/src/Zhike.Desktop/Services/WsSendOperationGuard.cs')),
  'the actual send eligibility guard is mandatory; an empty fallback cannot establish safety');
const host = `#nullable enable
using System.Text.Json;
namespace Zhike.Desktop.Services;
public sealed class NativeSendHost {
  private readonly WsSendOperationGuard _wsSendGuard = new();
  private string _activeWsAccountId = "a";
  private FakeView? _wsView => App.WsService.Sessions.GetValueOrDefault(App.WsService.ActiveAccountId)?.View;
  private ApiClient? _api = new();
  private bool _hostWindowRenderable = true;
  // The extracted send/action methods consult the collector capability surface
  // and the deferred collector gateway; provide test doubles with the same
  // signatures as the real host members so the real code compiles unchanged.
  private string _wsCollectorVisibleAccountId = string.Empty;
  private JsonElement CollectionCapabilityFor(string accountId)
  {
    var fields = JsonSerializer.SerializeToElement(WsCollectionCapability.Current).EnumerateObject()
      .ToDictionary(property => property.Name, property => property.Value.Clone());
    fields["collectorState"] = JsonSerializer.SerializeToElement("not-started");
    return JsonSerializer.SerializeToElement(fields);
  }
  private Task<BridgeResponse> HandleCollectorActionAsync(string requestId, string accountId, string action, JsonElement payload, CancellationToken token)
    => WsStatusResponseAsync(requestId, accountId, token);
  private bool IsWsChatPresentationActive => App.WsRuntime.ForegroundAccountId == App.WsService.ActiveAccountId && _hostWindowRenderable;
  public void InvalidateForTest() => _wsSendGuard.Invalidate();
  public void HideForTest() { _hostWindowRenderable = false; _wsSendGuard.Invalidate(); }
  public Task<BridgeResponse> SendMedia(JsonElement payload, CancellationToken token) => SendWsMediaAsync("test", "a", payload, token);
  public Task<BridgeResponse> SendText(JsonElement payload, CancellationToken token) => SendWsTextAsync("test", "a", payload, token);
  public Task<BridgeResponse> Broadcast(JsonElement payload, CancellationToken token) => BroadcastWsTextAsync("test", "a", payload, token);
  public Task<BridgeResponse> Action(string action, string accountId) => HandleWsActionAsync("test", JsonSerializer.SerializeToElement(new {action,accountId}), accountId, CancellationToken.None);
  private static string StringValue(JsonElement element,string name) => element.TryGetProperty(name,out var value) && value.ValueKind==JsonValueKind.String ? value.GetString() ?? "" : "";
  private static bool GetBool(JsonElement element,string name) => element.TryGetProperty(name,out var value) && value.ValueKind==JsonValueKind.True;
  private Task OpenWsOverlayAsync(string id,JsonElement payload,bool reload=false,CancellationToken cancellationToken=default) { App.WsService.ActiveAccountId=id; App.WsRuntime.ForegroundAccountId=id; return Task.CompletedTask; }
  private void ApplyWsBounds(JsonElement payload) {}
  private void HideWsOverlay() {}
  private Task<bool> CloseWsOverlayAsync(bool clear,string id,CancellationToken token) { App.WsService.ActiveAccountId=""; App.WsRuntime.ForegroundAccountId=""; return Task.FromResult(true); }
  private Task SetWsStatusAsync(string id,string status,CancellationToken token) => Task.CompletedTask;
  private Task<BridgeResponse> WsStatusResponseAsync(string requestId,string id,CancellationToken token) => Task.FromResult(BridgeResponse.Success(requestId,"test"));
  private Task<BridgeResponse> ConfigureVipGroupsAsync(string requestId,string id,JsonElement payload,CancellationToken token) => WsStatusResponseAsync(requestId,id,token);
  private Task<BridgeResponse> ConfigureGroupMonitorAsync(string requestId,string id,JsonElement payload,CancellationToken token) => WsStatusResponseAsync(requestId,id,token);
  private Task<BridgeResponse> SetGroupMonitorStateAsync(string requestId,string id,string action,CancellationToken token) => WsStatusResponseAsync(requestId,id,token);
  private Task<BridgeResponse> ExecuteWsCaptureAsync(string requestId,string id,string action,CancellationToken token) => WsStatusResponseAsync(requestId,id,token);
${extracted}
}
`;
const actual = path.join(out, 'ActualNativeSendHost.cs'); fs.writeFileSync(actual, host);
const dotnet = path.join(repo, '.tools/dotnet10/dotnet.exe');
const project = path.join(__dirname, 'NativeSendSafetyRuntime/NativeSendSafetyRuntime.csproj');
const build = spawnSync(dotnet, ['build', project, '-c', 'Release', '--nologo', '-v:q', '-p:ActualNativeSendHost=' + actual], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000 });
assert.ifError(build.error); assert.equal(build.status, 0, build.stdout + build.stderr);
const run = spawnSync(dotnet, [path.join(__dirname, 'NativeSendSafetyRuntime/bin/Release/net10.0/NativeSendSafetyRuntime.dll')], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const output = (build.stdout + build.stderr + run.stdout + run.stderr).trim();
fs.writeFileSync(path.join(out, process.argv.includes('--baseline') ? 'baseline.log' : 'final.log'), output + '\n');
process.stdout.write(output + '\n');
assert.ifError(run.error); assert.equal(run.status, 0, 'actual native send safety runtime failed');
