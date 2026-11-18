using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Windowing;
using Microsoft.UI;
using System.Runtime.InteropServices;
using Windows.Graphics;
using WinRT.Interop;
using Zhike.Desktop.Services;
using Zhike.Desktop.Views;

namespace Zhike.Desktop;

public sealed partial class MainWindow : Window
{
    private readonly WindowLayoutService _layout = new("main");
    private readonly WorkspaceWindowPresentationService _workspacePresentation = new();
    private string _pendingRoute = "home";
    private string _normalTitle = "知客 6.1.0  Horizon Atelier";
    private DispatcherQueueTimer? _layoutSaveTimer;
    private AppWindow? _appWindow;
    private XamlRoot? _sizingRoot;
    private bool _workspaceRouteActive;
    private Task _layoutSaveTask = Task.CompletedTask;
    private bool _flushBeforeCloseInProgress;
    private bool _allowCloseAfterFlush;
#if STAGE51_ISOLATED_UI
    private Microsoft.UI.Xaml.Input.PointerEventHandler? _stage51WheelHandler;
    private readonly System.Runtime.CompilerServices.ConditionalWeakTable<Microsoft.UI.Xaml.Input.PointerRoutedEventArgs, Stage51RoutedArgsId>
        _stage51RoutedArgs = new();
    private sealed record Stage51RoutedArgsId(long Id);
    private long _stage51RoutedArgsCount;
    private long _stage51NativeWheelCount;
    private const int Stage51WheelLimit = 256;
    private uint _stage51LastDpi;
    private double _stage51LastScale;
    private long _stage51LastMonitor;
#endif

    public MainWindow()
    {
#if STAGE51_ISOLATED_UI
        Stage51Isolation.Record("window-initialize-start");
#endif
        InitializeComponent();
#if STAGE51_ISOLATED_UI
        Stage51Isolation.Record("window-initialize-completed");
#endif
        // 6.0 has one production surface: the complete WebView2 workbench.
        // Environment flags can no longer switch the process back to the
        // retired native fallback pages or create a second navigation shell.
        ContentFrame.Navigated += OnContentFrameNavigated;
        RootShell.Loaded += OnShellLoaded;
#if STAGE51_ISOLATED_UI
        if (Stage51InputDiagnostics.Enabled)
        {
            _stage51WheelHandler = OnStage51NativeWheel;
            RootShell.AddHandler(UIElement.PointerWheelChangedEvent, _stage51WheelHandler, handledEventsToo: true);
        }
#endif
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
#if STAGE51_ISOLATED_UI
            _normalTitle = "知客 Stage 5.1 · ISOLATED 验收";
#endif
            _appWindow.Title = _normalTitle;
#if STAGE51_ISOLATED_UI
            Stage51Isolation.Record("window-created", new { title = _appWindow.Title });
#endif
            var iconPath = ResolveIconPath();
            if (iconPath is not null) _appWindow.SetIcon(iconPath);
            _appWindow.Closing += OnAppWindowClosing;
            _appWindow.Changed += OnAppWindowChanged;
            ConfigureTitleBar(_appWindow);
            ApplyMinimumWindowSize(_appWindow);
        }
        catch { }
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidPresenterChange && !args.DidSizeChange && !args.DidPositionChange) return;
        if (args.DidPresenterChange) ApplyMinimumWindowSize(sender);
        var renderable = sender.Presenter is not OverlappedPresenter presenter
            || presenter.State != OverlappedPresenterState.Minimized;
        if (ContentFrame.Content is LegacyUiHostPage host)
            host.NotifyHostWindowState(renderable, refreshBounds: renderable);
#if STAGE51_ISOLATED_UI
        RecordStage51DpiChange();
        Stage51Isolation.Record("window-presentation-state", new
        {
            workspaceRouteActive = _workspaceRouteActive,
            rasterizationScale = Content?.XamlRoot?.RasterizationScale,
            clientWidth = sender.ClientSize.Width,
            clientHeight = sender.ClientSize.Height,
            preferredMinimumWidth = (sender.Presenter as OverlappedPresenter)?.PreferredMinimumWidth,
            preferredMinimumHeight = (sender.Presenter as OverlappedPresenter)?.PreferredMinimumHeight,
            placement = WorkspaceWindowPresentationService.Snapshot(WindowNative.GetWindowHandle(this)),
        });
#endif
    }

    // Only the current guarded workbench host can change shell presentation.
    // Geometry, account changes and subpage changes never re-maximize a window
    // that the operator has resized or minimized while remaining in WS.
    internal void NotifyWorkspaceRouteVisibility(LegacyUiHostPage source, bool active)
    {
        if (!ReferenceEquals(ContentFrame.Content, source) || _appWindow is null || _allowCloseAfterFlush
            || _workspaceRouteActive == active) return;
        _workspaceRouteActive = active;
        _layoutSaveTimer?.Stop();
        var handle = WindowNative.GetWindowHandle(this);
        var before = WorkspaceWindowPresentationService.Snapshot(handle);
        if (active) QueueLayoutSave(CaptureCurrentLayout());
        var result = active ? _workspacePresentation.Enter(handle) : _workspacePresentation.Exit(handle);
        _appWindow.Title = active ? $"WS 工作台 · {_normalTitle}" : _normalTitle;
        ConfigureTitleBar(_appWindow, active);
        if (!active && result.Succeeded) QueueLayoutSave(CaptureCurrentLayout());
#if STAGE51_ISOLATED_UI
        Stage51Isolation.Record(active ? "workspace-presentation-enter" : "workspace-presentation-exit", new
        {
            hwnd = handle.ToInt64(), result.Changed, result.Succeeded, result.Phase,
            rasterizationScale = Content?.XamlRoot?.RasterizationScale,
            before, after = result.Observed, title = _appWindow.Title,
        });
#endif
    }

    private static string? ResolveIconPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "zhike-horizon-6-1-0.ico"),
            Path.Combine(AppContext.BaseDirectory, "zhike-horizon-6.ico"),
            Path.Combine(AppContext.BaseDirectory, "zhike.ico"),
            Path.Combine(AppContext.BaseDirectory, "Assets", "zhike.ico"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static void ConfigureTitleBar(AppWindow window, bool workspace = false)
    {
        // Color the system title bar without replacing its native caption buttons
        // or the Windows drag, snap, minimize, maximize, and close behavior.
        if (!AppWindowTitleBar.IsCustomizationSupported()) return;

        var titleBar = window.TitleBar;
        var background = workspace
            ? Windows.UI.Color.FromArgb(255, 13, 30, 50)
            : Windows.UI.Color.FromArgb(255, 8, 21, 29);
        var foreground = Windows.UI.Color.FromArgb(255, 237, 246, 244);
        titleBar.BackgroundColor = background;
        titleBar.ForegroundColor = foreground;
        titleBar.InactiveBackgroundColor = background;
        titleBar.InactiveForegroundColor = Windows.UI.Color.FromArgb(255, 150, 171, 177);
        titleBar.ButtonBackgroundColor = background;
        titleBar.ButtonForegroundColor = foreground;
        titleBar.ButtonHoverBackgroundColor = workspace
            ? Windows.UI.Color.FromArgb(255, 29, 53, 80)
            : Windows.UI.Color.FromArgb(255, 25, 50, 61);
        titleBar.ButtonHoverForegroundColor = foreground;
        titleBar.ButtonPressedBackgroundColor = workspace
            ? Windows.UI.Color.FromArgb(255, 37, 67, 99)
            : Windows.UI.Color.FromArgb(255, 34, 72, 82);
        titleBar.ButtonPressedForegroundColor = foreground;
        titleBar.ButtonInactiveBackgroundColor = background;
        titleBar.ButtonInactiveForegroundColor = Windows.UI.Color.FromArgb(255, 150, 171, 177);
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
            try { await _layoutSaveTask.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch (TimeoutException) { System.Diagnostics.Debug.WriteLine("Window layout save exceeded close wait."); }
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
            _layoutSaveTimer.Tick += (_, _) =>
            {
                _layoutSaveTimer.Stop();
                // Forced WS maximization is temporary presentation, so closing
                // while in WS retains the layout captured before entry.
                if (_appWindow is null || _workspaceRouteActive || _workspacePresentation.IsActive) return;
                QueueLayoutSave(CaptureCurrentLayout());
            };
        }
        _ = RestoreLayoutAsync();
    }

    private async Task RestoreLayoutAsync()
    {
        try
        {
            var saved = await _layout.LoadAsync();
            if (saved is null || _appWindow is null || _workspaceRouteActive
                || !double.IsFinite(saved.Width) || !double.IsFinite(saved.Height)
                || saved.Width <= 0 || saved.Height <= 0) return;
            var display = DisplayArea.GetFromWindowId(_appWindow.Id, DisplayAreaFallback.Primary);
            var work = display.WorkArea;
            var minimum = MinimumWindowSize(_appWindow);
            if (work.Width < minimum.Width || work.Height < minimum.Height) return;
            var width = (int)Math.Clamp(Math.Round(saved.Width), minimum.Width, work.Width);
            var height = (int)Math.Clamp(Math.Round(saved.Height), minimum.Height, work.Height);
            var x = Math.Clamp(saved.X, work.X, work.X + Math.Max(0, work.Width - width));
            var y = Math.Clamp(saved.Y, work.Y, work.Y + Math.Max(0, work.Height - height));
            _appWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, width, height));
            if (saved.IsMaximized && _appWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
        }
        catch { }
    }

    private void OnShellSizeChanged(object sender, SizeChangedEventArgs args)
    {
        if (_workspaceRouteActive || _workspacePresentation.IsActive) return;
        _layoutSaveTimer?.Stop();
        _layoutSaveTimer?.Start();
    }

    private void OnShellLoaded(object sender, RoutedEventArgs args)
    {
        if (RootShell.XamlRoot is not { } root || ReferenceEquals(root, _sizingRoot)) return;
        if (_sizingRoot is not null)
        {
            _sizingRoot.Changed -= OnSizingRootChanged;
#if STAGE51_ISOLATED_UI
            _sizingRoot.Changed -= OnStage51SizingRootChanged;
#endif
        }
        _sizingRoot = root;
        root.Changed += OnSizingRootChanged;
        ApplyMinimumWindowSize(_appWindow);
#if STAGE51_ISOLATED_UI
        if (Stage51InputDiagnostics.Enabled)
        {
            root.Changed += OnStage51SizingRootChanged;
            RecordStage51DpiChange();
        }
#endif
    }

    private void OnSizingRootChanged(XamlRoot sender, XamlRootChangedEventArgs args)
        => ApplyMinimumWindowSize(_appWindow);

#if STAGE51_ISOLATED_UI
    private void OnStage51SizingRootChanged(XamlRoot sender, XamlRootChangedEventArgs args)
        => RecordStage51DpiChange();

    private void RecordStage51DpiChange()
    {
        if (!Stage51InputDiagnostics.Enabled) return;
        var hwnd = WindowNative.GetWindowHandle(this);
        var dpi = GetDpiForWindow(hwnd);
        var scale = RootShell.XamlRoot?.RasterizationScale ?? 0;
        var monitor = Stage51InputDiagnostics.MonitorIdentity(hwnd);
        if (dpi == _stage51LastDpi && scale == _stage51LastScale && monitor == _stage51LastMonitor) return;
        (_stage51LastDpi, _stage51LastScale, _stage51LastMonitor) = (dpi, scale, monitor);
        RecordStage51Input("stage51-native-dpi", null);
    }

    private void OnStage51NativeWheel(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs args)
    {
        var sequence = ++_stage51NativeWheelCount;
        if (sequence > Stage51WheelLimit)
        {
            if (sequence == Stage51WheelLimit + 1)
                RecordStage51Input("stage51-native-wheel-limit", new { sequence, limit = Stage51WheelLimit });
            return;
        }
        var tick = Environment.TickCount64;
        try
        {
            var message = Stage51InputDiagnostics.MessageContext();
            var point = args.GetCurrentPoint(RootShell);
            var argsId = _stage51RoutedArgs.GetValue(args, _ => new Stage51RoutedArgsId(++_stage51RoutedArgsCount)).Id;
            RecordStage51Input("stage51-native-wheel", new
            {
                tick, sequence, managedArgsId = argsId, message,
                pointerId = point.PointerId, pointerFrameId = point.FrameId,
                pointerTimestampUs = point.Timestamp, device = point.PointerDeviceType.ToString(),
                xDip = point.Position.X, yDip = point.Position.Y,
                wheelDelta = point.Properties.MouseWheelDelta, horizontal = point.Properties.IsHorizontalMouseWheel,
                modifiers = args.KeyModifiers.ToString(), handled = args.Handled,
                source = args.OriginalSource?.GetType().Name,
            });
        }
        catch (Exception error)
        {
            System.Diagnostics.Debug.WriteLine($"Stage51 native wheel diagnostic failed: 0x{error.HResult:X8}.");
        }
    }

    internal bool ObserveStage51DomInput(System.Text.Json.JsonElement payload, string phase)
    {
        var sample = Stage51InputDiagnostics.ReadDomSample(payload, phase);
        if (sample is null) return false;
        RecordStage51Input($"stage51-dom-{phase}", sample);
        return true;
    }

    private void RecordStage51Input(string kind, object? observed)
    {
        try
        {
            var hwnd = WindowNative.GetWindowHandle(this);
            Stage51Isolation.Record(kind, new
            {
                tick = Environment.TickCount64,
                systemDpi = Stage51InputDiagnostics.GetDpiForSystem(),
                hwndDpi = GetDpiForWindow(hwnd),
                hwndDpiAwareness = Stage51InputDiagnostics.GetDpiAwareness(hwnd),
                monitor = Stage51InputDiagnostics.MonitorIdentity(hwnd),
                clientWidthPx = _appWindow?.ClientSize.Width, clientHeightPx = _appWindow?.ClientSize.Height,
                windowWidthPx = _appWindow?.Size.Width, windowHeightPx = _appWindow?.Size.Height,
                minimumWidthPx = (_appWindow?.Presenter as OverlappedPresenter)?.PreferredMinimumWidth,
                minimumHeightPx = (_appWindow?.Presenter as OverlappedPresenter)?.PreferredMinimumHeight,
                presentation = (_appWindow?.Presenter as OverlappedPresenter)?.State.ToString(),
                nativeTheme = RootShell.ActualTheme.ToString(),
                xamlRoot = Stage51InputDiagnostics.Bounds(RootShell),
                webview = (ContentFrame.Content as LegacyUiHostPage)?.ReadStage51WebViewLayout(
                    includeCoreCounts: kind is "stage51-native-dpi" or "stage51-dom-layout" or "stage51-dom-frame"),
                input = Stage51InputDiagnostics.NativeInput(hwnd, RootShell.XamlRoot),
                observed,
            });
        }
        catch (Exception error)
        {
            System.Diagnostics.Debug.WriteLine($"Stage51 input diagnostic failed: 0x{error.HResult:X8}.");
        }
    }
#endif

    private double CurrentRasterizationScale()
    {
        if (RootShell.XamlRoot is { RasterizationScale: > 0 } root) return root.RasterizationScale;
        var dpi = GetDpiForWindow(WindowNative.GetWindowHandle(this));
        return dpi > 0 ? dpi / 96d : 1d;
    }

    private SizeInt32 MinimumWindowSize(AppWindow window)
    {
        // XAML minima describe the client area in DIPs. The presenter and
        // saved AppWindow bounds use outer window dimensions in physical pixels.
        var scale = CurrentRasterizationScale();
        var outer = window.Size;
        var client = window.ClientSize;
        var frameWidth = client.Width > 0 ? Math.Max(0, outer.Width - client.Width) : 0;
        var frameHeight = client.Height > 0 ? Math.Max(0, outer.Height - client.Height) : 0;
        return new SizeInt32(
            (int)Math.Ceiling(RootShell.MinWidth * scale) + frameWidth,
            (int)Math.Ceiling(RootShell.MinHeight * scale) + frameHeight);
    }

    private void ApplyMinimumWindowSize(AppWindow? window)
    {
        if (window is null || window.Presenter is not OverlappedPresenter presenter || presenter.State == OverlappedPresenterState.Minimized) return;
        var minimum = MinimumWindowSize(window);
        if (presenter.PreferredMinimumWidth != minimum.Width) presenter.PreferredMinimumWidth = minimum.Width;
        if (presenter.PreferredMinimumHeight != minimum.Height) presenter.PreferredMinimumHeight = minimum.Height;
    }

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint window);

    private LayoutState CaptureCurrentLayout()
    {
        var state = _layout.ApplyLayout(RootShell.ActualWidth, RootShell.ActualHeight, CurrentRasterizationScale(), false, false);
        if (_appWindow is null) return state;
        var maximized = _appWindow.Presenter is OverlappedPresenter presenter
            && presenter.State == OverlappedPresenterState.Maximized;
        return _layout.WithWindowBounds(state, _appWindow.Position.X, _appWindow.Position.Y,
            _appWindow.Size.Width, _appWindow.Size.Height, maximized);
    }

    private void QueueLayoutSave(LayoutState state)
        => _layoutSaveTask = SaveLayoutAfterAsync(_layoutSaveTask, state);

    private async Task SaveLayoutAfterAsync(Task previous, LayoutState state)
    {
        try { await previous; await _layout.SaveAsync(state); }
        catch (Exception error) { System.Diagnostics.Debug.WriteLine($"Window layout save failed: {error.GetType().Name}"); }
    }

    private async void OnClosed(object sender, WindowEventArgs args)
    {
        RootShell.Loaded -= OnShellLoaded;
#if STAGE51_ISOLATED_UI
        if (_stage51WheelHandler is not null)
            RootShell.RemoveHandler(UIElement.PointerWheelChangedEvent, _stage51WheelHandler);
        if (_sizingRoot is not null)
            _sizingRoot.Changed -= OnStage51SizingRootChanged;
#endif
        if (_sizingRoot is not null) _sizingRoot.Changed -= OnSizingRootChanged;
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
