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
    private static readonly SemaphoreSlim LocalServiceRecoveryGate = new(1, 1);

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var resourceRoot = Path.Combine(AppContext.BaseDirectory, "resources", "app");
        // 6.0 starts from an isolated empty workspace.  The previous Zhike
        // directory is deliberately neither read nor deleted.
        var dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6");
        LocalService = new LocalServiceManager(resourceRoot, dataRoot);
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
        if (LocalService is null) return;
        try { await LocalService.StopAsync(); } catch { }
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
                LocalServiceReady = LocalService.StartAsync(cancellationToken);
                ready = await LocalServiceReady.WaitAsync(cancellationToken);
            }

            // A completed task only proves that the sidecar was healthy at
            // launch.  If it exited afterwards, transparently restart it
            // before returning the API endpoint so WS, import and settings
            // pages do not surface a generic bridge-timeout error.
            if (await LocalService.HealthAsync(cancellationToken)) return ready;
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
