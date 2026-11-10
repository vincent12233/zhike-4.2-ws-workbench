using Microsoft.UI.Xaml;
using Zhike.Desktop.Services;

namespace Zhike.Desktop;

public partial class App : Application
{
    private Window? _window;
    public static MainWindow? MainWindowInstance { get; private set; }
    public static LocalServiceManager? LocalService { get; private set; }
    public static Task<LocalServiceInfo>? LocalServiceReady { get; private set; }

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var resourceRoot = Path.Combine(AppContext.BaseDirectory, "resources", "app");
        var dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike");
        LocalService = new LocalServiceManager(resourceRoot, dataRoot);
        LocalServiceReady = LocalService.StartAsync();
        MainWindowInstance = new MainWindow();
        _window = MainWindowInstance;
        _window.Activate();
    }

    public static async Task StopLocalServiceAsync()
    {
        if (LocalService is null) return;
        try { await LocalService.StopAsync(); } catch { }
    }

    public static Task<LocalServiceInfo> EnsureLocalServiceAsync(CancellationToken cancellationToken = default)
        => LocalServiceReady?.WaitAsync(cancellationToken)
            ?? Task.FromException<LocalServiceInfo>(new InvalidOperationException("本机数据服务尚未初始化。"));
}
