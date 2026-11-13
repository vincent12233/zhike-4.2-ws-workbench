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
    private string _pendingRoute = "home";
    private DispatcherQueueTimer? _layoutSaveTimer;
    private AppWindow? _appWindow;
    private bool _flushBeforeCloseInProgress;
    private bool _allowCloseAfterFlush;

    public MainWindow()
    {
        InitializeComponent();
        // 6.0 has one production surface: the complete WebView2 workbench.
        // Environment flags can no longer switch the process back to the
        // retired native fallback pages or create a second navigation shell.
        ContentFrame.Navigated += OnContentFrameNavigated;
        Closed += OnClosed;
        SetBrandTitle();
        ShowRoute("home");
        ConfigureLayoutPersistence();
    }

    public void OpenWorkspaceRoute(string route)
    {
        _pendingRoute = string.IsNullOrWhiteSpace(route) ? "home" : route;
        if (ContentFrame.Content is not LegacyUiHostPage) ContentFrame.Navigate(typeof(LegacyUiHostPage));
        if (ContentFrame.Content is LegacyUiHostPage host) _ = host.NavigateRouteAsync(_pendingRoute);
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
            _appWindow.Changed += OnAppWindowChanged;
        }
        catch { }
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidPresenterChange && !args.DidSizeChange && !args.DidPositionChange) return;
        var renderable = sender.Presenter is not OverlappedPresenter presenter
            || presenter.State != OverlappedPresenterState.Minimized;
        if (ContentFrame.Content is LegacyUiHostPage host)
            host.NotifyHostWindowState(renderable, refreshBounds: renderable);
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

    private void ShowRoute(string route)
    {
        _pendingRoute = string.IsNullOrWhiteSpace(route) ? "home" : route;
        if (ContentFrame.Content is not LegacyUiHostPage)
            ContentFrame.Navigate(typeof(LegacyUiHostPage));
        if (ContentFrame.Content is LegacyUiHostPage host)
            _ = host.NavigateRouteAsync(_pendingRoute);
    }

    private void OnContentFrameNavigated(object sender, Microsoft.UI.Xaml.Navigation.NavigationEventArgs args)
    {
        if (args.Content is LegacyUiHostPage host)
        {
            var renderable = _appWindow?.Presenter is not OverlappedPresenter presenter
                || presenter.State != OverlappedPresenterState.Minimized;
            host.NotifyHostWindowState(renderable, refreshBounds: renderable);
            _ = host.NavigateRouteAsync(_pendingRoute);
        }
    }

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
        if (_appWindow is not null)
        {
            _appWindow.Changed -= OnAppWindowChanged;
            _appWindow.Closing -= OnAppWindowClosing;
        }
        if (ContentFrame.Content is LegacyUiHostPage host && !_allowCloseAfterFlush)
            await host.FlushBeforeCloseAsync(snapshot: true);
        await App.StopLocalServiceAsync();
    }
}
