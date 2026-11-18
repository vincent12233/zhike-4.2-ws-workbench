using Microsoft.UI.Xaml;
using Zhike.Desktop.Services;

namespace Zhike.Desktop;

public partial class App : Application
{
    private Window? _window;
    public static MainWindow? MainWindowInstance { get; private set; }
    public static LocalServiceManager? LocalService { get; private set; }
    public static Task<LocalServiceInfo>? LocalServiceReady { get; private set; }
    public static WsRuntimeCoordinator WsRuntime { get; } = new(WsCollectionPolicy.PersonalWhatsAppDefault);
    public static WsWebViewSessionPool WsSessions { get; } = new(WsRuntime, capacity: 3);
    public static WsRuntimeService WsService { get; } = new(WsRuntime, WsSessions);
    // The supervisor is part of the WinUI host boundary, but remains disabled
    // until the production Worker gate is approved. Stage 1.5 uses the same
    // object with an isolated child process and temporary workspace.
    public static WorkerSupervisor? WorkerSupervisor { get; private set; }
    public static WorkerFeatureFlagsSnapshot? WorkerFlags { get; private set; }
    public static WorkerRuntimeController? WorkerRuntime { get; private set; }
    private static readonly SemaphoreSlim LocalServiceRecoveryGate = new(1, 1);

    public App()
    {
        InitializeComponent();
#if STAGE51_ISOLATED_UI
        UnhandledException += (_, args) => Stage51Isolation.Record("unhandled-native", new
        {
            type = args.Exception.GetType().Name,
            hresult = args.Exception.HResult,
            message = args.Message.Length > 1024 ? args.Message[..1024] : args.Message,
        });
#endif
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var resourceRoot = Path.Combine(AppContext.BaseDirectory, "resources", "app");
        // 6.0 starts from an isolated empty workspace.  The previous Zhike
        // directory is deliberately neither read nor deleted.
        var dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6");
#if STAGE51_ISOLATED_UI
        dataRoot = Stage51Isolation.MapDataPath(dataRoot);
        Stage51Isolation.Record("application-start", new { dataRoot, productionEntry = "FROZEN" });
#endif
        LocalService = new LocalServiceManager(resourceRoot, dataRoot);
        WorkerFlags = WorkerFeatureFlags.Load(dataRoot);
        // The executable path is intentionally absent in the desktop shell
        // until a separately approved Worker release is configured. This
        // keeps launch inert even if a stale flag file exists.
        WorkerSupervisor = new WorkerSupervisor(new WorkerSupervisorOptions(dataRoot, Enabled: false));
        WorkerRuntime = new WorkerRuntimeController(WorkerSupervisor, WorkerFlags);
        LocalServiceReady = LocalService.StartAsync();
        _ = HydrateWsRuntimeAsync();
        MainWindowInstance = new MainWindow();
        _window = MainWindowInstance;
        _window.Activate();
    }

    private static async Task HydrateWsRuntimeAsync()
    {
        try
        {
            var stored = await new WsAccountStore().LoadAsync();
            WsRuntime.RegisterAccounts(stored);
        }
        catch
        {
            // Account metadata remains owned by WsAccountStore. A transient
            // read failure must not block the desktop shell; WS will register
            // accounts again when its page initializes.
        }
    }

    public static async Task StopLocalServiceAsync()
    {
#if STAGE51_ISOLATED_UI
        Stage51Isolation.Record("application-stopping");
#endif
        if (WorkerRuntime is not null)
        {
            try { await WorkerRuntime.StopAsync(); } catch { }
        }
        if (LocalService is null) return;
        try { await LocalService.StopAsync(); } catch { }
#if STAGE51_ISOLATED_UI
        Stage51Isolation.Record("sidecar-stopped", new { running = LocalService.IsRunning });
#endif
    }

    public static async Task<LocalServiceInfo> EnsureLocalServiceAsync(CancellationToken cancellationToken = default)
    {
        if (LocalService is null) throw new InvalidOperationException("本机数据服务尚未初始化。");
        await LocalServiceRecoveryGate.WaitAsync(cancellationToken);
        try
        {
            // The first launch can fail before a healthy sidecar task is
            // published (stale lock, transient port race, or a slow WebView2
            // startup).  Do not leave the page bound to a permanently faulted
            // LocalServiceReady task; retry the guarded owner start here.
            LocalServiceInfo ready;
            try
            {
                ready = await (LocalServiceReady ?? Task.FromException<LocalServiceInfo>(new InvalidOperationException("本机数据服务尚未初始化。")))
                    .WaitAsync(cancellationToken);
            }
            catch
            {
                cancellationToken.ThrowIfCancellationRequested();
                LocalServiceReady = LocalService.StartAsync(cancellationToken);
                ready = await LocalServiceReady.WaitAsync(cancellationToken);
            }

            // A completed task only proves that the sidecar was healthy at
            // launch.  If it exited afterwards, transparently restart it
            // before returning the API endpoint so WS, import and settings
            // pages do not surface a generic bridge-timeout error.
            var healthy = await LocalService.HealthAsync(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            if (healthy) return ready;
            var recovered = await LocalService.RestartAsync(cancellationToken);
            LocalServiceReady = Task.FromResult(recovered);
            return recovered;
        }
        finally { LocalServiceRecoveryGate.Release(); }
    }

    public static async Task<LocalServiceInfo> RecoverLocalServiceAsync(CancellationToken cancellationToken = default)
    {
        if (LocalService is null) throw new InvalidOperationException("本机数据服务尚未初始化。");
        await LocalServiceRecoveryGate.WaitAsync(cancellationToken);
        try
        {
            using var healthTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            healthTimeout.CancelAfter(TimeSpan.FromSeconds(3));
            if (LocalService.Info is null || LocalServiceReady is null || !LocalServiceReady.IsCompletedSuccessfully)
            {
                LocalServiceReady = LocalService.StartAsync(cancellationToken);
                return await LocalServiceReady.WaitAsync(cancellationToken);
            }
            if (await LocalService.HealthAsync(healthTimeout.Token))
                return LocalService.Info ?? await EnsureLocalServiceAsync(cancellationToken);
            var recovered = await LocalService.RestartAsync(cancellationToken);
            LocalServiceReady = Task.FromResult(recovered);
            return recovered;
        }
        finally { LocalServiceRecoveryGate.Release(); }
    }
}
