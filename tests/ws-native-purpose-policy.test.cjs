'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),services=path.join(repo,'desktop/src/Zhike.Desktop/Services');
const source=fs.readFileSync(path.join(repo,'desktop/src/Zhike.Desktop/Views/LegacyUiHostPage.xaml.cs'),'utf8');
const take=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zhike-native-purpose-'));
fs.writeFileSync(path.join(root,'NuGet.Config'),'<configuration><packageSources><clear /></packageSources></configuration>');
const xml=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
fs.writeFileSync(path.join(root,'Probe.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup>${['ApiClient.cs','WorkspaceRestoreTransfer.cs','BridgeContracts.cs','WsCollectorPurposePolicy.cs','WsLiveDirectory.cs'].map(file=>`<Compile Include="${xml(path.join(services,file))}" Link="${file}" />`).join('')}</ItemGroup></Project>`);
fs.writeFileSync(path.join(root,'Program.cs'),`
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zhike.Desktop.Services;
using WsWebViewSession=Session;
static void Check(bool value,string message){if(!value)throw new Exception(message);}
static async Task Denied(Func<Task> run){try{await run();}catch(InvalidDataException){return;}throw new Exception("Expected policy denial");}
var handler=new Sidecar();using var http=new HttpClient(handler){BaseAddress=new Uri("http://localhost/")};var api=new ApiClient(http);
var ordinary=await api.GetWsCollectorPurposeAsync("ordinary");var dedicated=await api.GetWsCollectorPurposeAsync("dedicated");
var directoryInput=JsonSerializer.SerializeToElement(new{scanId=9,chunkIndex=2,finished=true,complete=true,rows=new[]{
 new{conversationKey="1@c.us",conversationType="direct",displayName="Person",previewText="private preview",isGroup=false},
 new{conversationKey="2@g.us",conversationType="group",displayName="Group",previewText="group body",isGroup=true},
 new{conversationKey="3@g.us",conversationType="direct",displayName="Misclassified",previewText="foreign group",isGroup=false},
 new{conversationKey="opaque",conversationType="unknown",displayName="Unknown",previewText="uncertain",isGroup=false}}});
var directoryA=WsLiveDirectory.Project(directoryInput,ordinary,5,8,"collector");
var directoryB=WsLiveDirectory.Project(directoryInput,dedicated,5,8,"collector");
Check(directoryA.GetProperty("conversations").GetArrayLength()==1 && directoryA.GetProperty("groupConversations").GetArrayLength()==0
 && !directoryA.ToString().Contains("2@g.us") && directoryA.GetProperty("accountId").GetString()=="ordinary","live rows are purpose-filtered by the native host");
Check(directoryB.GetProperty("conversations").GetArrayLength()==0 && directoryB.GetProperty("groupConversations").GetArrayLength()==1
 && !directoryB.ToString().Contains("group body") && !directoryB.ToString().Contains("private preview")
 && directoryB.GetProperty("sessionGeneration").GetInt32()==5 && directoryB.GetProperty("collectorEpoch").GetInt32()==8
 && directoryB.GetProperty("scanId").GetInt32()==9 && directoryB.GetProperty("complete").GetBoolean(),"dedicated directory shares group identities with provenance");
Check(ordinary.AllowsHistory("919876543210@c.us","direct"),"ordinary direct preserved");
Check(!ordinary.AllowsHistory("123@g.us","direct")&&!ordinary.AllowsHistory("123@g.us","vip_group",true,true),"forged direct and VIP group rejected");
Check(!dedicated.AllowsHistory("919876543210@c.us","direct"),"dedicated direct history rejected");
await Denied(()=>api.GetWsCollectorPurposeAsync("DEDICATED"));await Denied(()=>api.GetWsCollectorPurposeAsync("unknown"));
var monitor=await api.GetWsCollectorMonitorAsync("dedicated","profile");
Check(monitor.Targets.Count==1&&monitor.Targets[0].GroupJid=="123@g.us","only exact saved JID target allowed");
var membership=new WsGroupMembershipEventDto("dedicated","profile","target","123@g.us","919876543210@c.us","919876543210","joined");
Check(monitor.AllowsEvent(membership)&&!monitor.AllowsEvent(membership with{GroupJid="Same name"})&&!monitor.AllowsEvent(membership with{TargetId="forged"}),"names and forged target cannot authorize");
var now=DateTimeOffset.UtcNow;
var direct=new WsMessageEnvelopeDto("desktop-webview2","ordinary","919876543210@c.us","m",null,"receive","hello",false,now,ConversationType:"direct");
var checkpoint=new WsCheckpointDto("ordinary",direct.ConversationKey,"","fp",now,ConversationType:"direct");
var batch=new WsIngestBatchRequestDto("zhike.ws.ingest.batch.v1","desktop-webview2","ordinary",now,"background-collector",[direct],[checkpoint]);
await api.AuthorizeWsCollectorBatchAsync(batch);
await Denied(()=>api.AuthorizeWsCollectorBatchAsync(batch with{AccountId="dedicated",Messages=[direct with{AccountId="dedicated"}],Checkpoints=[checkpoint with{AccountId="dedicated"}]}));
await Denied(()=>api.AuthorizeWsCollectorBatchAsync(batch with{Messages=[direct with{ConversationKey="123@g.us"}],Checkpoints=[checkpoint with{ConversationKey="123@g.us"}]}));
var groupCheckpoint=new WsCheckpointDto("dedicated","123@g.us","","fp",now,ConversationType:"group",IsGroup:true);
await api.AuthorizeWsCollectorBatchAsync(batch with{AccountId="dedicated",Messages=[],Checkpoints=[groupCheckpoint],GroupEvents=[membership]});
await Denied(()=>api.AuthorizeWsCollectorBatchAsync(batch with{AccountId="dedicated",Messages=[],Checkpoints=[groupCheckpoint with{HistoryLoaded=true}],GroupEvents=[membership]}));
Check(ordinary.AllowsCheckpoint(groupCheckpoint with{AccountId="ordinary"}),"ordinary retains read-only group directory");
await api.AuthorizeWsCollectorBatchAsync(batch with{Checkpoints=[checkpoint,groupCheckpoint with{AccountId="ordinary"}],GroupEvents=[membership with{AccountId="ordinary",ProfileId="old-disabled-profile"}]});
Check(!ordinary.AllowsCheckpoint(groupCheckpoint with{AccountId="ordinary",HistoryMessageCount=1})&&!dedicated.AllowsCheckpoint(groupCheckpoint with{Coverage="read-history-complete"}),"directory cannot claim full group history");
var evidence=direct with{AccountId="dedicated",ConversationKey="123@g.us",ConversationType="group",Direction="incoming",DirectionSource="class-message-in",SenderId="123456789@lid",SenderIdentitySource="sender-jid",SenderIdentityTrusted=true};
var evidenceBatch=batch with{AccountId="dedicated",Messages=[evidence],Checkpoints=[groupCheckpoint]};
await api.AuthorizeWsCollectorBatchAsync(evidenceBatch);
Check(!dedicated.AllowsMessage(evidence)&&dedicated.AllowsMessage(evidence,[monitor]),"group evidence needs saved exact target independently of VIP");
foreach(var invalid in new[]{evidence with{ConversationKey="Same name"},evidence with{ConversationKey="666@g.us"},evidence with{ConversationType="direct"},evidence with{Direction="outgoing"},evidence with{SenderId="nickname"},evidence with{SenderIdentityTrusted=false},evidence with{SenderIdentitySource="account-self"},evidence with{PreviewOnly=true}})
 await Denied(()=>api.AuthorizeWsCollectorBatchAsync(evidenceBatch with{Messages=[invalid]}));
handler.Disabled=true;await Denied(()=>api.AuthorizeWsCollectorBatchAsync(evidenceBatch));handler.Disabled=false;
handler.ForeignProfile=true;await Denied(()=>api.AuthorizeWsCollectorBatchAsync(evidenceBatch));handler.ForeignProfile=false;
var ingress=Probe.Filter(ordinary,monitor,[direct],[checkpoint,groupCheckpoint with{AccountId="ordinary"}],[membership with{AccountId="ordinary"}]);
Check(ingress.Messages.Count==1&&ingress.Checkpoints.Count==2&&ingress.GroupEvents!.Count==0&&ingress.Checkpoints[0].ConversationType=="direct", "actual ordinary ingress preserves direct and directory, filters member events");
ingress=Probe.Filter(dedicated,monitor,[evidence with{ConversationType="vip_group",VipGroup=true}], [groupCheckpoint with{ConversationType="vip_group",VipGroup=true}], [membership]);
Check(ingress.Messages.Count==1&&ingress.Messages[0].ConversationType=="group"&&!ingress.Messages[0].VipGroup&&ingress.GroupEvents!.Count==1,"actual dedicated ingress retains observed member body and canonicalizes legacy group encoding");

var probe=new Probe(api,"ordinary");
Check((await probe.Call("ordinary")).Ok&&probe.Executed==1,"ordinary command keeps working");
Check(!(await probe.Call("dedicated")).Ok&&probe.Executed==1,"ordinary cannot invoke dedicated command");
var gate=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);handler.AccountGate=gate;
var pending=probe.Call("ordinary");await handler.Entered.Task;
probe.AdvanceEpoch();gate.SetResult();var stale=await pending;
Check(!stale.Ok&&stale.ErrorCode=="COLLECTOR_CONTEXT_CHANGED"&&probe.Executed==1,"epoch change during sidecar confirmation cannot execute old command");
handler.AccountGate=null;handler.Entered=new(TaskCreationOptions.RunContinuationsAsynchronously);
probe=new Probe(api,"dedicated");
var configured=await probe.Configure(new{profileId="profile",workspaceMode="ordinary",targets=new[]{new{targetId="forged",groupJid="666@g.us",groupName="Same name",vipOnly=true}}});
Check(configured.Ok&&probe.LastScript.Contains("123@g.us")&&!probe.LastScript.Contains("666@g.us"),"renderer cannot replace saved group authority");
probe=new Probe(api,"dedicated");var monitorGate=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);handler.MonitorGate=monitorGate;handler.Entered=new(TaskCreationOptions.RunContinuationsAsynchronously);
var pendingConfig=probe.Configure(new{profileId="profile"});await handler.Entered.Task;probe.AdvanceEpoch();monitorGate.SetResult();
Check(!(await pendingConfig).Ok&&probe.Executed==0,"late sidecar monitor config cannot execute after pause/epoch change");
handler.Offline=true;
probe=new Probe(api,"dedicated");
Check((await probe.ReadDirectory()).Ok && (await probe.ReadPurpose()).WorkspaceMode=="dedicated","read-only directory reuses the same generation and epoch lease while sidecar is offline");
probe.AdvanceEpoch();
await probe.Register("ordinary",true);
try{await probe.ReadPurpose();throw new Exception("foreign account registration leaked its purpose");}catch(HttpRequestException){}
await probe.Register("dedicated",false);
try{await probe.ReadPurpose();throw new Exception("implicit or unverified registration granted access");}catch(HttpRequestException){}
await probe.Register("dedicated",true);
Check((await probe.ReadPurpose()).WorkspaceMode=="dedicated","explicit confirmed account registration supplies only the foreground read scope");
Check(!(await probe.ReadDirectory()).Ok,"expired collector lease cannot use a saved foreground registration");
Console.WriteLine("native purpose policy: sidecar account, exact group target, queue replay, offline reads and awaited epoch checks PASS");

sealed class Sidecar:HttpMessageHandler{
 public bool Offline;
 public bool Disabled,ForeignProfile;public TaskCompletionSource? AccountGate,MonitorGate;public TaskCompletionSource Entered=new(TaskCreationOptions.RunContinuationsAsynchronously);
 protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req,CancellationToken ct){
  if(Offline)throw new HttpRequestException("test sidecar offline");
  object data;
  if(req.RequestUri!.AbsolutePath=="/api/ws/accounts"){
   if(AccountGate is {} gate){Entered.TrySetResult();await gate.Task.WaitAsync(ct);}
   data=new{accounts=new object[]{new{id="ordinary",displayName="ordinary",status="未连接",workspaceMode="ordinary"},new{id="dedicated",displayName="dedicated",status="未连接",workspaceMode="dedicated"},new{id="unknown",displayName="unknown",status="未连接",workspaceMode="VIP"}}};
  }else {if(MonitorGate is {} gate){Entered.TrySetResult();await gate.Task.WaitAsync(ct);}var profile=new{id="profile",accountId=ForeignProfile?"ordinary":"dedicated",enabled=!Disabled,pollIntervalSec=45,targets=new[]{new{id="target",profileId="profile",accountId="dedicated",groupJid="123@g.us",groupName="Same name",sourceId="s",enabled=true},new{id="name",profileId="profile",accountId="dedicated",groupJid="Same name",groupName="Same name",sourceId="s",enabled=true}}};data=req.RequestUri.AbsolutePath.EndsWith("/profiles")?(object)new{profiles=new[]{profile}}:new{profile};}
  return new(HttpStatusCode.OK){Content=JsonContent.Create(data)};
 }
}
sealed class WebView2{public object? CoreWebView2{get;}=new();}
sealed class Session(string id){public string AccountId=id;public long Generation=1;public string CollectorState="running";public WebView2 CollectorView=new();public string? VisibleDirectoryWorkspaceMode{get;set;}}
static class App{public static Service WsService=new();public static Service WsSessions=>WsService;}
sealed class Service{public Session Current=new("ordinary");public bool TryGetSession(string id,out Session? session){session=Current;return Current.AccountId==id;}public bool IsCurrent(string id,long generation,WebView2 view)=>Current.AccountId==id&&Current.Generation==generation&&ReferenceEquals(Current.CollectorView,view);}
static class DesktopBridgeService{public const string CurrentVersion="1";}
sealed class Probe{
 readonly FixtureRegistry _wsAccountStore=new();
 sealed record Registration(string Id,string WorkspaceMode,bool DirectoryPurposeConfirmed);
 sealed class FixtureRegistry{public List<Registration> Rows=[];public Task<List<Registration>> LoadAsync(CancellationToken ct)=>Task.FromResult(Rows);}
 public Task Register(string id,bool confirmed){_wsAccountStore.Rows=[new(id,id,confirmed)];return Task.CompletedTask;}
 public Task<BridgeResponse> ReadDirectory()=>ExecuteCollectorCommandAsync("test",App.WsService.Current.AccountId,"fixture",CancellationToken.None,directory:true);
 public Task<WsCollectorPurposePolicy> ReadPurpose()=>ResolveVisibleDirectoryPurposeAsync(App.WsService.Current,CancellationToken.None);
 readonly ApiClient? _api;readonly Dictionary<WebView2,SemaphoreSlim> _wsCollectorGates=new();readonly Dictionary<WebView2,long> _wsCollectorEpoch=new();
 sealed record CollectorPurposeLease(long Generation,long Epoch,WsCollectorPurposePolicy Policy);
 readonly Dictionary<WebView2,CollectorPurposeLease> _wsCollectorPurposes=new();readonly Dictionary<string,JsonElement> _wsCollectorMonitor=new();readonly Dictionary<string,WsCollectorMonitorPolicy> _wsCollectorMonitorPolicies=new();
 public int Executed;public string LastScript="";
 public Probe(ApiClient api,string id){_api=api;App.WsService.Current=new(id);var view=App.WsService.Current.CollectorView;_wsCollectorGates[view]=new(1,1);_wsCollectorEpoch[view]=1;_wsCollectorPurposes[view]=new(1,1,new(id,id));}
 public Task<BridgeResponse> Call(string mode)=>ExecuteCollectorCommandAsync("test",App.WsService.Current.AccountId,"fixture",CancellationToken.None,mode);
 public Task<BridgeResponse> Configure(object payload)=>ConfigureGroupMonitorAsync("test",App.WsService.Current.AccountId,JsonSerializer.SerializeToElement(payload),CancellationToken.None);
 public void AdvanceEpoch()=>_wsCollectorEpoch[App.WsService.Current.CollectorView]++;
 public static WsIngestBatchRequestDto Filter(WsCollectorPurposePolicy purpose,WsCollectorMonitorPolicy monitor,List<WsMessageEnvelopeDto> messages,List<WsCheckpointDto> checkpoints,List<WsGroupMembershipEventDto> groupEvents){
  var accountId=purpose.AccountId;var _wsCollectorMonitorPolicies=new Dictionary<string,WsCollectorMonitorPolicy>{{accountId,monitor}};var historyAcks=new List<string>();
${take('            if (purpose is not null)', '            if (messages.Count == 0 && checkpoints.Count == 0 && groupEvents.Count == 0) return;')}
  return new("zhike.ws.ingest.batch.v1","desktop-webview2",accountId,DateTimeOffset.UtcNow,"background-collector",messages,checkpoints,groupEvents);
 }
 Task<string> ExecuteCollectorScriptAsync(Session session,string script,CancellationToken ct){Executed++;LastScript=script;return Task.FromResult("{\\"supported\\":true}");}
 static JsonElement ParseWebViewJsonResult(string raw)=>JsonSerializer.Deserialize<JsonElement>(raw);
 static string StringValue(JsonElement row,string name)=>row.TryGetProperty(name,out var value)?value.ToString():"";
${take('    private async Task<BridgeResponse> ExecuteCollectorCommandAsync(', '    private void SyncPooledWsPresentation')}
${take('    private async Task<WsCollectorPurposePolicy> ResolveVisibleDirectoryPurposeAsync(', '    private const string WsVisibleDirectoryScript')}
${take('    private static JsonElement MonitorScriptConfig(', '    private async Task<BridgeResponse> SetGroupMonitorStateAsync(')}
}
namespace Zhike.Desktop {
 static class App { public static FixtureSidecar? LocalService => null; }
 sealed class FixtureSidecar { public bool IsRunning=>false; public ApiClient CreateApiClient()=>throw new InvalidOperationException(); }
}
`);
const dotnet = process.env.ZHIKE_TEST_DOTNET || path.join(repo, '.tools/dotnet10/dotnet.exe');
const result = spawnSync(dotnet, ['run', '--project', path.join(root, 'Probe.csproj'), '-c', 'Release'], {
  cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000,
});
if(result.error||result.status){console.error('Fixture retained: '+root);if(result.error)throw result.error;process.exitCode=result.status||1;}
else{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(root),/^zhike-native-purpose-/);fs.rmSync(root,{recursive:true});}
