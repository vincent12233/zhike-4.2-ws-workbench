'use strict';
// Compile/execute actual production C# services plus the exact Native routing
// methods extracted below. Platform/unused backend adapters are test-only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(repo,file),'utf8');
const native=read('desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs');
function extract(start,end){const a=native.indexOf(start),b=native.indexOf(end,a);assert.ok(a>0&&b>a,'Exact production method boundaries: '+start);return native.slice(a,b)}
const factory=extract('    private async Task<WsWebViewSessionRegistration> CreatePooledWsSessionAsync(', '    private static void OnWsNewWindowRequested');
assert.equal((factory.match(/new WebView2\b/g)||[]).length,1,'The Native factory must create one foreground surface only');
assert.match(factory,/_wsProfiles\.GetOrCreateProfileAsync\(accountId\)/);
assert.doesNotMatch(factory,/CollectorProfile|BuildWsCollectorScript|StartCollectorAsync|AddScriptToExecuteOnDocumentCreatedAsync|WsCollectorHost/,'The foreground factory cannot bootstrap an authenticated hidden collector or inject capture');
assert.doesNotMatch(native,/WsCollectorHost\.Children\.Add|_wsCollectorBootstraps|EnsureWsCollectorStartedAsync|PrepareCollectorProfileAsync\(|GetOrCreateCollectorProfileAsync\(/,'No alternate Native collector creation/retry path may remain');
assert.doesNotMatch(read('desktop/src/Zhike.Desktop/Services/WebViewProfileService.cs'),/File\.Copy|CopyProfileDirectory|stagingPath|backupPath/,'No copy implementation or flag-reopenable branch may remain');
assert.doesNotMatch(read('desktop/src/Zhike.Desktop/Services/WsRuntimeService.cs'),/LeaseNextBackgroundAccount|RunHeartbeatAsync\([^\n]*true/,'Periodic runtime cannot lease or drive hidden collection');
const capture=extract('    private async Task<BridgeResponse> ExecuteWsCaptureAsync(', '    private static JsonElement ParseWebViewJsonResult');
assert.ok(capture.indexOf('WsCollectionBlocked(')<capture.indexOf('TryGetSession('),'Automatic capture denial must precede session/Core operations');
assert.doesNotMatch(capture,/CollectorView|__zhikeWsDiscover|__zhikeWsCollectAllRead|WaitForWsCollector/,'Manual import must not fall back to the old collector');
assert.match(capture,/"selection"/);assert.match(capture,/BuildWsVisibleCaptureScript\(accountId\)/);
const handler=extract('    private async Task<BridgeResponse> HandleWsActionAsync(', '    private static BridgeResponse WsSendFailure(');
const monitor=extract('    private Task<BridgeResponse> ConfigureVipGroupsAsync(', '    private async Task<List<StoredWsAccount>> LoadWsAccountsAsync(');
const denied=extract('    private static BridgeResponse WsCollectionBlocked(', '    private void PublishWsStatus(');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-rd02-host-harness-'));
try{
 const generated=path.join(root,'NativeHost.generated.cs');
 const wrappers=`#nullable enable
using System.Text.Json;using Microsoft.UI.Xaml.Controls;
namespace Zhike.Desktop.Services;
internal static class DesktopBridgeService { public const string CurrentVersion="isolated-test"; }
internal static class App { public static RouteRuntime WsService {get;}=new(); }
internal sealed class RouteRuntime { public void HideForeground()=>throw new InvalidOperationException("Unexpected foreground side effect"); }
internal sealed class Guard { public int Count {get;private set;} public void Invalidate()=>Count++; }
internal sealed class NativeRouteHarness {
 private string _activeWsAccountId="foreground-a";private readonly Guard _wsSendGuard=new();private readonly WebView2? _wsView=null;
 public string ActiveAccountId=>_activeWsAccountId;public int UnexpectedCalls {get;private set;} public int SendInvalidations=>_wsSendGuard.Count;
 public Task<BridgeResponse> Invoke(string action)=>HandleWsActionAsync("isolated-request",JsonSerializer.SerializeToElement(new{action,accountId="blocked-b"}),null,CancellationToken.None);
 private static string StringValue(JsonElement payload,string name)=>payload.TryGetProperty(name,out var value)?value.GetString()??"":"";
 private Exception Unexpected(){UnexpectedCalls++;return new InvalidOperationException("Denied route reached an unrelated backend adapter");}
 private Task OpenWsOverlayAsync(string id,JsonElement payload,bool reload=false,CancellationToken cancellationToken=default)=>throw Unexpected();
 private void ApplyWsBounds(JsonElement payload)=>throw Unexpected();private void HideWsOverlay()=>throw Unexpected();
 private Task<bool> CloseWsOverlayAsync(bool clear,string id,CancellationToken token)=>throw Unexpected();
 private Task SetWsStatusAsync(string id,string status,CancellationToken token)=>throw Unexpected();
 private Task<BridgeResponse> WsStatusResponseAsync(string r,string id,CancellationToken token)=>throw Unexpected();
 private Task<BridgeResponse> ExecuteWsCaptureAsync(string r,string id,string kind,CancellationToken token)=>throw Unexpected();
 private Task<BridgeResponse> SendWsTextAsync(string r,string id,JsonElement p,CancellationToken token)=>throw Unexpected();
 private Task<BridgeResponse> SendWsMediaAsync(string r,string id,JsonElement p,CancellationToken token)=>throw Unexpected();
 private Task<BridgeResponse> BroadcastWsTextAsync(string r,string id,JsonElement p,CancellationToken token)=>throw Unexpected();
${handler}\n${monitor}\n${denied}\n}`;
 fs.writeFileSync(generated,wrappers);
 const output=execFileSync('dotnet',['run','--project',path.join(repo,'desktop/tests/Rd02CollectionBoundaryRuntime/Rd02CollectionBoundaryRuntime.csproj'),'-c','Release','-p:Rd02GeneratedHost='+generated,'-p:DefineConstants=RD02_HOST_HARNESS'],{cwd:repo,encoding:'utf8',timeout:90000,maxBuffer:1024*1024,windowsHide:true});
 process.stdout.write(output);assert.match(output,/"passed":9,"failed":0/,'All linked-service and exact Native route cases must execute');
 console.log(JSON.stringify({suite:'RD02 authenticated profile boundary',nativeRouting:'actual extracted production C#',services:'actual linked production C#',staticCreationGuards:'Passed',realWinUI:'NotTested',realProfile:false,realWhatsApp:false,realSqlite:false}));
}finally{
 const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('zhike-rd02-host-harness-'));fs.rmSync(resolved,{recursive:true,force:false,maxRetries:10,retryDelay:100});
}
