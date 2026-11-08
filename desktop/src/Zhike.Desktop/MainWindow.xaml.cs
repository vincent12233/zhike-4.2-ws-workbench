using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Windowing;
using Microsoft.UI;
using WinRT.Interop;
using Zhike.Desktop.Services;
using Zhike.Desktop.Views;

namespace Zhike.Desktop;

public sealed partial class MainWindow : Window
{
    private readonly WindowLayoutService _layout = new();
    private readonly bool _legacyHostEnabled;
    private DispatcherQueueTimer? _layoutSaveTimer;

    public MainWindow()
    {
        InitializeComponent();
        _legacyHostEnabled = !string.Equals(Environment.GetEnvironmentVariable("ZHIKE_LEGACY_UI_HOST"), "0", StringComparison.OrdinalIgnoreCase);
        SetBrandTitle();
        RootNavigation.SelectedItem = RootNavigation.MenuItems.OfType<NavigationViewItem>().First(item => Equals(item.Tag, "home"));
        ShowRoute("home");
        ConfigureLayoutPersistence();
    }

    private void SetBrandTitle()
    {
        try
        {
            var hWnd = WindowNative.GetWindowHandle(this);
            var windowId = Win32Interop.GetWindowIdFromWindow(hWnd);
            AppWindow.GetFromWindowId(windowId).Title = "知客工作台";
        }
        catch { }
    }

    private void OnNavigationChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item || item.Tag is not string tag) return;
        ShowRoute(RouteForTag(tag));
    }

    private void ShowRoute(string route)
    {
        if (_legacyHostEnabled)
        {
            if (ContentFrame.Content is not LegacyUiHostPage)
                ContentFrame.Navigate(typeof(LegacyUiHostPage));
            if (ContentFrame.Content is LegacyUiHostPage host)
                _ = host.NavigateRouteAsync(route);
            return;
        }

        var pageType = route switch
        {
            "customers" => typeof(CustomersPage),
            "import" => typeof(ImportPage),
            "operations" => typeof(OperationsPage),
            "ws-workbench" => typeof(WsWorkbenchPage),
            "ai" => typeof(AiFollowupPage),
            _ => typeof(HomePage),
        };
        if (ContentFrame.CurrentSourcePageType != pageType) ContentFrame.Navigate(pageType);
    }

    private static string RouteForTag(string tag) => tag switch
    {
        "ws" => "ws-workbench",
        "gpt" => "gpt",
        "ai" => "ai",
        _ => tag,
    };

    private void ConfigureLayoutPersistence()
    {
        _layoutSaveTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_layoutSaveTimer is not null)
        {
            _layoutSaveTimer.Interval = TimeSpan.FromMilliseconds(250);
            _layoutSaveTimer.IsRepeating = false;
            _layoutSaveTimer.Tick += async (_, _) =>
            {
                _layoutSaveTimer.Stop();
                var state = _layout.ApplyLayout(RootShell.ActualWidth, RootShell.ActualHeight, 1, false, false);
                await _layout.SaveAsync(state);
            };
        }
        _ = RestoreLayoutAsync();
    }

    private async Task RestoreLayoutAsync()
    {
        try { _ = await _layout.LoadAsync(); }
        catch { }
    }

    private void OnShellSizeChanged(object sender, SizeChangedEventArgs args)
    {
        _layoutSaveTimer?.Stop();
        _layoutSaveTimer?.Start();
    }
}
