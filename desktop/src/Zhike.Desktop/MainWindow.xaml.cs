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
    private readonly WindowLayoutService _layout = new("main");
    private bool _legacyHostEnabled;
    private string _pendingLegacyRoute = "home";
    private DispatcherQueueTimer? _layoutSaveTimer;
    private AppWindow? _appWindow;
    private bool _flushBeforeCloseInProgress;
    private bool _allowCloseAfterFlush;

    public MainWindow()
    {
        InitializeComponent();
        var legacyFlag = Environment.GetEnvironmentVariable("ZHIKE_DESKTOP_LEGACY_UI_HOST")
            ?? Environment.GetEnvironmentVariable("ZHIKE_LEGACY_UI_HOST");
        _legacyHostEnabled = !string.Equals(legacyFlag, "0", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(legacyFlag, "false", StringComparison.OrdinalIgnoreCase);
        // The legacy host already renders the complete original shell
        // (topbar, sidebar, grouping and route switching). Showing any part
        // of the native shell at the same time creates the duplicated layout
        // seen in the desktop build. Keep the native shell available only for
        // the explicit compatibility fallback.
        ApplyShellChrome();
        ContentFrame.Navigated += OnContentFrameNavigated;
        Closed += OnClosed;
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
            _appWindow = AppWindow.GetFromWindowId(windowId);
            _appWindow.Title = "知客工作台";
            var iconPath = ResolveIconPath();
            if (iconPath is not null) _appWindow.SetIcon(iconPath);
            _appWindow.Closing += OnAppWindowClosing;
        }
        catch { }
    }

    private static string? ResolveIconPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "zhike.ico"),
            Path.Combine(AppContext.BaseDirectory, "Assets", "zhike.ico"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_allowCloseAfterFlush) return;
        args.Cancel = true;
        if (_flushBeforeCloseInProgress) return;
        _flushBeforeCloseInProgress = true;
        _ = FlushThenCloseAsync();
    }

    private async Task FlushThenCloseAsync()
    {
        var flushed = true;
        try
        {
            if (ContentFrame.Content is LegacyUiHostPage host)
                flushed = await host.FlushBeforeCloseAsync(snapshot: true);
            if (!flushed)
            {
                // The Closing event was cancelled. Keep the window open so a
                // failed state write cannot be mistaken for a clean shutdown;
                // the user can retry after the service/network recovers.
                _flushBeforeCloseInProgress = false;
                return;
            }
        }
        catch (Exception error)
        {
            flushed = false;
            System.Diagnostics.Debug.WriteLine($"Desktop close flush failed: {error.GetType().Name}");
            _flushBeforeCloseInProgress = false;
        }
        finally
        {
            if (!flushed)
                System.Diagnostics.Debug.WriteLine("Desktop close continued after a best-effort flush failure.");
            // A failed or stalled best-effort flush must never leave the
            // native window permanently unclosable. The page keeps its own
            // retry/recovery state; the shell always completes the user's
            // explicit close request after the bounded attempt above.
            _allowCloseAfterFlush = true;
            _flushBeforeCloseInProgress = false;
            if (!DispatcherQueue.TryEnqueue(Close))
            {
                try { _appWindow?.Destroy(); } catch { }
            }
        }
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
            _pendingLegacyRoute = route;
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

    private void OnLegacyFallbackRequested(object? sender, string route)
    {
        // Never disguise a failed business route as a successful Home-page
        // fallback. Only routes with a complete native implementation may
        // leave the original UI host.
        if (!NativeFallbackRoutes.Contains(route)) return;
        if (sender is LegacyUiHostPage host) host.FallbackRequested -= OnLegacyFallbackRequested;
        _legacyHostEnabled = false;
        ApplyShellChrome();
        ShowRoute(route);
    }

    private static readonly HashSet<string> NativeFallbackRoutes = new(StringComparer.OrdinalIgnoreCase)
    {
        "home", "customers", "import", "operations", "ws-workbench", "ai"
    };

    private void ApplyShellChrome()
    {
        var showNativeChrome = !_legacyHostEnabled;
        NativeHeader.Visibility = showNativeChrome ? Visibility.Visible : Visibility.Collapsed;
        HeaderRow.Height = showNativeChrome ? new GridLength(52) : new GridLength(0);
        RootNavigation.IsPaneVisible = showNativeChrome;
    }

    private void OnContentFrameNavigated(object sender, Microsoft.UI.Xaml.Navigation.NavigationEventArgs args)
    {
        if (args.Content is LegacyUiHostPage host)
        {
            host.FallbackRequested -= OnLegacyFallbackRequested;
            host.FallbackRequested += OnLegacyFallbackRequested;
            _ = host.NavigateRouteAsync(_pendingLegacyRoute);
        }
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
                if (_appWindow is null) return;
                var state = _layout.ApplyLayout(RootShell.ActualWidth, RootShell.ActualHeight, CurrentRasterizationScale(), false, false);
                var maximized = _appWindow.Presenter is OverlappedPresenter presenter
                    && presenter.State == OverlappedPresenterState.Maximized;
                state = _layout.WithWindowBounds(state, _appWindow.Position.X, _appWindow.Position.Y, _appWindow.Size.Width, _appWindow.Size.Height, maximized);
                await _layout.SaveAsync(state);
            };
        }
        _ = RestoreLayoutAsync();
    }

    private async Task RestoreLayoutAsync()
    {
        try
        {
            var saved = await _layout.LoadAsync();
            if (saved is null || _appWindow is null || saved.Width < 820 || saved.Height < 540) return;
            var display = DisplayArea.GetFromWindowId(_appWindow.Id, DisplayAreaFallback.Primary);
            var work = display.WorkArea;
            var width = Math.Clamp((int)Math.Round(saved.Width), 820, work.Width);
            var height = Math.Clamp((int)Math.Round(saved.Height), 540, work.Height);
            var x = Math.Clamp(saved.X, work.X, work.X + Math.Max(0, work.Width - width));
            var y = Math.Clamp(saved.Y, work.Y, work.Y + Math.Max(0, work.Height - height));
            _appWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, width, height));
            if (saved.IsMaximized && _appWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
        }
        catch { }
    }

    private void OnShellSizeChanged(object sender, SizeChangedEventArgs args)
    {
        _layoutSaveTimer?.Stop();
        _layoutSaveTimer?.Start();
    }

    private double CurrentRasterizationScale() => RootShell.XamlRoot?.RasterizationScale ?? 1d;

    private async void OnClosed(object sender, WindowEventArgs args)
    {
        if (ContentFrame.Content is LegacyUiHostPage host && !_allowCloseAfterFlush)
            await host.FlushBeforeCloseAsync(snapshot: true);
    }
}
