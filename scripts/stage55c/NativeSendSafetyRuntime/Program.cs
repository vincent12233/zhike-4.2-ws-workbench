using System.Text.Json;
namespace Zhike.Desktop.Services;

internal static class Program
{
    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private static JsonElement Payload(bool media = true) => JsonSerializer.SerializeToElement(new { confirmed = true, mediaId = media ? "synthetic-media" : "", text = "synthetic text", conversationKey = "synthetic-target" });
    private static string State(BridgeResponse response) => response.Data is { } data && data.TryGetProperty("deliveryState", out var state) ? state.GetString() ?? "" : "";
    private static bool Attempted(BridgeResponse response) => response.Data is { } data && data.TryGetProperty("dispatchAttempted", out var attempted) && attempted.ValueKind == JsonValueKind.True;
    private static (NativeSendHost Host, FakeCore Core) Setup()
    {
        var core = new FakeCore();
        FakeCore.TotalCalls = 0;
        App.WsService = new FakeWsService(); App.WsRuntime = new FakeRuntime(); App.WsSessions = new FakePool();
        App.WsService.Sessions["a"] = new FakeSession("a", 1, new FakeView(core));
        App.WsService.Sessions["b"] = new FakeSession("b", 2, new FakeView(new FakeCore()));
        ApiClient.Pending = new(TaskCreationOptions.RunContinuationsAsynchronously);
        ApiClient.FetchCount = 0;
        ApiClient.PurposeMode = "ordinary"; ApiClient.PurposePending = null;
        return (new NativeSendHost(), core);
    }
    private static async Task CheckDelayed(Func<NativeSendHost, CancellationTokenSource, Task> change)
    {
        var (host, core) = Setup(); using var cts = new CancellationTokenSource();
        var sending = host.SendMedia(Payload(), cts.Token);
        Check(ApiClient.FetchCount == 1 && core.Calls == 0, "must be awaiting the isolated media adapter");
        await change(host, cts);
        ApiClient.Pending.SetResult(new(true, 200, "", [1,2,3], "image/png", ""));
        BridgeResponse? response = null; try { response = await sending; } catch (OperationCanceledException) { }
        Check(FakeCore.TotalCalls == 0, "stale/cancelled request reached ExecuteScriptAsync on an old or replacement Core");
        if (response is not null)
        {
            Check(!response.Ok && State(response) == "failed" && !Attempted(response), "pre-dispatch refusal must be an explicit non-attempt");
            Check(response.Data!.Value.GetProperty("notAttempted").GetBoolean() && response.Data.Value.GetProperty("phase").GetString()=="preflight", "safe retry evidence is explicit and limited to pre-dispatch refusal");
        }
    }
    public static async Task Main()
    {
        var results = new List<object>();
        async Task Case(string name, Func<Task> action) { try { await action(); results.Add(new { name, passed=true }); } catch(Exception e) { results.Add(new { name, passed=false, reason=e.Message }); Environment.ExitCode=1; } }
        await Case("media-await-cancel", () => CheckDelayed((host, cts) => { cts.Cancel(); return Task.CompletedTask; }));
        await Case("media-await-account-switch", () => CheckDelayed((host, cts) => host.Action("open", "b")));
        await Case("media-await-A-B-A", () => CheckDelayed(async (host, cts) => { await host.Action("open", "b"); await host.Action("open", "a"); }));
        await Case("media-await-session-replaced", () => CheckDelayed((host, cts) => { App.WsService.Sessions["a"] = new FakeSession("a", 3, new FakeView(new FakeCore())); return Task.CompletedTask; }));
        await Case("media-await-same-generation-session-replaced", () => CheckDelayed((host, cts) => { var old=App.WsService.Sessions["a"]; App.WsService.Sessions["a"] = new FakeSession("a", old.Generation, old.View); return Task.CompletedTask; }));
        await Case("media-await-core-replaced", () => CheckDelayed((host, cts) => { App.WsService.Sessions["a"].View.CoreWebView2 = new FakeCore(); return Task.CompletedTask; }));
        await Case("media-await-close", () => CheckDelayed((host, cts) => host.Action("close", "a")));
        await Case("media-await-window-hidden", () => CheckDelayed((host, cts) => { host.HideForTest(); return Task.CompletedTask; }));
        await Case("text-local-attempt-only", async () => { var (host, core)=Setup(); var r=await host.SendText(Payload(false),default); Check(core.Calls==1 && State(r)=="local_attempted" && Attempted(r), "DOM bridge success must not claim platform acceptance/delivery"); });
        await Case("dedicated-purpose-refuses-text-media-broadcast", async () => {
            var (host, core)=Setup(); ApiClient.PurposeMode="dedicated";
            var text=await host.SendText(Payload(false),default); var media=await host.SendMedia(Payload(),default);
            var batch=await host.Broadcast(JsonSerializer.SerializeToElement(new{confirmed=true,workspaceMode="ordinary",text="hello",recipients=new[]{new{conversationKey="synthetic-target"}}}),default);
            Check(!text.Ok&&!media.Ok&&!batch.Ok&&FakeCore.TotalCalls==0&&ApiClient.FetchCount==0,"dedicated cannot dispatch or fetch media through ordinary entry points");
        });
        await Case("group-JID-refuses-text-media-and-entire-mixed-batch", async () => {
            var (host, core)=Setup();var group=JsonSerializer.SerializeToElement(new{confirmed=true,conversationKey="123@g.us",text="hello",dataBase64="AQID"});
            Check(!(await host.SendText(group,default)).Ok&&!(await host.SendMedia(group,default)).Ok,"group JID refused before DOM");
            var batch=await host.Broadcast(JsonSerializer.SerializeToElement(new{confirmed=true,text="hello",recipients=new[]{new{conversationKey="synthetic-target"},new{conversationKey="123@G.US"}}}),default);
            Check(!batch.Ok&&FakeCore.TotalCalls==0,"mixed batch is refused before its first direct send");
        });
        await Case("purpose-await-foreground-change-never-dispatches", async () => {
            var(host,core)=Setup();ApiClient.PurposePending=new(TaskCreationOptions.RunContinuationsAsynchronously);
            var sending=host.SendText(Payload(false),default);host.InvalidateForTest();ApiClient.PurposePending.SetResult(new("ordinary"));var result=await sending;
            Check(!result.Ok&&!Attempted(result)&&FakeCore.TotalCalls==0,"old confirmed purpose cannot revive an invalidated foreground ticket");
        });
        await Case("purpose-confirmation-error-never-dispatches", async () => {
            var(host,core)=Setup();ApiClient.PurposePending=new(TaskCreationOptions.RunContinuationsAsynchronously);
            var sending=host.SendText(Payload(false),default);ApiClient.PurposePending.SetException(new IOException("sidecar unavailable"));var result=await sending;
            Check(!result.Ok&&!Attempted(result)&&FakeCore.TotalCalls==0,"unconfirmed purpose fails closed");
        });
        await Case("media-local-attempt-only", async () => { var (host, core)=Setup(); ApiClient.Pending.SetResult(new(true,200,"",[1],"image/png","")); var r=await host.SendMedia(Payload(),default); Check(core.Calls==1 && State(r)=="local_attempted" && Attempted(r), "media DOM success must report only a local attempt"); });
        await Case("dispatch-exception-is-unknown", async () => { var (host,core)=Setup(); core.Throw=true; var r=await host.SendText(Payload(false),default); Check(State(r)=="unknown" && Attempted(r), "ExecuteScript failure after invocation cannot prove not sent"); });
        await Case("invalid-dispatch-result-is-unknown", async () => { var (host,core)=Setup(); core.Raw="not-json"; var r=await host.SendText(Payload(false),default); Check(State(r)=="unknown" && Attempted(r), "missing page result cannot prove not sent"); });
        await Case("post-dispatch-cancel-is-unknown", async () => { var (host,core)=Setup(); using var cts=new CancellationTokenSource(); core.BeforeReturn=()=>cts.Cancel(); var r=await host.SendText(Payload(false),cts.Token); Check(State(r)=="unknown" && Attempted(r), "cancellation after dispatch cannot prove not sent"); });
        await Case("page-pre-click-refusal-is-failed", async () => { var (host,core)=Setup(); core.Raw="{\"ok\":false,\"code\":\"WRONG_CONVERSATION\",\"error\":\"synthetic refusal\",\"deliveryState\":\"failed\",\"dispatchAttempted\":false}"; var r=await host.SendText(Payload(false),default); Check(!r.Ok && State(r)=="failed" && !Attempted(r), "explicit page pre-click refusal retains non-attempt evidence"); });
        await Case("missing-target-never-dispatches", async () => { var (host,core)=Setup(); var r=await host.SendText(JsonSerializer.SerializeToElement(new {confirmed=true,text="synthetic"}),default); Check(!r.Ok && State(r)=="failed" && !Attempted(r) && FakeCore.TotalCalls==0,"missing target cannot authorize an implicit conversation"); });
        await Case("in-flight-cancel-releases-wait-as-unknown", async () => { var(host,core)=Setup(); using var cts=new CancellationTokenSource(); core.Pending=new(TaskCreationOptions.RunContinuationsAsynchronously); var sending=host.SendText(Payload(false),cts.Token); Check(core.Calls==1,"dispatch must be in flight"); cts.Cancel(); var r=await sending.WaitAsync(TimeSpan.FromSeconds(2)); Check(State(r)=="unknown" && Attempted(r),"cancelled in-flight COM wait must settle unknown"); core.Pending.SetResult(core.Raw); });
        await Case("post-dispatch-A-B-A-remains-unknown", async () => { var(host,core)=Setup(); core.Pending=new(TaskCreationOptions.RunContinuationsAsynchronously); var sending=host.SendText(Payload(false),default); await host.Action("open","b"); await host.Action("open","a"); core.Pending.SetResult(core.Raw); var r=await sending; Check(core.Calls==1 && State(r)=="unknown" && Attempted(r),"returning to A cannot revive an in-flight send's authority"); Check(!r.Data!.Value.TryGetProperty("notAttempted",out _),"possible dispatch must never authorize retry"); });
        await Case("webview-string-wrapped-result-is-parsed", async () => { var(host,core)=Setup(); core.Raw=JsonSerializer.Serialize(core.Raw); var r=await host.SendText(Payload(false),default); Check(State(r)=="local_attempted" && Attempted(r),"production WebView JSON decoder must preserve a wrapped local attempt"); });
        Console.WriteLine(JsonSerializer.Serialize(new { stage="5.5C-1A", nativeHandlersFromProductionSource=true, cases=results, productionOpened=false, realWs=false, network=false }));
    }
}

public sealed class FakeCore
{
    public static int TotalCalls;
    public int Calls; public bool Throw; public Action? BeforeReturn;
    public TaskCompletionSource<string>? Pending;
    public string Raw="{\"ok\":true,\"method\":\"dom-composer\",\"deliveryState\":\"local_attempted\",\"dispatchAttempted\":true,\"platformMessageId\":null}";
    public FakeScriptOperation ExecuteScriptAsync(string script) { ++Calls; ++TotalCalls; if(Throw) throw new InvalidOperationException("synthetic dispatch exception"); BeforeReturn?.Invoke(); return new(Pending?.Task ?? Task.FromResult(Raw)); }
}
// Intentionally awaitable but not Task<string>, matching the important shape
// of WebView2's WinRT operation. This rejects accidental Func<Task<string>>
// direct conversion; it is still an isolation adapter, not a WinUI build.
public sealed class FakeScriptOperation(Task<string> task)
{
    public System.Runtime.CompilerServices.TaskAwaiter<string> GetAwaiter() => task.GetAwaiter();
}
public sealed class FakeView(FakeCore core) { public FakeCore? CoreWebView2=core; }
public sealed class FakeSession(string id,long generation,FakeView view) { public string AccountId=id; public long Generation=generation; public FakeView View=view; }
public sealed class FakeWsService
{
    public string ActiveAccountId="a"; public Dictionary<string,FakeSession> Sessions=new();
    public bool TryGetSession(string id,out FakeSession? session) => Sessions.TryGetValue(id,out session);
    public void HideForeground() => App.WsRuntime.ForegroundAccountId="";
}
public sealed class FakePool { public bool IsCurrent(string accountId,long generation,FakeView? view=null) => App.WsService.TryGetSession(accountId,out var session) && session?.Generation==generation && (view is null || ReferenceEquals(session.View,view)); }
public sealed class FakeRuntime { public string ForegroundAccountId="a"; public FakeRuntime Snapshot()=>this; }
public static class App { public static FakeWsService WsService=new(); public static FakePool WsSessions=new(); public static FakeRuntime WsRuntime=new(); public static FakeLocalService? LocalService; }
public sealed class FakeLocalService { public bool IsRunning=false; public ApiClient CreateApiClient()=>new(); }
public sealed class ApiClient
{
    public static string PurposeMode="ordinary";
    public static TaskCompletionSource<FixturePurpose>? PurposePending;
    public Task<FixturePurpose> GetWsCollectorPurposeAsync(string accountId,CancellationToken token) => (PurposePending?.Task ?? Task.FromResult(new FixturePurpose(PurposeMode))).WaitAsync(token);
    public static TaskCompletionSource<BinaryApiResponse> Pending=new(TaskCreationOptions.RunContinuationsAsynchronously);
    public static int FetchCount;
    public Task<BinaryApiResponse> GetBytesAsync(string path,CancellationToken token,int maxBytes) { ++FetchCount; return Pending.Task; }
}
public sealed record FixturePurpose(string WorkspaceMode) { public bool AllowsDirectHistory => WorkspaceMode=="ordinary"; }
public static class DesktopBridgeService { public const string CurrentVersion="test"; }
