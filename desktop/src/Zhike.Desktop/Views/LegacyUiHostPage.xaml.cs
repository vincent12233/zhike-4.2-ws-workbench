using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel.DataTransfer;
using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;
using System.Runtime.InteropServices.WindowsRuntime;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class LegacyUiHostPage : Page
{
    private const int MaxBridgeMessageChars = 50 * 1024 * 1024;
    private const int MaxBridgePayloadChars = 48 * 1024 * 1024;
    private readonly WebViewProfileService _profiles = new();
    private readonly WebViewProfileService _wsProfiles = new();
    private readonly WsAccountStore _wsAccountStore = new();
    private readonly LocalQueue _wsQueue = new();
    private readonly SemaphoreSlim _wsGate = new(1, 1);
    private readonly SemaphoreSlim _wsFlushGate = new(1, 1);
    private readonly SemaphoreSlim _wsMessageGate = new(1, 1);
    private readonly AiBridgeService _ai = new();
    private readonly DesktopToolsService _desktopTools = new();
    private ApiClient? _api;
    private DesktopBridgeService? _bridge;
    private ApiClient? _bridgeApi;
    private WebView2? _webView;
    private WebView2? _wsView;
    private DispatcherQueueTimer? _wsResizeTimer;
    private DispatcherQueueTimer? _desktopBackupTimer;
    private string _activeWsAccountId = "default";
    private string _wsViewAccountId = "";
    private long _wsGeneration;
    private bool _initialized;
    private string _currentRoute = "home";
    private long _routeGeneration;
    private bool _hostWindowRenderable = true;
    private int _wsBoundsRefreshInFlight;
    private string _wsBoundsDocumentId = string.Empty;
    private long _lastWsBoundsSequence;
    private bool _wsRuntimeBound;
    private readonly Dictionary<string, string[]> _vipGroupAllowlistByAccount = new(StringComparer.OrdinalIgnoreCase);

    public LegacyUiHostPage()
    {
        InitializeComponent();
        // The 6.0 workbench shell always uses the guarded local SQLite service.
        // There is one production storage path; old connection profiles are
        // intentionally ignored instead of creating a second data source.
        _api = null;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _wsResizeTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_wsResizeTimer is not null)
        {
            _wsResizeTimer.Interval = TimeSpan.FromMilliseconds(150);
            _wsResizeTimer.IsRepeating = false;
            _wsResizeTimer.Tick += async (_, _) =>
            {
                _wsResizeTimer.Stop();
                await ResizeWsOverlayFromDomAsync();
            };
        }
        _desktopTools.CustomerNotificationInvoked += customerId =>
        {
            _ = DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    App.MainWindowInstance?.Activate();
                    GetBridge().Publish("open.customer", JsonSerializer.SerializeToElement(new { id = customerId }));
                }
                catch { }
            });
        };
        _desktopBackupTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_desktopBackupTimer is not null)
        {
            _desktopBackupTimer.Interval = TimeSpan.FromMinutes(1);
            _desktopBackupTimer.Tick += async (_, _) =>
            {
                try
                {
                    if (_api is not null)
                    {
                        await _desktopTools.TryRunScheduledBackupAsync(_api, _activeWsAccountId);
                        await _desktopTools.PollDueRemindersAsync(_api);
                    }
                }
                catch { /* status retains the actionable error for Settings */ }
            };
        }
    }

    public async Task NavigateRouteAsync(string route, CancellationToken cancellationToken = default)
    {
        var requestedRoute = string.IsNullOrWhiteSpace(route) ? "home" : route;
        var generation = Interlocked.Increment(ref _routeGeneration);
        _currentRoute = requestedRoute;
        await EnsureInitializedAsync(cancellationToken);
        if (_webView?.CoreWebView2 is null || generation != Volatile.Read(ref _routeGeneration)) return;

        var selector = requestedRoute == "gpt"
            ? "#gptAssistantNav"
            : $"[data-view=\"{EscapeJs(requestedRoute)}\"]";
        var script = $"document.querySelector({JsonSerializer.Serialize(selector)})?.click(); void 0;";
        await _webView.CoreWebView2.ExecuteScriptAsync(script);
        if (!string.Equals(requestedRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
        {
            // Route changes only hide the native surface. The isolated WS
            // WebView, login session, durable collector and queue stay alive
            // so switching to customers/tasks does not interrupt collection.
            // Explicit Close WS / clear-session and desktop shutdown still
            // call CloseWsOverlayAsync and remain the only stop boundaries.
            App.WsService.HideForeground();
            HideWsOverlay();
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(_wsViewAccountId))
                await App.WsService.ShowAccountAsync(_wsViewAccountId, cancellationToken);
            RequestWsOverlayResize();
            _ = ResizeWsOverlayFromDomAsync();
        }
    }

    public async Task<bool> TryReloadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await EnsureInitializedAsync(cancellationToken);
            _webView?.CoreWebView2?.Reload();
            return true;
        }
        catch
        {
            ShowStatus("知客页面加载失败，请检查本机服务后重试。", InfoBarSeverity.Error);
            return false;
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try { await EnsureInitializedAsync(); }
        catch
        {
            ShowStatus("知客页面资源暂时不可用，请点击重试；本机数据不会受影响。", InfoBarSeverity.Error);
            HostActions.Visibility = Visibility.Visible;
        }
    }

    public async Task<bool> FlushBeforeCloseAsync(bool snapshot)
    {
        using var closeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var wsClosed = true;
        try { await App.WsService.ShutdownAsync(closeTimeout.Token); }
        catch (OperationCanceledException) when (closeTimeout.IsCancellationRequested)
        {
            wsClosed = false;
            Debug.WriteLine("WS overlay close timed out during desktop shutdown.");
        }
        catch (Exception error)
        {
            wsClosed = false;
            Debug.WriteLine($"WS overlay close failed during desktop shutdown: {error.GetType().Name}");
        }
        if (!wsClosed) return false;
        var webView = _webView;
        if (webView?.CoreWebView2 is null) return true;
        try
        {
            var options = snapshot ? "{snapshot:true}" : "{snapshot:false}";
            // ExecuteScriptAsync serializes the immediate JavaScript return
            // value; it does not reliably await a returned Promise. Start the
            // async flush and publish a small boolean acknowledgement instead.
            var startScript = "(()=>{window.__zhikeFlushResult=null;Promise.resolve().then(async()=>{try{const fn=window.__flushLocalWrites;if(typeof fn!=='function'){window.__zhikeFlushResult=true;return;}const result=await fn(" + options + ");window.__zhikeFlushResult=result!==false;}catch{window.__zhikeFlushResult=false;}});return true;})()";
            var started = await ExecuteScriptBoundedAsync(webView.CoreWebView2, startScript, TimeSpan.FromSeconds(1), closeTimeout.Token);
            if (!string.Equals(started, "true", StringComparison.OrdinalIgnoreCase))
            {
                Debug.WriteLine("Legacy page flush could not start before desktop shutdown.");
                return false;
            }
            var deadline = DateTimeOffset.UtcNow.AddSeconds(4);
            while (DateTimeOffset.UtcNow < deadline && !closeTimeout.IsCancellationRequested)
            {
                var result = await ExecuteScriptBoundedAsync(webView.CoreWebView2, "window.__zhikeFlushResult === null ? null : Boolean(window.__zhikeFlushResult)", TimeSpan.FromSeconds(1), closeTimeout.Token);
                if (result is null) return false;
                if (string.Equals(result, "true", StringComparison.OrdinalIgnoreCase)) return true;
                if (string.Equals(result, "false", StringComparison.OrdinalIgnoreCase)) return false;
                await Task.Delay(50, closeTimeout.Token);
            }
            Debug.WriteLine("Legacy page flush did not complete before desktop shutdown.");
            return false;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<string?> ExecuteScriptBoundedAsync(CoreWebView2 core, string script, TimeSpan timeout, CancellationToken cancellationToken)
    {
        try
        {
            return await core.ExecuteScriptAsync(script).AsTask().WaitAsync(timeout, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        catch (TimeoutException)
        {
            return null;
        }
        catch
        {
            return null;
        }
    }

    private async void OnUnloaded(object sender, RoutedEventArgs args)
    {
        var flushed = await FlushBeforeCloseAsync(snapshot: false);
        if (!flushed)
        {
            // Shutdown/route teardown must not leave a collector running just
            // because the async close gate timed out. Detach and close the
            // native control synchronously as a last-resort safety net.
            ForceDetachWsOverlay();
        }
        // Keep the WebView profile alive for fast route changes, but stop
        // page-level events so a hidden route cannot mutate the UI.
        if (_webView?.CoreWebView2 is not null)
        {
            _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
            _webView.CoreWebView2.NavigationStarting -= OnLegacyNavigationStarting;
            _webView.CoreWebView2.NewWindowRequested -= OnLegacyNewWindowRequested;
            _webView.CoreWebView2.NavigationCompleted -= OnLegacyNavigationCompleted;
            _webView.CoreWebView2.ProcessFailed -= OnLegacyProcessFailed;
        }
        _wsResizeTimer?.Stop();
        _desktopBackupTimer?.Stop();
        _desktopTools.UnregisterNotifications();
        HideWsOverlay();
    }

    private void OnWebViewHostSizeChanged(object sender, SizeChangedEventArgs args)
        => RequestWsOverlayResize();

    public void NotifyHostWindowState(bool renderable, bool refreshBounds = false)
    {
        _hostWindowRenderable = renderable;
        if (!renderable || !string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
        {
            HideWsOverlay();
            return;
        }
        if (refreshBounds)
        {
            RequestWsOverlayResize();
            _ = ResizeWsOverlayFromDomAsync();
        }
    }

    private void RequestWsOverlayResize()
    {
        if (!string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase)
            || !_hostWindowRenderable
            || _wsView?.CoreWebView2 is null)
            return;
        _wsResizeTimer?.Stop();
        _wsResizeTimer?.Start();
    }

    private void ForceDetachWsOverlay()
    {
        App.WsService.Abort();
        _wsView = null;
        _wsViewAccountId = string.Empty;
        Interlocked.Increment(ref _wsGeneration);
        WsOverlayHost.Children.Clear();
        HideWsOverlay();
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken = default)
    {
        if (_api is null)
        {
            await App.EnsureLocalServiceAsync(cancellationToken);
            _api = App.LocalService?.CreateApiClient() ?? throw new InvalidOperationException("本机数据服务不可用。");
        }
        _desktopBackupTimer?.Start();
        if (_initialized && _webView?.CoreWebView2 is not null)
        {
            AttachLegacyHandlers(_webView.CoreWebView2);
            BindWsRuntime();
            return;
        }
        _webView ??= new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        if (!WebViewHost.Children.Contains(_webView)) WebViewHost.Children.Insert(0, _webView);
        Canvas.SetZIndex(_webView, 0);
        Canvas.SetZIndex(WsOverlayLayer, 20);

        var environment = await _profiles.GetOrCreateProfileAsync("workbench-ui");
        cancellationToken.ThrowIfCancellationRequested();
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        AttachLegacyHandlers(core);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(LegacyBridgeScript.Build(true));
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BuildWsBoundsObserverScript());
        core.SetVirtualHostNameToFolderMapping("zhike.local", ResolveResourcesRoot(), CoreWebView2HostResourceAccessKind.Allow);
        _initialized = true;
        HostStatus.IsOpen = false;
        BindWsRuntime();
        _webView.Source = new Uri("https://zhike.local/index.html?desktop=1");
    }

    private void BindWsRuntime()
    {
        if (_wsRuntimeBound) return;
        _wsRuntimeBound = true;
        App.WsService.BindHost(DispatcherQueue, CreatePooledWsSessionAsync, HeartbeatPooledWsSessionAsync, FlushWsQueueAsync);
        App.WsService.SessionsChanged += (_, _) => DispatcherQueue.TryEnqueue(SyncPooledWsPresentation);
        SyncPooledWsPresentation();
    }

    private async Task<WsWebViewSessionRegistration> CreatePooledWsSessionAsync(string accountId, long generation, CancellationToken cancellationToken)
    {
        var view = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            IsHitTestVisible = false,
            Opacity = 0.01,
        };
        WsOverlayHost.Children.Add(view);
        try
        {
            var environment = await _wsProfiles.GetOrCreateProfileAsync(accountId);
            cancellationToken.ThrowIfCancellationRequested();
            await view.EnsureCoreWebView2Async(environment);
            cancellationToken.ThrowIfCancellationRequested();
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            void MessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
                => OnWsWebMessageReceived(accountId, generation, sender, args);
            void NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
                => OnWsNavigationStarting(sender, args);
            void NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs args)
                => OnWsNewWindowRequested(sender, args);
            var retriedAfterNavigationFailure = false;
            async void NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs navigation)
            {
                if (!App.WsSessions.IsCurrent(accountId, generation, view)) return;
                if (!navigation.IsSuccess)
                {
                    if (!retriedAfterNavigationFailure)
                    {
                        retriedAfterNavigationFailure = true;
                        try
                        {
                            await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage);
                            core.Navigate("https://web.whatsapp.com/");
                            return;
                        }
                        catch { }
                    }
                    App.WsRuntime.RecordFailure(accountId, $"navigation:{navigation.WebErrorStatus}");
                    await SetWsStatusAsync(accountId, "连接失败", CancellationToken.None);
                    return;
                }
                await ProbeWsLoginStateAsync(accountId, view, generation);
                if (_vipGroupAllowlistByAccount.TryGetValue(accountId, out var vipGroups))
                {
                    try { await core.ExecuteScriptAsync($"window.__zhikeWsConfigureVipGroups?.({JsonSerializer.Serialize(vipGroups)}); void 0;"); } catch { }
                }
            }
            core.WebMessageReceived += MessageReceived;
            core.NavigationStarting += NavigationStarting;
            core.NavigationCompleted += NavigationCompleted;
            core.NewWindowRequested += NewWindowRequested;
            await core.AddScriptToExecuteOnDocumentCreatedAsync("(()=>{const apply=()=>{if(document.documentElement)document.documentElement.style.zoom='80%';};apply();document.addEventListener('DOMContentLoaded',apply,{once:true});})();");
            await core.AddScriptToExecuteOnDocumentCreatedAsync(BuildWsCollectorScript(accountId));
            return new WsWebViewSessionRegistration(view, released =>
            {
                try
                {
                    if (released.CoreWebView2 is not null)
                    {
                        released.CoreWebView2.WebMessageReceived -= MessageReceived;
                        released.CoreWebView2.NavigationStarting -= NavigationStarting;
                        released.CoreWebView2.NavigationCompleted -= NavigationCompleted;
                        released.CoreWebView2.NewWindowRequested -= NewWindowRequested;
                        try { _ = released.CoreWebView2.ExecuteScriptAsync("window.__zhikeStopCapture?.(); void 0;"); } catch { }
                        try { released.CoreWebView2.Navigate("about:blank"); } catch { }
                    }
                }
                finally
                {
                    if (released.Parent is Panel parent) parent.Children.Remove(released);
                    try { released.Close(); } catch { }
                }
            });
        }
        catch
        {
            WsOverlayHost.Children.Remove(view);
            try { view.Close(); } catch { }
            throw;
        }
    }

    private static void OnWsNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (sender is not CoreWebView2 core || !IsAllowedWsPopupNavigation(args.Uri)) return;
        try { core.Navigate(args.Uri); } catch { }
    }

    private static bool IsAllowedWsPopupNavigation(string? uriText)
    {
        if (!Uri.TryCreate(uriText, UriKind.Absolute, out var uri)) return false;
        return string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, "web.whatsapp.com", StringComparison.OrdinalIgnoreCase);
    }

    private async Task HeartbeatPooledWsSessionAsync(WsWebViewSession session, bool driveCollection, CancellationToken cancellationToken)
    {
        var view = session.View;
        if (view.CoreWebView2 is null || !App.WsSessions.IsCurrent(session.AccountId, session.Generation, view)) return;
        await ProbeWsLoginStateAsync(session.AccountId, view, session.Generation, cancellationToken);
        var script = driveCollection
            ? "(() => { const tick=window.__zhikeWsBackgroundTick?.()||{supported:false}; const discovery=window.__zhikeWsDiscoverAll?.(); const history=window.__zhikeWsCollectAllRead?.(); return {...tick,discoveryRequested:Boolean(discovery),historyRequested:Boolean(history)}; })()"
            : "(() => window.__zhikeWsBackgroundTick?.() || {supported:false,listReady:false,advanced:0,queuedTasks:0})()";
        var heartbeatJson = await view.CoreWebView2.ExecuteScriptAsync(script);
        cancellationToken.ThrowIfCancellationRequested();
        using var heartbeatDocument = JsonDocument.Parse(heartbeatJson);
        var heartbeat = heartbeatDocument.RootElement;
        await WsCollectorDiagnosticLog.WriteBackgroundHeartbeatAsync(
            GetBool(heartbeat, "listReady"), GetBool(heartbeat, "scanning"), GetBool(heartbeat, "allScanning"),
            GetBool(heartbeat, "retryScheduled"), GetBool(heartbeat, "highPriorityRetryPending"),
            GetInt(heartbeat, "advanced"), GetInt(heartbeat, "queuedTasks"), GetInt(heartbeat, "allRounds"),
            GetInt(heartbeat, "allSeen"), GetInt(heartbeat, "allScrollTop"), GetInt(heartbeat, "allMax"),
            GetInt(heartbeat, "allAgeMs"), GetInt(heartbeat, "allNoProgressMs"), DateTimeOffset.UtcNow);
        GetBridge().Publish("ws.background-tick", JsonSerializer.SerializeToElement(new
        {
            accountId = session.AccountId,
            status = "已连接",
            background = driveCollection,
            observedAt = DateTimeOffset.UtcNow,
        }));
    }

    private void SyncPooledWsPresentation()
    {
        var sessions = App.WsService.Sessions();
        var active = App.WsService.ActiveSession;
        // Even after the foreground account is explicitly closed, another
        // pooled account may still own a background collection lease. Keep one
        // surviving view as the non-interactive layout anchor so
        // HideWsOverlay can retain DOM geometry behind the main host instead
        // of collapsing the parent and starving that collector.
        var layoutAnchor = active ?? sessions.FirstOrDefault();
        if (layoutAnchor is not null)
        {
            _wsView = layoutAnchor.View;
            _wsViewAccountId = layoutAnchor.AccountId;
            Interlocked.Exchange(ref _wsGeneration, layoutAnchor.Generation);
        }
        else
        {
            _wsView = null;
            _wsViewAccountId = string.Empty;
        }
        foreach (var session in sessions)
        {
            if (session.View.Parent is Panel prior && !ReferenceEquals(prior, WsOverlayHost)) prior.Children.Remove(session.View);
            if (!WsOverlayHost.Children.Contains(session.View)) WsOverlayHost.Children.Add(session.View);
            var selected = active is not null && ReferenceEquals(active.View, session.View);
            session.View.Visibility = Visibility.Visible;
            session.View.Opacity = selected ? 1d : 0.01d;
            session.View.IsHitTestVisible = selected && _hostWindowRenderable && string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase);
            Canvas.SetZIndex(session.View, selected ? 20 : 0);
        }
    }

    private void AttachLegacyHandlers(CoreWebView2 core)
    {
        core.WebMessageReceived -= OnWebMessageReceived;
        core.WebMessageReceived += OnWebMessageReceived;
        core.NavigationStarting -= OnLegacyNavigationStarting;
        core.NavigationStarting += OnLegacyNavigationStarting;
        core.NewWindowRequested -= OnLegacyNewWindowRequested;
        core.NewWindowRequested += OnLegacyNewWindowRequested;
        core.NavigationCompleted -= OnLegacyNavigationCompleted;
        core.NavigationCompleted += OnLegacyNavigationCompleted;
        core.ProcessFailed -= OnLegacyProcessFailed;
        core.ProcessFailed += OnLegacyProcessFailed;
    }

    private static void OnLegacyNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        args.Cancel = !IsAllowedNavigation(args.Uri, "zhike.local");
    }

    private void OnLegacyNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        // The product has one in-app surface.  Same-origin links stay inside
        // that surface; everything else is explicitly blocked instead of
        // silently starting a browser or an older desktop client.
        args.Handled = true;
        if (sender is CoreWebView2 core && IsAllowedNavigation(args.Uri, "zhike.local"))
        {
            core.Navigate(args.Uri);
            return;
        }
        ShowStatus("知客已阻止页面打开外部窗口；WS 与业务操作请在当前工作台内完成。", InfoBarSeverity.Warning);
    }

    private static void OnWsNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        args.Cancel = !IsAllowedNavigation(args.Uri, "web.whatsapp.com");
    }

    private static bool IsAllowedNavigation(string? uriText, string host)
    {
        if (string.Equals(uriText, "about:blank", StringComparison.OrdinalIgnoreCase)) return true;
        if (!Uri.TryCreate(uriText, UriKind.Absolute, out var uri)) return false;
        return string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase);
    }

    private void OnLegacyNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            HostActions.Visibility = Visibility.Collapsed;
            return;
        }
        ShowStatus("知客页面加载失败，请点击重试；本机数据不会受影响。", InfoBarSeverity.Error);
        HostActions.Visibility = Visibility.Visible;
    }

    private void OnLegacyProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs args)
    {
        ShowStatus("知客页面进程异常，原有数据未受影响。请点击重试。", InfoBarSeverity.Error);
        HostActions.Visibility = Visibility.Visible;
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        var bridgeRequestId = string.Empty;
        var bridgeMethod = string.Empty;
        try
        {
            // WebView2 can surface a different managed wrapper for the same
            // native CoreWebView2 in event callbacks. This handler is attached
            // only to the legacy WebView and the source origin is validated
            // below, so reference equality can reject valid bridge requests.
            if (_webView?.CoreWebView2 is null) return;
            if (!IsAllowedNavigation(args.Source, "zhike.local"))
            {
                Debug.WriteLine("Desktop bridge message rejected: source origin is not allowed.");
                return;
            }
            var rawMessage = args.TryGetWebMessageAsString();
            if (rawMessage.Length > MaxBridgeMessageChars) return;
            using var document = JsonDocument.Parse(rawMessage);
            var root = document.RootElement;
            var messageType = root.TryGetProperty("type", out var type) ? type.GetString() : null;
            if (string.Equals(messageType, "zhike.ws.bounds", StringComparison.Ordinal))
            {
                if (!ApplyTrustedWsRouteVisibility(root)) return;
                ApplyWsBounds(root);
                return;
            }
            if (!string.Equals(messageType, "zhike.bridge.request", StringComparison.Ordinal)) return;
            var requestId = root.TryGetProperty("requestId", out var request) ? request.GetString() ?? string.Empty : string.Empty;
            var method = root.TryGetProperty("method", out var methodValue) ? methodValue.GetString() ?? string.Empty : string.Empty;
            bridgeRequestId = requestId;
            bridgeMethod = method;
            var bridgeVersion = StringValue(root, "bridgeVersion");
            using var emptyPayload = JsonDocument.Parse("{}");
            var payload = root.TryGetProperty("payload", out var payloadValue) ? payloadValue : emptyPayload.RootElement;
            if (requestId.Length > 128 || string.IsNullOrWhiteSpace(method) || method.Length > 128 || payload.GetRawText().Length > MaxBridgePayloadChars)
            {
                var invalid = BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "bridge request is invalid");
                sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "zhike.bridge.response",
                    requestId = invalid.RequestId,
                    bridgeVersion = invalid.BridgeVersion,
                    ok = invalid.Ok,
                    errorCode = invalid.ErrorCode,
                    message = invalid.Message,
                    data = invalid.Data,
                }));
                return;
            }
            var timeout = root.TryGetProperty("timeoutMs", out var timeoutValue) && timeoutValue.TryGetInt32(out var parsedTimeout) ? parsedTimeout : 15000;
            var accountId = root.TryGetProperty("accountId", out var account) ? account.GetString() : null;
            var bridge = GetBridge();
            BridgeResponse? response;
            if (!string.Equals(bridgeVersion, DesktopBridgeService.CurrentVersion, StringComparison.Ordinal))
            {
                response = BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED_VERSION", "desktop bridge version is not supported");
            }
            else
            {
                using var requestCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Clamp(timeout, 250, 300000)));
                try
                {
                    response = await HandleNativeBridgeAsync(requestId, method, payload, timeout, accountId, requestCts.Token)
                        .WaitAsync(requestCts.Token);
                }
                catch (OperationCanceledException)
                {
                    response = BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "desktop bridge request timed out");
                }
                if (response is null)
                {
                    try
                    {
                        response = await bridge.InvokeAsync(requestId, method, payload, timeout, accountId, bridgeVersion: bridgeVersion, cancellationToken: requestCts.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        response = BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "desktop bridge request timed out");
                    }
                }
            }
            var message = new
            {
                type = "zhike.bridge.response",
                requestId = response.RequestId,
                bridgeVersion = response.BridgeVersion,
                ok = response.Ok,
                errorCode = response.ErrorCode,
                message = response.Message,
                data = response.Data,
            };
            sender.PostWebMessageAsJson(JsonSerializer.Serialize(message));
        }
        catch (Exception error)
        {
            Debug.WriteLine($"Desktop bridge message failed: method={bridgeMethod}; error={error.GetType().Name}.");
            if (sender is null || string.IsNullOrWhiteSpace(bridgeRequestId)) return;
            try
            {
                var failure = BridgeResponse.Failure(bridgeRequestId, DesktopBridgeService.CurrentVersion, "BRIDGE_ERROR", "桌面操作未完成，请重试；本机数据未更改。");
                sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "zhike.bridge.response",
                    requestId = failure.RequestId,
                    bridgeVersion = failure.BridgeVersion,
                    ok = failure.Ok,
                    errorCode = failure.ErrorCode,
                    message = failure.Message,
                    data = failure.Data,
                }));
            }
            catch { }
        }
    }

    private DesktopBridgeService GetBridge()
    {
        _api ??= App.LocalService?.IsRunning == true ? App.LocalService.CreateApiClient() : null;
        if (_api is null) throw new InvalidOperationException("本机数据服务尚未就绪，请稍后重试。");
        // The local service can restart on a new port/token after a crash or
        // a transient startup race. Reusing the cached adapter in that case
        // sends WS/API calls to the dead HttpClient and surfaces only the
        // generic “WS 本机数据服务暂不可用” message. Rebind the bridge to the
        // current ApiClient whenever the service endpoint changes.
        if (_bridge is null || !ReferenceEquals(_bridgeApi, _api))
        {
            if (_bridge is not null) _bridge.EventPublished -= OnBridgeEventPublished;
            _bridgeApi = _api;
            _bridge = new DesktopBridgeService(new LegacyApiAdapter(_api));
        }
        _bridge.EventPublished -= OnBridgeEventPublished;
        _bridge.EventPublished += OnBridgeEventPublished;
        return _bridge;
    }

    private void OnBridgeEventPublished(object? sender, BridgeEvent eventData)
    {
        if (_webView?.CoreWebView2 is null) return;
        var message = new
        {
            type = "zhike.bridge.event",
            name = eventData.Name,
            payload = eventData.Payload,
            publishedAt = eventData.PublishedAt,
        };
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            try { _webView?.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message)); }
            catch { }
        });
    }

    private async Task<BridgeResponse?> HandleNativeBridgeAsync(
        string requestId,
        string method,
        JsonElement payload,
        int timeout,
        string? accountId,
        CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            return method switch
            {
                "ws.accounts" => await HandleWsAccountsAsync(requestId, payload, cancellationToken),
                "legacy.api" => await HandleLegacyApiAsync(requestId, payload, cancellationToken),
                "ws" => await HandleWsActionAsync(requestId, payload, accountId, cancellationToken),
                "tools" => await HandleToolsAsync(requestId, payload, cancellationToken),
                "ai" => await HandleAiBridgeAsync(requestId, "request", payload, timeout, cancellationToken),
                _ when method.StartsWith("ws.", StringComparison.OrdinalIgnoreCase) => await HandleWsActionAsync(requestId, WithAction(payload, method[3..]), accountId, cancellationToken),
                _ when method.StartsWith("tools.", StringComparison.OrdinalIgnoreCase) => await HandleToolsAsync(requestId, WithAction(payload, method[6..]), cancellationToken),
                _ when method.StartsWith("ai.", StringComparison.OrdinalIgnoreCase) => await HandleAiBridgeAsync(requestId, method[3..], payload, timeout, cancellationToken),
                _ => null,
            };
        }
        catch (OperationCanceledException)
        {
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "desktop bridge request timed out");
        }
        catch
        {
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "BRIDGE_ERROR", "desktop WS operation failed");
        }
    }

    private async Task<BridgeResponse> HandleLegacyApiAsync(string requestId, JsonElement payload, CancellationToken cancellationToken)
    {
        // Route all legacy fetch calls through the same adapter used by the
        // central desktop bridge. The adapter forwards browser paths to the
        // bundled loopback SQLite service so the legacy UI and WS collector
        // share one transaction boundary.
        var result = await GetBridge().InvokeAsync(
            requestId,
            "legacy.api",
            payload,
            timeoutMs: 300000,
            bridgeVersion: DesktopBridgeService.CurrentVersion,
            cancellationToken: cancellationToken);
        var requestMethod = StringValue(payload, "method");
        var requestHeaders = payload.TryGetProperty("headers", out var requestHeadersValue)
            && requestHeadersValue.ValueKind == JsonValueKind.Object
            ? requestHeadersValue.EnumerateObject().ToDictionary(item => item.Name, item => item.Value.ToString(), StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var retrySafe = requestMethod.Equals("GET", StringComparison.OrdinalIgnoreCase)
            || requestMethod.Equals("HEAD", StringComparison.OrdinalIgnoreCase)
            || requestHeaders.ContainsKey("x-idempotency-key");
        if (retrySafe && !result.Ok && string.Equals(result.ErrorCode, "SERVICE_UNAVAILABLE", StringComparison.OrdinalIgnoreCase))
        {
            // Recover a sidecar that exited or changed its loopback endpoint,
            // then retry the same read/idempotent bridge request once. This keeps
            // WS account/list requests usable without forcing the user to
            // reload the entire workbench.
            try
            {
                await App.RecoverLocalServiceAsync(cancellationToken);
                _api = App.LocalService?.CreateApiClient();
                _bridge = null;
                _bridgeApi = null;
                result = await GetBridge().InvokeAsync(
                    requestId,
                    "legacy.api",
                    payload,
                    timeoutMs: 300000,
                    bridgeVersion: DesktopBridgeService.CurrentVersion,
                    cancellationToken: cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch { /* return the original actionable service error */ }
        }
        return result;
    }

    private async Task<BridgeResponse> HandleToolsAsync(string requestId, JsonElement payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var action = StringValue(payload, "action");
        if (string.Equals(action, "status", StringComparison.OrdinalIgnoreCase))
        {
            var config = await _desktopTools.GetStatusAsync(cancellationToken);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { supported = true, directory = config.Directory, minutes = config.Minutes, keep = config.Keep, enabled = config.Enabled, lastAt = config.LastAt, lastError = config.LastError }));
        }
        if (string.Equals(action, "notify", StringComparison.OrdinalIgnoreCase))
        {
            var result = _desktopTools.Notify(StringValue(payload, "id"), StringValue(payload, "body"));
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { supported = result.Supported, reason = result.Reason }));
        }
        if (string.Equals(action, "directory", StringComparison.OrdinalIgnoreCase))
        {
            if (App.MainWindowInstance is null)
                return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "WINDOW_UNAVAILABLE", "当前窗口不可用，请稍后重试。");
            var config = await _desktopTools.SelectDirectoryAsync(App.MainWindowInstance, cancellationToken);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { directory = config.Directory }));
        }
        if (string.Equals(action, "configure", StringComparison.OrdinalIgnoreCase))
        {
            var minutes = int.TryParse(StringValue(payload, "minutes"), out var parsedMinutes) ? parsedMinutes : 60;
            var keep = int.TryParse(StringValue(payload, "keep"), out var parsedKeep) ? parsedKeep : 10;
            var config = await _desktopTools.ConfigureAsync(minutes, keep, GetBool(payload, "enabled"), cancellationToken);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { directory = config.Directory, minutes = config.Minutes, keep = config.Keep, enabled = config.Enabled }));
        }
        if (string.Equals(action, "backup", StringComparison.OrdinalIgnoreCase))
        {
            _api ??= App.LocalService?.CreateApiClient();
            if (_api is null)
                return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "SERVICE_UNAVAILABLE", "本机数据服务不可用，未生成备份。");
            var result = await _desktopTools.CreateBackupAsync(_api, _activeWsAccountId, cancellationToken);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { skipped = result.Skipped, path = result.Path, createdAt = result.CreatedAt, bytes = result.Bytes, reason = result.Reason }));
        }
        if (!string.Equals(action, "copy", StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", $"unsupported tools action: {action}");
        var value = StringValue(payload, "text");
        if (string.IsNullOrWhiteSpace(value))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "copy text is required");
        cancellationToken.ThrowIfCancellationRequested();
        var package = new DataPackage();
        package.SetText(value);
        Clipboard.SetContent(package);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { copied = true }));
    }

    private async Task<BridgeResponse> HandleAiBridgeAsync(string requestId, string action, JsonElement payload, int timeoutMs, CancellationToken cancellationToken)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Math.Clamp(timeoutMs, 250, 120000));
            var result = await _ai.InvokeAsync(action, payload, timeout.Token);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, result);
        }
        catch (OperationCanceledException)
        {
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "AI 请求超时或已取消，请重试。" );
        }
        catch (Exception error)
        {
            var message = error.Message.Contains("Key", StringComparison.OrdinalIgnoreCase) || error.Message.Contains("API", StringComparison.OrdinalIgnoreCase) || error.Message.Contains("请求失败", StringComparison.OrdinalIgnoreCase) || error.Message.Contains("额度", StringComparison.OrdinalIgnoreCase) || error.Message.Contains("不可用", StringComparison.OrdinalIgnoreCase)
                ? error.Message
                : "AI 服务暂时不可用，请检查配置或网络后重试。";
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "AI_ERROR", message);
        }
    }

    private static JsonElement WithAction(JsonElement payload, string action)
    {
        var map = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        if (payload.ValueKind == JsonValueKind.Object)
            foreach (var property in payload.EnumerateObject()) map[property.Name] = property.Value.Clone();
        map["action"] = JsonSerializer.SerializeToElement(action);
        return JsonSerializer.SerializeToElement(map);
    }

    private async Task<BridgeResponse> HandleWsAccountsAsync(string requestId, JsonElement payload, CancellationToken cancellationToken)
    {
        var action = StringValue(payload, "action").ToLowerInvariant();
        var accounts = await LoadWsAccountsAsync(cancellationToken);
        if (action == "list" || string.IsNullOrWhiteSpace(action))
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accounts = accounts.Select(ToWsAccountDto).ToArray() }));
        if (action != "create")
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", $"unsupported WS account action: {action}");

        if (!payload.TryGetProperty("account", out var accountValue) || accountValue.ValueKind != JsonValueKind.Object)
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "account is required");
        var id = StringValue(accountValue, "id");
        var displayName = StringValue(accountValue, "displayName");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(displayName))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "account id and display name are required");
        if (id.Length > 96 || displayName.Length > 80)
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "account field is too long");
        var existing = accounts.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { account = existing }));
        var created = new StoredWsAccount(id, displayName, "未连接");
        cancellationToken.ThrowIfCancellationRequested();
        await _wsAccountStore.SaveAsync(accounts.Append(created), cancellationToken);
        if (_api is not null)
        {
            try { await _api.UpsertWsAccountAsync(new WsAccountRequest(created.Id, created.DisplayName, created.Status), cancellationToken); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch { /* local index remains usable; sync will retry on next list */ }
        }
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { account = ToWsAccountDto(created) }));
    }

    private async Task<BridgeResponse> HandleWsActionAsync(string requestId, JsonElement payload, string? requestAccountId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var action = StringValue(payload, "action").ToLowerInvariant();
        var id = StringValue(payload, "accountId");
        if (string.IsNullOrWhiteSpace(id)) id = requestAccountId ?? _activeWsAccountId;
        if (string.IsNullOrWhiteSpace(id)) id = "default";
        _activeWsAccountId = id;
        switch (action)
        {
            case "open":
                await OpenWsOverlayAsync(id, payload, cancellationToken: cancellationToken);
                return await WsStatusResponseAsync(requestId, id, cancellationToken);
            case "resize":
                ApplyWsBounds(payload);
                // Resize is called from ResizeObserver while the user is
                // scrolling or the layout is settling.  Do not probe the
                // entire WhatsApp DOM here: ExecuteScriptAsync on every
                // bounds update serializes with WebView2 and causes visible
                // frame drops.  The explicit status/probe actions remain the
                // single source of truth for login detection.
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion,
                    JsonSerializer.SerializeToElement(new { accountId = id, status = _wsView?.CoreWebView2 is not null ? "已连接" : "未连接" }));
            case "hide":
                App.WsService.HideForeground();
                HideWsOverlay();
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "已连接" }));
            case "close":
                await CloseWsOverlayAsync(false, id, cancellationToken);
                await SetWsStatusAsync(id, "未连接", cancellationToken);
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "未连接" }));
            case "clear-session":
                var cleared = await CloseWsOverlayAsync(true, id, cancellationToken);
                if (!cleared)
                    return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "PROFILE_CLEAR_FAILED", "WS 会话仍被系统占用，未能清除本地会话；请关闭其他 WS 窗口后重试。");
                await SetWsStatusAsync(id, "未连接", cancellationToken);
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "未连接" }));
            case "reconnect":
                await OpenWsOverlayAsync(id, payload, reload: true, cancellationToken: cancellationToken);
                return await WsStatusResponseAsync(requestId, id, cancellationToken);
            case "status":
            case "probe":
                return await WsStatusResponseAsync(requestId, id, cancellationToken);
            case "configure-vip-groups":
                return await ConfigureVipGroupsAsync(requestId, id, payload, cancellationToken);
            case "discover-conversations":
                return await ExecuteWsCaptureAsync(requestId, id, "discover", cancellationToken);
            case "collect-all-read":
                return await ExecuteWsCaptureAsync(requestId, id, "collect-all-read", cancellationToken);
            case "capture-visible-messages":
            case "capture-selection":
                return await ExecuteWsCaptureAsync(requestId, id, "messages", cancellationToken);
            default:
                return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", $"unsupported WS action: {action}");
        }
    }

    private async Task<BridgeResponse> ConfigureVipGroupsAsync(string requestId, string accountId, JsonElement payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var values = new List<string>();
        if (payload.TryGetProperty("vipGroups", out var groups) && groups.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in groups.EnumerateArray())
            {
                if (values.Count >= 500) break;
                var value = item.ValueKind == JsonValueKind.String ? item.GetString() : null;
                value = value?.Trim();
                if (!string.IsNullOrWhiteSpace(value) && value.Length <= 240) values.Add(value);
            }
        }
        var normalized = values.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        _vipGroupAllowlistByAccount[accountId] = normalized;
        if (App.WsService.TryGetSession(accountId, out var session) && session?.View.CoreWebView2 is not null)
            await session.View.CoreWebView2.ExecuteScriptAsync($"window.__zhikeWsConfigureVipGroups?.({JsonSerializer.Serialize(normalized)}); void 0;");
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion,
            JsonSerializer.SerializeToElement(new { accountId, accepted = normalized.Length }));
    }

    private async Task<List<StoredWsAccount>> LoadWsAccountsAsync(CancellationToken cancellationToken = default)
    {
        var local = (await _wsAccountStore.LoadAsync(cancellationToken)).ToList();
        if (local.Count == 0)
        {
            // The default row is a configuration anchor, not demo business
            // data. It keeps the original page from rendering an empty
            // account rail on first launch.
            local.Add(new StoredWsAccount("default", "默认账号", "未连接"));
            await _wsAccountStore.SaveAsync(local, cancellationToken);
        }
        if (_api is null)
        {
            App.WsRuntime.RegisterAccounts(local);
            return local;
        }
        try
        {
            var remote = await _api.GetWsAccountsAsync(cancellationToken);
            if (remote is null) return local;
            foreach (var item in remote)
            {
                var existing = local.FirstOrDefault(row => string.Equals(row.Id, item.Id, StringComparison.OrdinalIgnoreCase));
                var normalized = new StoredWsAccount(item.Id, item.DisplayName, string.IsNullOrWhiteSpace(item.RuntimeStatus) ? item.Status : item.RuntimeStatus!, item.LastSeen, item.LastKnownStatus);
                if (existing is null) local.Add(normalized);
                else
                {
                    var index = local.IndexOf(existing);
                    local[index] = existing with
                    {
                        DisplayName = string.IsNullOrWhiteSpace(normalized.DisplayName) ? existing.DisplayName : normalized.DisplayName,
                        Status = string.IsNullOrWhiteSpace(normalized.Status) ? existing.Status : normalized.Status,
                        LastSeen = normalized.LastSeen ?? existing.LastSeen,
                        LastKnownStatus = string.IsNullOrWhiteSpace(normalized.LastKnownStatus) ? existing.LastKnownStatus : normalized.LastKnownStatus,
                    };
                }
            }
            await _wsAccountStore.SaveAsync(local, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { /* local account index is the offline fallback */ }
        App.WsRuntime.RegisterAccounts(local);
        return local;
    }

    private static object ToWsAccountDto(StoredWsAccount account)
        => new { id = account.Id, displayName = account.DisplayName, status = account.Status, runtimeStatus = account.Status, lastSeen = account.LastSeen, lastKnownStatus = account.LastKnownStatus };

    private async Task OpenWsOverlayAsync(string accountId, JsonElement payload, bool reload = false, CancellationToken cancellationToken = default)
    {
        await _wsGate.WaitAsync(cancellationToken);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            BindWsRuntime();
            var acquired = await App.WsService.ShowAccountAsync(accountId, cancellationToken);
            _activeWsAccountId = accountId;
            SyncPooledWsPresentation();
            if (reload && acquired.Session.View.CoreWebView2 is not null) acquired.Session.View.CoreWebView2.Reload();
            ApplyWsBounds(payload);
            RequestWsOverlayResize();
            if (acquired.Created) await SetWsStatusAsync(accountId, "连接中", cancellationToken);
        }
        finally { _wsGate.Release(); }
    }

    private async Task<bool> CloseWsOverlayAsync(bool clearProfile, string? profileAccountId = null, CancellationToken cancellationToken = default)
    {
        await _wsGate.WaitAsync(cancellationToken);
        try
        {
            return await CloseWsOverlayCoreAsync(clearProfile, profileAccountId, cancellationToken);
        }
        finally { _wsGate.Release(); }
    }

    private async Task<bool> CloseWsOverlayCoreAsync(bool clearProfile, string? profileAccountId, CancellationToken cancellationToken)
    {
        var accountId = string.IsNullOrWhiteSpace(profileAccountId) ? _activeWsAccountId : profileAccountId;
        if (string.IsNullOrWhiteSpace(accountId)) accountId = "default";
        await App.WsService.CloseAccountAsync(accountId, cancellationToken);
        if (string.Equals(_wsViewAccountId, accountId, StringComparison.OrdinalIgnoreCase))
        {
            _wsView = null;
            _wsViewAccountId = "";
            Interlocked.Increment(ref _wsGeneration);
        }
        SyncPooledWsPresentation();
        HideWsOverlay();
        if (clearProfile)
        {
            await Task.Delay(100, cancellationToken);
            return await _wsProfiles.ClearProfileAsync(accountId);
        }
        return true;
    }

    private void HideWsOverlay()
    {
        WsOverlayLayer.IsHitTestVisible = false;
        if (_wsView?.CoreWebView2 is null)
        {
            WsOverlayLayer.Visibility = Visibility.Collapsed;
            return;
        }
        // Collapsing the parent also collapses WebView2's viewport. WhatsApp
        // then has no rendered list geometry and a background retry cannot
        // discover or open the next conversation even though JS still runs.
        // Keep the isolated view laid out behind the legacy host instead: it
        // cannot receive input or take focus, but its collector can continue.
        // Opening can finish after the user has already left the WS route.
        // In that case no visible bounds have ever been applied to the view.
        if (!double.IsFinite(WsOverlayBorder.Width) || WsOverlayBorder.Width < 40d)
            WsOverlayBorder.Width = Math.Clamp(WebViewHost.ActualWidth, 820d, 1440d);
        if (!double.IsFinite(WsOverlayBorder.Height) || WsOverlayBorder.Height < 40d)
            WsOverlayBorder.Height = Math.Clamp(WebViewHost.ActualHeight, 540d, 900d);
        Canvas.SetZIndex(WsOverlayLayer, -1);
        WsOverlayLayer.Visibility = Visibility.Visible;
    }

    private bool ApplyTrustedWsRouteVisibility(JsonElement payload)
    {
        if (!string.Equals(StringValue(payload, "route"), "ws-workbench", StringComparison.OrdinalIgnoreCase)) return false;
        var documentId = StringValue(payload, "documentId");
        var sequence = GetLong(payload, "sequence");
        if (string.IsNullOrWhiteSpace(documentId) || sequence <= 0) return false;
        if (!string.Equals(documentId, _wsBoundsDocumentId, StringComparison.Ordinal))
        {
            _wsBoundsDocumentId = documentId;
            _lastWsBoundsSequence = 0;
        }
        if (sequence <= _lastWsBoundsSequence) return false;
        _lastWsBoundsSequence = sequence;

        var routeVisible = payload.TryGetProperty("routeVisible", out var visibleValue)
            && visibleValue.ValueKind is JsonValueKind.True or JsonValueKind.False
            && visibleValue.GetBoolean();
        if (routeVisible)
        {
            if (!string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
            {
                _currentRoute = "ws-workbench";
                Interlocked.Increment(ref _routeGeneration);
            }
            return true;
        }

        if (string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
        {
            _currentRoute = "legacy-background";
            Interlocked.Increment(ref _routeGeneration);
        }
        HideWsOverlay();
        return false;
    }

    private void ApplyWsBounds(JsonElement payload)
    {
        if (!_hostWindowRenderable
            || !string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase)
            || _wsView?.CoreWebView2 is null)
        {
            HideWsOverlay();
            return;
        }
        if (!payload.TryGetProperty("bounds", out var bounds) || bounds.ValueKind != JsonValueKind.Object)
        {
            HideWsOverlay();
            return;
        }
        if (GetBool(bounds, "hidden"))
        {
            HideWsOverlay();
            return;
        }
        var hostWidth = Math.Max(0d, WebViewHost.ActualWidth);
        var hostHeight = Math.Max(0d, WebViewHost.ActualHeight);
        if (hostWidth < 40 || hostHeight < 40)
        {
            HideWsOverlay();
            return;
        }
        var viewportWidth = GetDouble(bounds, "viewportWidth");
        var viewportHeight = GetDouble(bounds, "viewportHeight");
        var scaleX = viewportWidth > 0 ? hostWidth / viewportWidth : 1d;
        var scaleY = viewportHeight > 0 ? hostHeight / viewportHeight : 1d;
        if (!double.IsFinite(scaleX) || scaleX is < 0.25d or > 4d) scaleX = 1d;
        if (!double.IsFinite(scaleY) || scaleY is < 0.25d or > 4d) scaleY = 1d;
        var rawLeft = GetDouble(bounds, "x") * scaleX;
        var rawTop = GetDouble(bounds, "y") * scaleY;
        var rawRight = rawLeft + GetDouble(bounds, "width") * scaleX;
        var rawBottom = rawTop + GetDouble(bounds, "height") * scaleY;
        var x = Math.Clamp(rawLeft, 0d, hostWidth);
        var y = Math.Clamp(rawTop, 0d, hostHeight);
        var right = Math.Clamp(rawRight, 0d, hostWidth);
        var bottom = Math.Clamp(rawBottom, 0d, hostHeight);
        if (right - x < 40d || bottom - y < 40d)
        {
            HideWsOverlay();
            return;
        }
        var rasterScale = Math.Max(0.1d, WebViewHost.XamlRoot?.RasterizationScale ?? 1d);
        x = SnapToRaster(x, rasterScale);
        y = SnapToRaster(y, rasterScale);
        var width = SnapToRaster(right - x, rasterScale);
        var height = SnapToRaster(bottom - y, rasterScale);
        WsOverlayBorder.Width = width;
        WsOverlayBorder.Height = height;
        Canvas.SetLeft(WsOverlayBorder, x);
        Canvas.SetTop(WsOverlayBorder, y);
        Canvas.SetZIndex(WsOverlayLayer, 20);
        WsOverlayLayer.Visibility = Visibility.Visible;
        WsOverlayLayer.IsHitTestVisible = true;
    }

    private async Task ResizeWsOverlayFromDomAsync()
    {
        if (_webView?.CoreWebView2 is null || _wsView?.CoreWebView2 is null
            || !_hostWindowRenderable
            || !string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
            return;
        if (Interlocked.Exchange(ref _wsBoundsRefreshInFlight, 1) != 0) return;
        var routeGeneration = Volatile.Read(ref _routeGeneration);
        var wsGeneration = Volatile.Read(ref _wsGeneration);
        try
        {
            var json = await _webView.CoreWebView2.ExecuteScriptAsync("(() => { const n=document.querySelector('#wsBrowserHost'); const vw=window.innerWidth||document.documentElement?.clientWidth||0, vh=window.innerHeight||document.documentElement?.clientHeight||0; if(!n) return {hidden:true,viewportWidth:vw,viewportHeight:vh}; const r=n.getBoundingClientRect(), s=getComputedStyle(n); return {hidden:s.display==='none'||s.visibility==='hidden'||r.width<40||r.height<40,x:r.left,y:r.top,width:r.width,height:r.height,viewportWidth:vw,viewportHeight:vh}; })()");
            if (routeGeneration != Volatile.Read(ref _routeGeneration)
                || wsGeneration != Volatile.Read(ref _wsGeneration)
                || !_hostWindowRenderable
                || !string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
                return;
            using var document = JsonDocument.Parse(json);
            var payload = JsonSerializer.SerializeToElement(new { bounds = document.RootElement });
            ApplyWsBounds(payload);
        }
        catch { }
        finally { Interlocked.Exchange(ref _wsBoundsRefreshInFlight, 0); }
    }

    private static double SnapToRaster(double value, double rasterScale)
        => Math.Round(value * rasterScale) / rasterScale;

    private async Task<BridgeResponse> WsStatusResponseAsync(string requestId, string accountId, CancellationToken cancellationToken = default)
    {
        App.WsService.TryGetSession(accountId, out var session);
        var status = await ProbeWsLoginStateAsync(accountId, session?.View, session?.Generation ?? 0, cancellationToken);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId, status.status, detail = status.detail }));
    }

    private async Task<(string status, string detail)> ProbeWsLoginStateAsync(string accountId, WebView2? view, long generation, CancellationToken cancellationToken = default)
    {
        if (view?.CoreWebView2 is null) return ("未连接", "WS 页面尚未打开。");
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var json = await view.CoreWebView2.ExecuteScriptAsync("(() => { const body=document.body; const text=(body?.innerText||'').slice(0,6000); const login=!!document.querySelector('[data-testid=\\\"qrcode\\\"], canvas[aria-label*=\\\"QR\\\" i], [data-ref]'); const chat=!!document.querySelector('#pane-side') || (!!document.querySelector('[data-testid=\\\"chat-list\\\"], [aria-label=\\\"Chat list\\\"], [aria-label=\\\"聊天列表\\\"], [role=\\\"grid\\\"]') && !!document.querySelector('[data-testid=\\\"search-input\\\"], [contenteditable=\\\"true\\\"], [role=\\\"textbox\\\"]')); const problem=/此页面存在问题|page has a problem|update your browser|更新浏览器/i.test(text); return JSON.stringify({login,chat,problem,text:text.slice(0,2000)}); })()");
            cancellationToken.ThrowIfCancellationRequested();
            var probeText = JsonSerializer.Deserialize<string>(json) ?? "{}";
            using var probe = JsonDocument.Parse(probeText);
            var root = probe.RootElement;
            var login = root.TryGetProperty("login", out var loginValue) && loginValue.ValueKind == JsonValueKind.True;
            var chat = root.TryGetProperty("chat", out var chatValue) && chatValue.ValueKind == JsonValueKind.True;
            var problem = root.TryGetProperty("problem", out var problemValue) && problemValue.ValueKind == JsonValueKind.True;
            var text = root.TryGetProperty("text", out var textValue) ? textValue.ToString() : string.Empty;
            var status = problem ? "连接失败" : chat ? "已连接" : login || text.Contains("Scan to log in", StringComparison.OrdinalIgnoreCase) || text.Contains("扫码", StringComparison.OrdinalIgnoreCase) ? "等待登录" : "连接中";
            var detail = status == "已连接" ? "已检测到 WS 主界面。" : status == "连接失败" ? "WS 页面提示浏览器或页面异常，请刷新后重试。" : "请在 WS 页面自行扫码或登录。";
            if (App.WsSessions.IsCurrent(accountId, generation, view))
            {
                await SetWsStatusAsync(accountId, status, cancellationToken);
                GetBridge().Publish("ws.status", JsonSerializer.SerializeToElement(new { accountId, status, detail }));
            }
            return (status, detail);
        }
        catch
        {
            return ("连接失败", "WS 页面状态检测失败，请重试。");
        }
    }

    private async Task SetWsStatusAsync(string accountId, string status, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var rows = await _wsAccountStore.LoadAsync(cancellationToken);
        var existing = rows.FirstOrDefault(item => string.Equals(item.Id, accountId, StringComparison.OrdinalIgnoreCase));
        if (existing is null) return;
        App.WsRuntime.RegisterAccount(accountId, existing.DisplayName, WsRuntimeCoordinator.FromDisplayStatus(status));
        App.WsRuntime.UpdateConnectionState(accountId, WsRuntimeCoordinator.FromDisplayStatus(status));
        await _wsAccountStore.SaveAsync(rows.Select(item => item.Id.Equals(accountId, StringComparison.OrdinalIgnoreCase) ? item with { Status = status, LastKnownStatus = status == "未连接" ? item.LastKnownStatus : status, LastSeen = status == "已连接" ? DateTimeOffset.UtcNow : item.LastSeen } : item), cancellationToken);
        if (_api is not null)
        {
            try { await _api.UpdateWsAccountStatusAsync(accountId, status, cancellationToken); } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; } catch { }
        }
    }

    private async Task<BridgeResponse> ExecuteWsCaptureAsync(string requestId, string accountId, string kind, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!App.WsService.TryGetSession(accountId, out var session) || session?.View.CoreWebView2 is null)
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "NOT_CONNECTED", "WS 页面尚未打开。");
        // ExecuteScriptAsync serializes the immediate return value.  Keep the
        // collector contract synchronous at this boundary, but normalize
        // missing functions, undefined results and thrown DOM errors into a
        // structured payload instead of allowing an empty/invalid JSON result
        // to look like a successful scan with zero rows.
        var script = kind switch
        {
            "discover" => "(() => { try { const fn = window.__zhikeWsDiscoverAll || window.__zhikeWsDiscover; if (typeof fn !== 'function') return JSON.stringify({supported:false,error:'当前 WS 页面结构未识别'}); const value = fn(); if (value && typeof value.then === 'function') return JSON.stringify({supported:false,error:'WS 采集器仍在初始化，请稍后重试'}); return JSON.stringify(value || {supported:false,error:'WS 页面未返回采集结果'}); } catch (error) { return JSON.stringify({supported:false,error:String(error?.message || error || 'WS 列表采集失败')}); } })()",
            "collect-all-read" => "(() => { try { const fn = window.__zhikeWsCollectAllRead; if (typeof fn !== 'function') return JSON.stringify({supported:false,error:'当前 WS 页面结构未识别'}); return JSON.stringify(fn() || {supported:false,error:'WS 已读会话采集器未返回结果'}); } catch (error) { return JSON.stringify({supported:false,error:String(error?.message || error || 'WS 已读会话自动采集失败')}); } })()",
            _ => "(() => { try { const fn = window.__zhikeWsCapture; if (typeof fn !== 'function') return JSON.stringify({supported:false,error:'当前 WS 页面结构未识别'}); const value = fn(); if (value && typeof value.then === 'function') return JSON.stringify({supported:false,error:'WS 采集器仍在初始化，请稍后重试'}); return JSON.stringify(value || {supported:false,error:'WS 页面未返回采集结果'}); } catch (error) { return JSON.stringify({supported:false,error:String(error?.message || error || 'WS 消息采集失败')}); } })()",
        };
        var json = await session.View.CoreWebView2.ExecuteScriptAsync(script);
        cancellationToken.ThrowIfCancellationRequested();
        // WebView2 returns the JSON-encoded result of ExecuteScriptAsync. The
        // collector intentionally calls JSON.stringify so both branches have
        // the same shape, which means the first parse can be a JSON string.
        // Unwrap that layer before handing the payload to the page bridge;
        // otherwise `visible.supported`/`messages` are silently unavailable.
        var payload = ParseWebViewJsonResult(json);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, payload);
    }

    private static JsonElement ParseWebViewJsonResult(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.String)
            {
                var nested = root.GetString();
                if (!string.IsNullOrWhiteSpace(nested))
                {
                    using var nestedDocument = JsonDocument.Parse(nested);
                    return nestedDocument.RootElement.Clone();
                }
            }
            return root.Clone();
        }
        catch (JsonException)
        {
            return JsonSerializer.SerializeToElement(new { supported = false, error = "WS 页面返回了无法识别的采集结果。" });
        }
    }

    private void OnWsWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
        => OnWsWebMessageReceived(_wsViewAccountId, _wsGeneration, sender, args);

    private async void OnWsWebMessageReceived(string sessionAccountId, long sessionGeneration, CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        await _wsMessageGate.WaitAsync();
        try
        {
            // This handler is attached only to the isolated WhatsApp WebView.
            // WebView2 may surface a different managed wrapper for the same
            // native CoreWebView2 in callbacks, so reference equality can drop
            // valid full-history packets while synchronous list discovery
            // continues to work.  Trust the handler attachment and validate
            // the source origin plus the claimed isolated account below.
            if (!App.WsSessions.IsCurrent(sessionAccountId, sessionGeneration)) return;
            if (!IsAllowedNavigation(args.Source, "web.whatsapp.com")) return;
            var rawMessage = args.TryGetWebMessageAsString();
            if (rawMessage.Length > 1_200_000) return;
            using var document = JsonDocument.Parse(rawMessage);
            var root = document.RootElement;
            if (!string.Equals(StringValue(root, "type"), "zhike.ws.capture", StringComparison.Ordinal)) return;
            var claimedAccountId = StringValue(root, "accountId");
            var accountId = sessionAccountId;
            if (string.IsNullOrWhiteSpace(accountId) || (!string.IsNullOrWhiteSpace(claimedAccountId) && !string.Equals(claimedAccountId, accountId, StringComparison.Ordinal))) return;
            var capturedAt = DateTimeOffset.TryParse(StringValue(root, "capturedAt"), out var parsedCaptured) ? parsedCaptured : DateTimeOffset.UtcNow;
            var eventName = StringValue(root, "eventName");
            if (!string.IsNullOrWhiteSpace(eventName))
            {
                if (string.Equals(eventName, "direction-unresolved-structure", StringComparison.Ordinal))
                {
                    if (root.TryGetProperty("directionSignals", out var directionSignals))
                        await WsCollectorDiagnosticLog.WriteDirectionStructureAsync(directionSignals, capturedAt);
                    return;
                }
                await WsCollectorDiagnosticLog.WriteAsync(
                    eventName,
                    StringValue(root, "coverage"),
                    StringValue(root, "reason"),
                    GetInt(root, "discovered"),
                    GetInt(root, "processed"),
                    GetInt(root, "attempted"),
                    GetInt(root, "retryable"),
                    GetInt(root, "skippedUnreadCount"),
                    GetInt(root, "rowCount"),
                    GetInt(root, "readCount"),
                    GetInt(root, "skipCount"),
                    GetInt(root, "pendingCount"),
                    GetInt(root, "domNodeKnownCount"),
                    capturedAt);
                // Per-window/attempt events are diagnostics, not product
                // notifications. Broadcasting them caused the workbench to
                // refresh continuously and exposed implementation event names
                // in the main status bar.
                if (eventName is "collection-window" or "collection-attempt" or "collection-run-finish") return;
                var isComplete = string.Equals(eventName, "collection-complete", StringComparison.Ordinal);
                var detail = eventName switch
                {
                    "collection-run-start" => $"WS 历史采集已开始，已发现 {GetInt(root, "discovered")} 个会话。",
                    "collection-paused" => "检测到手动操作，自动采集已暂停，稍后会从断点继续。",
                    "collection-retry-scheduled" => $"WS 历史采集仍有 {GetInt(root, "retryable")} 个会话待重试，将从断点继续。",
                    "history-retryable" => "当前会话尚未完整采集，已保留断点并等待重试。",
                    "collection-complete" => $"WS 历史采集已完成：处理 {GetInt(root, "processed")} 个，会话 {GetInt(root, "discovered")} 个，待重试 {GetInt(root, "retryable")} 个。",
                    _ => "WS 自动采集状态已更新。",
                };
                GetBridge().Publish("ws.status", JsonSerializer.SerializeToElement(new { accountId, status = "已连接", detail, eventName, observedAt = capturedAt }));
                if (isComplete)
                    GetBridge().Publish("ws.message", JsonSerializer.SerializeToElement(new { accountId, eventName, collectionComplete = true, observedAt = capturedAt }));
                return;
            }
            var messages = new List<WsMessageEnvelopeDto>();
            if (root.TryGetProperty("messages", out var messageArray) && messageArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in messageArray.EnumerateArray())
                {
                    var conversationKey = StringValue(item, "conversationKey");
                    var body = RawStringValue(item, "body");
                    if (string.IsNullOrWhiteSpace(conversationKey) || string.IsNullOrWhiteSpace(body)) continue;
                    messages.Add(new WsMessageEnvelopeDto(
                        "desktop-webview2", accountId, conversationKey, StringValue(item, "externalMessageId"),
                        DateTimeOffset.TryParse(StringValue(item, "sentAt"), out var sent) ? sent : null,
                        StringValue(item, "direction"), body, false, capturedAt, StringValue(item, "cursor"), GetLong(item, "order"),
                        RawStringValue(item, "timestampText"), StringValue(item, "timestampSource"), StringValue(item, "legacyExternalMessageId"),
                        StringValue(item, "directionSource"), StringValue(item, "conversationType"), GetBool(item, "vipGroup"),
                        StringValue(item, "senderId"), StringValue(item, "senderName"), StringValue(item, "senderPhone"),
                        StringValue(item, "senderIdentitySource"), GetBool(item, "senderIdentityTrusted")));
                }
            }
            var checkpoints = new List<WsCheckpointDto>();
            var historyAcks = new List<object>();
            if (root.TryGetProperty("conversations", out var conversationArray) && conversationArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in conversationArray.EnumerateArray())
                {
                    var key = StringValue(item, "conversationKey");
                    if (!string.IsNullOrWhiteSpace(key))
                    {
                        var preview = StringValue(item, "lastMessagePreview");
                        if (string.IsNullOrWhiteSpace(preview)) preview = StringValue(item, "previewText");
                        if (string.IsNullOrWhiteSpace(preview)) preview = StringValue(item, "preview");
                        int? unreadCount = null;
                        if (item.TryGetProperty("unreadCount", out var unread) && unread.TryGetInt32(out var parsedUnread) && parsedUnread >= 0)
                            unreadCount = parsedUnread;
                        var historyLoaded = GetBool(item, "historyLoaded");
                        var historyMessageCount = GetInt(item, "historyMessageCount");
                        var directionVersion = GetInt(item, "directionVersion");
                        var directionUnresolvedCount = GetInt(item, "directionUnresolvedCount");
                        var vipGroup = GetBool(item, "vipGroup");
                        var conversationType = StringValue(item, "conversationType").ToLowerInvariant();
                        if (vipGroup && conversationType == "group") conversationType = "vip_group";
                        bool? isGroup = item.TryGetProperty("isGroup", out var groupValue) && groupValue.ValueKind is JsonValueKind.True or JsonValueKind.False
                            ? groupValue.GetBoolean()
                            : null;
                        checkpoints.Add(new WsCheckpointDto(
                            accountId,
                            key,
                            StringValue(item, "cursor"),
                            StringValue(item, "lastMessageFingerprint"),
                            capturedAt,
                            StringValue(item, "displayName"),
                            preview,
                            StringValue(item, "lastMessageAt"),
                            unreadCount,
                            StringValue(item, "coverage"),
                            historyLoaded,
                            StringValue(item, "collectionStatus"),
                            historyMessageCount,
                            directionVersion,
                            directionUnresolvedCount,
                            conversationType,
                            isGroup,
                            vipGroup));
                        if (historyLoaded && directionVersion >= 4 && directionUnresolvedCount == 0
                            && conversationType is "direct" or "vip_group")
                            historyAcks.Add(new { conversationKey = key, fingerprint = StringValue(item, "lastMessageFingerprint"), historyMessageCount, conversationType, vipGroup });
                    }
                }
            }
            var allowedConversationKeys = checkpoints
                .Where(item => string.Equals(item.ConversationType, "direct", StringComparison.OrdinalIgnoreCase)
                    || item.VipGroup && string.Equals(item.ConversationType, "vip_group", StringComparison.OrdinalIgnoreCase))
                .Select(item => item.ConversationKey)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            messages.RemoveAll(item => !allowedConversationKeys.Contains(item.ConversationKey));
            if (messages.Count == 0 && checkpoints.Count == 0) return;
            var request = new WsIngestBatchRequestDto("zhike.ws.ingest.batch.v1", "desktop-webview2", accountId, capturedAt, "visible-authorized-content", messages, checkpoints);
            await SetWsStatusAsync(accountId, "已连接");
            await _wsQueue.EnqueueAsync("api/ws/ingest/batch", request);
            if (historyAcks.Count > 0 && App.WsService.TryGetSession(accountId, out var sourceSession) && sourceSession?.View.CoreWebView2 is not null)
            {
                var ackJson = JsonSerializer.Serialize(historyAcks);
                try { await sourceSession.View.CoreWebView2.ExecuteScriptAsync($"window.__zhikeWsAcknowledgeHistory?.({ackJson}); void 0;"); } catch { }
            }
            _ = FlushWsQueueAsync();
            GetBridge().Publish("ws.status", JsonSerializer.SerializeToElement(new
            {
                accountId,
                status = "已连接",
                detail = $"已采集 {messages.Count} 条消息和 {checkpoints.Count} 个会话检查点，正在后台顺序写入。",
                queuedForRetry = true,
                observedAt = capturedAt,
            }));
            GetBridge().Publish("ws.message", JsonSerializer.SerializeToElement(new { accountId, accepted = 0, deduplicated = 0, conversations = checkpoints.Count, observedAt = capturedAt }));
        }
        catch (Exception error)
        {
            // The packet stays unacknowledged so the collector will retry it;
            // surface the durable-queue failure instead of silently implying
            // that a customer's history was saved.
            var detail = string.Join(" ", (error.Message ?? error.GetType().Name).Split(new[] { '\r', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries));
            if (detail.Length > 240) detail = detail[..240];
            try { GetBridge().Publish("ws.status", JsonSerializer.SerializeToElement(new { accountId = sessionAccountId, status = "暂存失败", detail, retryable = true, observedAt = DateTimeOffset.UtcNow })); } catch { }
        }
        finally { _wsMessageGate.Release(); }
    }

    private async Task FlushWsQueueAsync(CancellationToken cancellationToken = default)
    {
        if (_api is null || !await _wsFlushGate.WaitAsync(0, cancellationToken)) return;
        try
        {
            foreach (var item in await _wsQueue.PeekAsync(cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!string.Equals(item.Route, "api/ws/ingest/batch", StringComparison.Ordinal)) continue;
                try
                {
                    var request = LocalQueue.DeserializePayload<WsIngestBatchRequestDto>(item.PayloadJson)
                        ?? throw new InvalidDataException("WS 待同步数据无法反序列化。");
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    timeout.CancelAfter(TimeSpan.FromSeconds(15));
                    var result = await _api.IngestWsBatchAsync(request, timeout.Token);
                    await _wsQueue.RemoveAsync(item.Id, cancellationToken);
                    GetBridge().Publish("sync.updated", JsonSerializer.SerializeToElement(new { accountId = request.AccountId, accepted = result?.Accepted ?? 0, deduplicated = result?.Deduplicated ?? 0 }));
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception error)
                {
                    await _wsQueue.MarkFailureAsync(item.Id, error, cancellationToken);
                    break;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { }
        finally { _wsFlushGate.Release(); }
    }

    internal static string BuildWsCollectorScript(string accountId)
    {
        var encodedAccount = JsonSerializer.Serialize(accountId);
        return $$"""
(() => {
  // Stop the previous injected collector before installing a new one. Without
  // this hand-off reconnects accumulate observers, timers and wheel handlers.
  try { window.__zhikeStopCapture?.(); } catch {}
  const accountId = {{encodedAccount}};
  let vipGroupAllowlist = new Set();
  const normalizeVipGroupKey = value => String(value ?? '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
  const isVipGroupIdentity = (...values) => values.some(value => {
    const key = normalizeVipGroupKey(value);
    return Boolean(key && vipGroupAllowlist.has(key));
  });
  const collectibleConversationType = value => {
    const type = String(value ?? '').trim().toLocaleLowerCase();
    return type === 'direct' || type === 'vip_group';
  };
  window.__zhikeWsConfigureVipGroups = values => {
    vipGroupAllowlist = new Set((Array.isArray(values) ? values : [])
      .map(normalizeVipGroupKey)
      .filter(Boolean)
      .slice(0, 500));
    try { scheduleAllScan(10); } catch {}
    try { scheduleIncrementalReadHistory(20); } catch {}
    try { emit(true); } catch {}
    return { configured:vipGroupAllowlist.size };
  };
  // WebView2 may stop delivering requestAnimationFrame and heavily throttle
  // page-owned timers while the desktop window is hidden or minimized. Keep
  // collector scheduling private: normal rendering uses paint frames, while
  // the native heartbeat can drain due tasks without replacing window APIs.
  const collectorTasks = new Map();
  let collectorTaskSequence = 0;
  const scheduleCollectorTask = (callback, delay = 0) => {
    const id = ++collectorTaskSequence;
    const wait = Math.max(0, Number(delay) || 0);
    const entry = { id, due:Date.now() + wait, timer:0, callback, run:null };
    entry.run = () => {
      if (collectorTasks.get(id) !== entry) return;
      try { callback(); }
      finally { if (collectorTasks.get(id) === entry) collectorTasks.delete(id); }
    };
    collectorTasks.set(id, entry);
    try { entry.timer = setTimeout(entry.run, wait); } catch {}
    return id;
  };
  const cancelCollectorTask = id => {
    const entry = collectorTasks.get(id);
    if (!entry) return;
    collectorTasks.delete(id);
    try { clearTimeout(entry.timer); } catch {}
  };
  const cancelAllCollectorTasks = () => {
    for (const entry of collectorTasks.values()) { try { clearTimeout(entry.timer); } catch {} }
    collectorTasks.clear();
  };
  const drainDueCollectorTasks = (limit = 24) => {
    let drained = 0;
    while (drained < limit) {
      const now = Date.now();
      const next = [...collectorTasks.values()].filter(entry => entry.due <= now).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      next.run();
      drained += 1;
    }
    return drained;
  };
  const scheduleCollectorPaint = callback => {
    let settled = false;
    let fallbackTask = 0;
    const once = () => {
      if (settled || !collectorTasks.has(fallbackTask)) return;
      settled = true;
      cancelCollectorTask(fallbackTask);
      callback();
    };
    fallbackTask = scheduleCollectorTask(once, 250);
    try { requestAnimationFrame(() => requestAnimationFrame(once)); } catch {}
    return fallbackTask;
  };
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const text = node => clean(node?.innerText || node?.textContent || '');
  const rawText = node => String(node?.innerText ?? node?.textContent ?? '');
  const messageBodyText = wrapper => {
    let blocks = [];
    try { blocks = [...(wrapper?.querySelectorAll?.('span.selectable-text') || [])]; } catch {}
    const topLevel = blocks.filter(node => !node?.parentElement?.closest?.('span.selectable-text'));
    const values = topLevel.map(rawText).filter(value => value.trim().length > 0);
    return values.length ? values.join('\n') : rawText(wrapper);
  };
  const HISTORY_BODY_LIMIT = 128000;
  const encodedJsonSize = payload => {
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
    try { return typeof TextEncoder === 'function' ? new TextEncoder().encode(value).byteLength : value.length * 3; }
    catch { return value.length * 3; }
  };
  const rowSelectors = [
    '#pane-side [role="listitem"]', '[data-testid="chat-list"] [role="row"]',
    '[data-testid="chatlist"] [role="row"]', '[aria-label*="Chat list"] [role="row"]',
    '[aria-label*="聊天列表"] [role="row"]', '[role="grid"] [role="row"]',
    '[role="listitem"]', '[data-testid="cell-frame-container"]'
  ];
  const scopedRowSelectors = ['[role="listitem"]', '[role="row"]', '[data-testid="cell-frame-container"]'];
  const listSelector = '#pane-side, [data-testid="chat-list"], [data-testid="chatlist"], [aria-label="Chat list"], [aria-label="聊天列表"], [role="grid"]';
  const listContainer = () => {
    const candidates = [], seen = new Set();
    const add = node => { if (node && !seen.has(node)) { seen.add(node); candidates.push(node); } };
    try { for (const node of document.querySelectorAll(listSelector)) add(node); } catch {}
    if (!candidates.length) { try { add(document.querySelector(listSelector)); } catch {} }
    // WhatsApp has shipped both a scrollable #pane-side root and a nested
    // role=grid/list container. Include both and choose the deepest element
    // whose scroll metrics prove that it is the actual viewport.
    for (const root of [...candidates]) {
      if (!root.querySelectorAll) continue;
      for (const selector of ['[role="grid"]', '[data-testid="chat-list"]', '[data-testid="chatlist"]']) {
        try { for (const node of root.querySelectorAll(selector)) add(node); } catch {}
      }
    }
    const depth = node => { let value = 0, parent = node?.parentElement; while (parent && value < 32) { value += 1; parent = parent.parentElement; } return value; };
    const scrollable = candidates.filter(node => Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 4);
    scrollable.sort((left, right) => depth(right) - depth(left));
    return scrollable[0] || candidates[0] || null;
  };
  const compactId = value => { let hash = 2166136261; for (const char of String(value || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); } return `row-${(hash >>> 0).toString(36)}`; };
  const isMessagePaneBoundary = node => {
    const testId = clean(node?.getAttribute?.('data-testid') || '').toLowerCase();
    return node?.id === 'main' || ['conversation-panel-messages', 'conversation-panel-body', 'conversation-panel-wrapper'].includes(testId);
  };
  const directionStructureSignal = (node, depth) => {
    const closed = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
    const icon = name => {
      try { return Boolean(node?.matches?.(`[data-icon="${name}"]`) || node?.querySelector?.(`[data-icon="${name}"]`)); } catch { return false; }
    };
    const colorChannels = value => {
      const raw = clean(value).toLowerCase();
      const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i);
      if (rgb) return [Math.max(0, Math.min(255, Number(rgb[1]) || 0)), Math.max(0, Math.min(255, Number(rgb[2]) || 0)), Math.max(0, Math.min(255, Number(rgb[3]) || 0)), Math.max(0, Math.min(255, Math.round(Number(rgb[4] ?? 1) * 255)))];
      const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (!hex) return [0,0,0,0];
      const expanded = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join('') : hex[1];
      return [Number.parseInt(expanded.slice(0,2),16), Number.parseInt(expanded.slice(2,4),16), Number.parseInt(expanded.slice(4,6),16), 255];
    };
    const tag = closed(String(node?.tagName || '').toLowerCase(), ['div','span','li','article','section','main'], 'other');
    const role = closed(clean(node?.getAttribute?.('role') || '').toLowerCase(), ['row','gridcell','listitem','presentation','application','button','group'], 'none');
    const hasOut = Boolean(node?.classList?.contains?.('message-out'));
    const hasIn = Boolean(node?.classList?.contains?.('message-in'));
    const classDirection = hasOut && hasIn ? 'both' : hasOut ? 'out' : hasIn ? 'in' : 'none';
    const rawId = clean(node?.getAttribute?.('data-id') || node?.getAttribute?.('data-message-id') || '');
    const dataPrefix = /^true_/i.test(rawId) ? 'true' : /^false_/i.test(rawId) ? 'false' : rawId ? 'other' : 'none';
    let align = 'none', bg = [0,0,0,0], outBg = [0,0,0,0], inBg = [0,0,0,0];
    try {
      const style = globalThis.getComputedStyle?.(node);
      const rawAlign = clean(style?.alignSelf || style?.textAlign || '').toLowerCase();
      align = closed(rawAlign, ['left','right','start','end','center','normal','auto','stretch','self-start','self-end','flex-start','flex-end'], rawAlign ? 'other' : 'none');
      bg = colorChannels(style?.backgroundColor || '');
      outBg = colorChannels(style?.getPropertyValue?.('--outgoing-background') || '');
      inBg = colorChannels(style?.getPropertyValue?.('--incoming-background') || '');
    } catch {}
    return {
      depth, tag, role, classDirection, dataPrefix, align,
      hasMsgCheck:icon('msg-check'), hasMsgDblcheck:icon('msg-dblcheck'), hasMsgTime:icon('msg-time'), hasTailOut:icon('tail-out'), hasTailIn:icon('tail-in'),
      bgR:bg[0], bgG:bg[1], bgB:bg[2], bgA:bg[3], outBgR:outBg[0], outBgG:outBg[1], outBgB:outBg[2], outBgA:outBg[3], inBgR:inBg[0], inBgG:inBg[1], inBgB:inBg[2], inBgA:inBg[3],
    };
  };
  const directionStructureSignals = node => {
    const result = [];
    let current = node;
    for (let depth = 0; current && depth < 12; depth += 1) {
      result.push(directionStructureSignal(current, depth));
      if (isMessagePaneBoundary(current)) break;
      current = current.parentElement;
    }
    return result;
  };
  let lastDirectionDiagnosticAt = 0;
  const postDirectionDiagnostic = node => {
    if (!window.chrome?.webview || Date.now() - lastDirectionDiagnosticAt < 15000) return;
    lastDirectionDiagnosticAt = Date.now();
    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type:'zhike.ws.capture', accountId, eventName:'direction-unresolved-structure', capturedAt:new Date().toISOString(),
        directionSignals:directionStructureSignals(node),
      }));
    } catch {}
  };
  const hasDirectionIcon = (node, name) => {
    try { return Boolean(node?.matches?.(`[data-icon="${name}"]`) || node?.querySelector?.(`[data-icon="${name}"]`)); } catch { return false; }
  };
  const strictCssColor = value => {
    const raw = clean(value).toLowerCase();
    const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i);
    if (rgb) return [Math.max(0, Math.min(255, Number(rgb[1]) || 0)), Math.max(0, Math.min(255, Number(rgb[2]) || 0)), Math.max(0, Math.min(255, Number(rgb[3]) || 0)), Math.max(0, Math.min(255, Math.round(Number(rgb[4] ?? 1) * 255)))];
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hex) return null;
    const expanded = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join('') : hex[1];
    return [Number.parseInt(expanded.slice(0,2),16), Number.parseInt(expanded.slice(2,4),16), Number.parseInt(expanded.slice(4,6),16), 255];
  };
  const sameRgb = (left, right) => Boolean(left && right && left[0] === right[0] && left[1] === right[1] && left[2] === right[2]);
  const paletteDirectionEvidence = node => {
    let anchor = null;
    try { anchor = node?.matches?.('[data-pre-plain-text]') ? node : node?.querySelector?.('[data-pre-plain-text]'); } catch {}
    if (!anchor) return null;
    let container = null, current = anchor;
    for (let depth = 0; current && depth < 12; depth += 1) {
      if (clean(current?.getAttribute?.('data-testid') || '').toLowerCase() === 'msg-container') { container = current; break; }
      if (clean(current?.getAttribute?.('role') || '').toLowerCase() === 'row' || isMessagePaneBoundary(current)) break;
      current = current.parentElement;
    }
    if (!container) return null;
    let paletteStyle = null;
    try { paletteStyle = globalThis.getComputedStyle?.(anchor); } catch {}
    const outgoing = strictCssColor(paletteStyle?.getPropertyValue?.('--outgoing-background') || '');
    const incoming = strictCssColor(paletteStyle?.getPropertyValue?.('--incoming-background') || '');
    if (!outgoing || !incoming || outgoing[3] <= 0 || incoming[3] <= 0 || sameRgb(outgoing, incoming)) return null;
    current = anchor;
    for (let depth = 0; current && depth < 12; depth += 1) {
      let background = null;
      try { background = strictCssColor(globalThis.getComputedStyle?.(current)?.backgroundColor || ''); } catch {}
      if (background && background[3] > 0) {
        if (sameRgb(background, outgoing)) return { direction:'outgoing', source:'palette-outgoing', wrapper:container };
        if (sameRgb(background, incoming)) return { direction:'incoming', source:'palette-incoming', wrapper:container };
        return null;
      }
      if (current === container) break;
      current = current.parentElement;
    }
    return null;
  };
  const resolveMessageDirection = node => {
    let current = node, fallbackWrapper = null, classEvidence = null, idEvidence = null, idAmbiguous = false, tailEvidence = null, tailAmbiguous = false;
    for (let depth = 0; current && depth < 12; depth += 1) {
      const testId = clean(current?.getAttribute?.('data-testid') || '').toLowerCase();
      const role = clean(current?.getAttribute?.('role') || '').toLowerCase();
      if (!fallbackWrapper && testId === 'msg-container') fallbackWrapper = current;
      const hasOut = Boolean(current?.classList?.contains?.('message-out'));
      const hasIn = Boolean(current?.classList?.contains?.('message-in'));
      if (hasOut !== hasIn) {
        const direction = hasOut ? 'outgoing' : 'incoming';
        if (!classEvidence) classEvidence = { direction, source:hasOut ? 'class-message-out' : 'class-message-in', wrapper:current };
        else if (classEvidence.direction !== direction) classEvidence = null;
      }
      const explicitId = clean(current?.getAttribute?.('data-id') || current?.getAttribute?.('data-message-id') || '');
      if (/^(?:true|false)_/i.test(explicitId)) {
        const direction = /^true_/i.test(explicitId) ? 'outgoing' : 'incoming';
        if (!idEvidence) idEvidence = { direction, source:direction === 'outgoing' ? 'data-id-outgoing' : 'data-id-incoming', wrapper:current, externalMessageId:explicitId };
        else if (idEvidence.direction !== direction) idAmbiguous = true;
      }
      const hasTailOut = hasDirectionIcon(current, 'tail-out');
      const hasTailIn = hasDirectionIcon(current, 'tail-in');
      if (hasTailOut && hasTailIn) tailAmbiguous = true;
      else if (hasTailOut || hasTailIn) {
        const direction = hasTailOut ? 'outgoing' : 'incoming';
        if (!tailEvidence) tailEvidence = { direction, source:hasTailOut ? 'icon-tail-out' : 'icon-tail-in', wrapper:current };
        else if (tailEvidence.direction !== direction) tailAmbiguous = true;
      }
      // A WhatsApp message role=row is the last safe boundary for icon
      // evidence. Never continue into the conversation pane where a sibling
      // message's tail could be borrowed by the current message.
      if (role === 'row' || isMessagePaneBoundary(current)) break;
      current = current.parentElement;
    }
    if (classEvidence) return { ...classEvidence, externalMessageId:idAmbiguous ? '' : clean(idEvidence?.externalMessageId) };
    if (idEvidence && !idAmbiguous) return idEvidence;
    if (tailEvidence && !tailAmbiguous) return tailEvidence;
    const paletteEvidence = paletteDirectionEvidence(node);
    if (paletteEvidence) return paletteEvidence;
    try { fallbackWrapper = fallbackWrapper || node?.closest?.('[data-testid="msg-container"]') || null; } catch {}
    return { direction:'', source:'', wrapper:fallbackWrapper || node, externalMessageId:'' };
  };
  const messageExternalId = (node, wrapper) => {
    const candidates = [wrapper, node];
    try { candidates.push(node?.closest?.('[data-id], [data-message-id]')); } catch {}
    try { candidates.push(wrapper?.querySelector?.('[data-id], [data-message-id]')); } catch {}
    for (const candidate of candidates) {
      const value = clean(candidate?.getAttribute?.('data-id') || candidate?.getAttribute?.('data-message-id') || '');
      if (value) return value;
    }
    return '';
  };
  const legacyMessageExternalId = (node, conversationKey, rawPreamble, canonicalExternalMessageId) => {
    // Compatibility only: reproduce the v3 wrapper/direction/id algorithm so
    // the server can locate and repair the exact old row. This value never
    // decides the new semantic direction.
    let legacyWrapper = node;
    try { legacyWrapper = node?.closest?.('.message-in, .message-out, [data-testid="msg-container"]') || node; } catch {}
    const legacyBody = messageBodyText(legacyWrapper);
    const legacyDirection = /message-out|data-pre-plain-text="\[.*\] you:/i.test(legacyWrapper?.outerHTML || '') ? 'outgoing' : 'incoming';
    const legacyId = `wa-${compactId(`${conversationKey}|${clean(rawPreamble)}|${legacyDirection}|${legacyBody}`)}`;
    return legacyId === canonicalExternalMessageId ? '' : legacyId;
  };
  // v7 preserves the direct/VIP-group boundary in every durable checkpoint.
  // Ordinary groups and unresolved rows can never become acknowledged work.
  const checkpointStorageKey = `zhike.ws.history.v7.${compactId(accountId)}`;
  const readCheckpointState = () => {
    try {
      const value = JSON.parse(localStorage.getItem(checkpointStorageKey) || '{}');
      return value && typeof value === 'object' && value.version === 7 && value.completed && typeof value.completed === 'object'
        ? value
        : { version:7, completed:{} };
    } catch { return { version:7, completed:{} }; }
  };
  let checkpointState = readCheckpointState();
  const checkpointKey = row => compactId(`${accountId}|${clean(row?.conversationKey || row?.externalId || '')}`);
  const checkpointFingerprint = row => clean(row?.lastMessageFingerprint || row?.cursor || '');
  const checkpointMatches = row => {
    const conversationType = clean(row?.conversationType).toLocaleLowerCase();
    if (!collectibleConversationType(conversationType)) return false;
    const entry = checkpointState.completed?.[checkpointKey(row)];
    const fingerprint = checkpointFingerprint(row);
    return Boolean(entry && fingerprint && entry.fingerprint === fingerprint && entry.conversationType === conversationType);
  };
  const saveCheckpointState = () => {
    try {
      const entries = Object.entries(checkpointState.completed || {}).sort((a, b) => Number(b[1]?.acknowledgedAt || 0) - Number(a[1]?.acknowledgedAt || 0)).slice(0, 20000);
      checkpointState = { version:7, completed:Object.fromEntries(entries) };
      localStorage.setItem(checkpointStorageKey, JSON.stringify(checkpointState));
    } catch {}
  };
  window.__zhikeWsAcknowledgeHistory = rows => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = clean(row?.conversationKey);
      const fingerprint = clean(row?.fingerprint);
      const conversationType = clean(row?.conversationType).toLocaleLowerCase();
      if (!key || !fingerprint || !collectibleConversationType(conversationType)) continue;
      checkpointState.completed[compactId(`${accountId}|${key}`)] = {
        fingerprint,
        conversationType,
        historyMessageCount:Math.max(0, Number(row?.historyMessageCount || 0)),
        acknowledgedAt:Date.now(),
      };
    }
    saveCheckpointState();
    return true;
  };
  const postCollectorEvent = (event, detail = {}) => {
    if (!window.chrome?.webview) return;
    window.chrome.webview.postMessage(JSON.stringify({ type:'zhike.ws.capture', accountId, capturedAt:new Date().toISOString(), eventName:event, ...detail }));
  };
  const stripSystem = value => clean(value).replace(/\s*此聊天中的新消息将在发送(?:7|90)天后自动消失(?:（除非消息已保留）)?。?\s*$/g, '').replace(/\s*\d+\s*条未读消息\s*/g, ' ').trim();
  const rowNodes = () => {
    const seen = new Set(), rows = [];
    const container = listContainer();
    // Prefer the actual chat-list root so broad [role=listitem] matches from
    // the navigation rail or modal dialogs cannot be mistaken for chats.
    // Fallback to the historical global selectors only when the page variant
    // does not expose a recognizable root yet (for login/transition states).
    const roots = container?.querySelectorAll ? [{ root:container, selectors:scopedRowSelectors }] : [{ root:document, selectors:rowSelectors }];
    for (const entry of roots) for (const selector of entry.selectors) for (const node of entry.root.querySelectorAll(selector)) { if (!seen.has(node)) { seen.add(node); rows.push(node); } }
    if (!rows.length && container) for (const selector of rowSelectors) for (const node of document.querySelectorAll(selector)) { if (!seen.has(node)) { seen.add(node); rows.push(node); } }
    return rows;
  };
   const unreadState = row => {
     if (!row || typeof row !== 'object') return { unread:false, uncertainUnread:true, unreadMarker:'' };
     if (row.unread === true || Number(row.unreadCount || 0) > 0) return { unread:true, uncertainUnread:false, unreadMarker:clean(row.unreadMarker || '') };
     // unreadMarker is produced only from a verified badge/count element.
     // Never re-interpret listText here: it contains customer message previews
     // and hidden actions such as “Mark as unread”.
     const marker = clean(row.unreadMarker || '');
     const unread = /(?:unread|未读|new message|条未读消息|未讀|अनपढ़|غير مقروء|غير مقروءة|未確認)/i.test(marker);
     // An explicit count of zero is a positive read signal. If the DOM exposes
     // neither a count nor accessible list metadata, do not click the row: a
     // layout change must fail closed rather than marking a customer's chat read.
     const hasExplicitReadSignal = (row.unread === false || row.unreadStateKnown === true) && row.unreadCount === 0 && Boolean(clean(row.displayName || row.title || row.conversationKey || row.externalId));
     return { unread, uncertainUnread:!unread && !hasExplicitReadSignal, unreadMarker:marker.slice(0, 500) };
   };
   const readHistoryCandidates = rows => {
     const read = [], skipped = [];
     for (const row of Array.isArray(rows) ? rows : []) {
        const conversationType = clean(row?.conversationType || 'unknown').toLocaleLowerCase();
        if (!collectibleConversationType(conversationType)) {
          skipped.push({ ...row, conversationType, isGroup:conversationType === 'group', status:conversationType === 'group' ? 'skipped-group' : 'conversation-type-unresolved' });
          continue;
        }
       const signal = unreadState(row);
       const normalized = { ...row, unread:signal.unread, uncertainUnread:signal.uncertainUnread, unreadMarker:signal.unreadMarker, status:signal.unread || signal.uncertainUnread ? 'skipped_unread' : 'queued' };
       if (signal.unread || signal.uncertainUnread) skipped.push(normalized); else read.push(normalized);
     }
     return { read, skipped };
   };
   const isNavigationRow = (row, identity = '') => {
     const role = clean(row?.getAttribute?.('role')).toLocaleLowerCase();
     const dataTestId = clean(row?.getAttribute?.('data-testid')).toLocaleLowerCase();
     const ownTitle = clean(row?.getAttribute?.('title'));
     const ownLabel = clean(row?.getAttribute?.('aria-label'));
     const titledChild = row?.querySelector?.('[title]');
     const childTitle = clean(titledChild?.getAttribute?.('title'));
     const semanticTitles = [ownTitle, ownLabel, childTitle].filter(Boolean);
     // Use structural/accessibility semantics only. Never inspect innerText or
     // message previews here: a real customer may legitimately send words such
     // as “archived”, and that conversation must not disappear.
     // WhatsApp appends a numeric archived-chat count to this navigation
     // title in some locales (for example an accessible title ending in “2”).
     // The match remains restricted to semantic attributes on an identity-less
     // row; message preview/body text is deliberately never considered.
     const archiveTitle = /^(?:archived(?: chats?)?|已归档(?:的聊天)?|歸檔(?:的對話)?|已封存(?:的對話)?|archivados?|arquivados?|archivierte chats?|アーカイブ済み|संग्रहित चैट|المحادثات المؤرشفة)(?:\s*[(（]?\d{1,6}[)）]?)?$/i;
     const machineArchive = /(?:^|[-_:])archiv(?:e|ed)?(?:[-_:]|$)/i.test(`${dataTestId} ${identity}`);
     const titleArchive = !identity && semanticTitles.some(value => archiveTitle.test(value));
     const explicitNavigationRole = !identity && /^(?:navigation|menuitem|menuitemradio|menuitemcheckbox|tab|button|link|separator|presentation)$/.test(role);
     return machineArchive || titleArchive || explicitNavigationRole;
   };
   const unreadBadgeState = row => {
     const candidates = [row];
     try { candidates.push(...row.querySelectorAll('[aria-label], [data-testid]')); } catch {}
     const actionPattern = /^(?:mark\s+as\s+unread|mark\s+unread|标(?:记|為|为)未读|標(?:記|示)為未讀|未読にする|marcar\s+como\s+no\s+le[ií]do|marcar\s+como\s+n[aã]o\s+lido)/i;
     const actionTestId = /(?:^|[-_:])(?:mark|mi)[-_:].*unread|unread.*(?:action|menu)/i;
     const badgeTestId = /^(?:(?:icon|cell-frame)[-_:])?unread(?:[-_:]count)?$/i;
     const countPatterns = [
       /(?:^|[,，]\s*)(\d{1,6})\s*(?:unread\s+messages?|条未读消息|條未讀訊息|則未讀訊息)(?:$|[,，.。])/i,
       /(?:^|[,，]\s*)(?:unread\s+messages?|未读消息|未讀訊息)\s*[:：]?\s*(\d{1,6})(?:$|[,，.。])/i,
     ];
     for (const node of candidates) {
       const testId = clean(node?.getAttribute?.('data-testid')).toLocaleLowerCase();
       const aria = clean(node?.getAttribute?.('aria-label'));
       const title = clean(node?.getAttribute?.('title'));
       const semantic = aria || title;
       if (actionTestId.test(testId) || actionPattern.test(semantic)) continue;
       const explicitCount = countPatterns.map(pattern => semantic.match(pattern)).find(Boolean);
       const knownBadge = badgeTestId.test(testId);
       if (!knownBadge && !explicitCount) continue;
       const rawCount = explicitCount?.[1] || clean(node?.textContent).match(/^\d{1,6}$/)?.[0] || aria.match(/\d{1,6}/)?.[0] || '0';
       return { unread:true, unreadCount:Math.max(1, Number(rawCount || 0)), unreadMarker:clean(`${testId} ${aria}`).slice(0, 300) };
     }
     return { unread:false, unreadCount:0, unreadMarker:'' };
   };
   const primaryConversationTitles = root => {
     if (!root) return [];
     const nodes = [], seenNodes = new Set(), values = [], seenValues = new Set();
     const addNode = node => { if (node && !seenNodes.has(node)) { seenNodes.add(node); nodes.push(node); } };
     try { if (root.matches?.('span[dir="auto"][title], [data-testid*="cell-frame-title" i], [data-testid*="conversation-info-header" i] span[title]')) addNode(root); } catch {}
     for (const selector of [
       '[data-testid*="cell-frame-title" i] span[title]',
       '[data-testid*="cell-frame-title" i][title]',
       '[data-testid*="conversation-info-header" i] span[title]',
       'span[dir="auto"][title]',
     ]) {
       try { for (const node of root.querySelectorAll?.(selector) || []) addNode(node); } catch {}
     }
     for (const node of nodes) {
       try {
         if (node.closest?.('button, [role="button"], [data-testid*="menu" i], [data-testid*="last-msg" i], [data-testid*="preview" i], time')) continue;
       } catch {}
       const value = stripSystem(clean(node.getAttribute?.('title') || node.textContent || '')).slice(0, 200);
       const comparable = value.toLocaleLowerCase();
       if (value && !seenValues.has(comparable)) { seenValues.add(comparable); values.push(value); }
     }
     return values;
   };
    const conversationTypeFromNode = (root, identity = '', displayName = '') => {
      if (!root) return { conversationType:'unknown', isGroup:false, source:'none' };
      const identifiers = [identity];
      const semanticValues = [];
      const inspect = node => {
        if (!node) return;
        for (const name of ['data-id','data-chat-id','data-jid','data-group-id','data-contact-id']) {
          const value = clean(node.getAttribute?.(name));
          if (value) identifiers.push(value);
        }
        for (const name of ['data-chat-type','data-conversation-type','data-thread-type','data-is-group']) {
          const value = clean(node.getAttribute?.(name)).toLocaleLowerCase();
          if (value) semanticValues.push(value);
        }
        const testId = clean(node.getAttribute?.('data-testid')).toLocaleLowerCase();
        if (testId) semanticValues.push(testId);
        const dataIcon = clean(node.getAttribute?.('data-icon')).toLocaleLowerCase();
        if (dataIcon) semanticValues.push(dataIcon);
      };
      inspect(root);
      try {
        for (const node of root.querySelectorAll?.('[data-id], [data-chat-id], [data-jid], [data-group-id], [data-contact-id], [data-chat-type], [data-conversation-type], [data-thread-type], [data-is-group], [data-testid*="group-chat" i], [data-testid*="group-info" i], [data-testid*="group-avatar" i], [data-testid*="community" i], [data-icon="default-group" i], [data-icon="default-community" i]') || []) inspect(node);
      } catch {}
      if (identifiers.some(value => /@g\.us(?:\b|$)/i.test(value))) {
        const vipGroup = isVipGroupIdentity(identity, displayName, ...identifiers);
        return { conversationType:vipGroup ? 'vip_group' : 'group', isGroup:true, vipGroup, source:'jid-g.us' };
      }
      if (semanticValues.some(value => /^(?:true|group|group-chat|groupchat|community|default-group|default-community|multi-user|multiuser)$/.test(value) || /(?:^|[-_:])(?:group-chat|group-info|group-avatar|community)(?:[-_:]|$)/.test(value))) {
        const vipGroup = isVipGroupIdentity(identity, displayName, ...identifiers);
        return { conversationType:vipGroup ? 'vip_group' : 'group', isGroup:true, vipGroup, source:'dom-group' };
      }
      if (identifiers.some(value => /@(?:s\.whatsapp\.net|c\.us|lid)(?:\b|$)/i.test(value))) return { conversationType:'direct', isGroup:false, source:'jid-direct' };
      if (semanticValues.some(value => /^(?:false|direct|private|individual|contact|user|one-to-one|1:1)$/.test(value))) return { conversationType:'direct', isGroup:false, source:'dom-direct' };
      const visibleIdentity = clean(displayName);
      const digits = visibleIdentity.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(visibleIdentity))
        return { conversationType:'direct', isGroup:false, source:'visible-phone' };
      return { conversationType:'unknown', isGroup:false, source:'unresolved' };
    };
   const readRows = () => rowNodes().map((row, index) => {
    const labels = [row, ...row.querySelectorAll('[aria-label], [aria-description], [title], [data-pre-plain-text]')].map(node => clean(node.getAttribute?.('aria-label') || node.getAttribute?.('aria-description') || node.getAttribute?.('title') || node.getAttribute?.('data-pre-plain-text') || '')).filter(Boolean);
    const pageText = labels.join(' ').slice(0, 2000);
    const identity = clean(row.getAttribute('data-id') || row.getAttribute('data-chat-id') || row.querySelector('[data-id], [data-testid*="cell-frame-container"], a[href*="chat"]')?.getAttribute('data-id') || '');
    if (isNavigationRow(row, identity)) return null;
    const primaryTitles = primaryConversationTitles(row);
    const displayName = stripSystem(clean(primaryTitles[0] || row.querySelector('[title], span[dir="auto"]')?.getAttribute('title') || row.querySelector('span[dir="auto"]')?.textContent || labels[0] || '')).slice(0, 200);
    const previewNode = row.querySelector('[data-testid*="last-msg"], [data-testid*="message"], [data-testid*="preview"], [aria-description], span[title]');
    const preview = stripSystem(previewNode?.getAttribute?.('aria-label') || previewNode?.getAttribute?.('aria-description') || previewNode?.getAttribute?.('title') || previewNode?.textContent || text(row)).slice(-500);
    const externalId = (identity || compactId(displayName || pageText)).slice(0, 200);
    const timeNode = row.querySelector('time, [data-testid*="time"], [aria-label*="AM"], [aria-label*="PM"]');
    const lastMessageAt = clean(timeNode?.getAttribute?.('datetime') || timeNode?.getAttribute?.('aria-label') || timeNode?.getAttribute?.('title') || '').slice(0, 100);
     const badge = unreadBadgeState(row);
     const rowRole = clean(row.getAttribute?.('role')).toLocaleLowerCase();
     const rowTestId = clean(row.getAttribute?.('data-testid')).toLocaleLowerCase();
     const unreadStateKnown = Boolean(identity || /^(?:cell-frame-container|chat-list-item|chat-row)$/.test(rowTestId) || (/^(?:row|listitem)$/.test(rowRole) && displayName));
     const unreadCount = badge.unreadCount;
     const unread = unreadState({ unreadCount, unreadMarker:badge.unreadMarker, unread:badge.unread, unreadStateKnown, displayName:unreadStateKnown ? displayName : '', title:unreadStateKnown ? displayName : '', conversationKey:unreadStateKnown ? externalId : '', externalId:unreadStateKnown ? externalId : '' });
      const typeEvidence = conversationTypeFromNode(row, identity, displayName);
      const rowFingerprint = compactId(`timestamp-v4-direction-v4-type-v1|${externalId}|${preview}|${lastMessageAt}|${unreadCount}|${typeEvidence.conversationType}`);
      const typeStatus = typeEvidence.conversationType === 'group' ? 'skipped-group' : typeEvidence.conversationType === 'unknown' ? 'retryable' : '';
      const result = { index, conversationKey: externalId, externalId, displayName, title:displayName, lastMessagePreview:preview, previewText:preview, preview, lastMessageAt, unreadCount, unread:unread.unread, uncertainUnread:unread.uncertainUnread, unreadStateKnown, unreadMarker:unread.unreadMarker, conversationType:typeEvidence.conversationType, isGroup:typeEvidence.isGroup, vipGroup:typeEvidence.vipGroup === true, conversationTypeSource:typeEvidence.source, status:typeStatus || (unread.unread || unread.uncertainUnread ? 'skipped_unread' : 'queued'), coverage:typeEvidence.conversationType === 'group' ? 'excluded-group' : typeEvidence.conversationType === 'unknown' ? 'conversation-type-unresolved' : '', cursor:rowFingerprint, lastMessageFingerprint:rowFingerprint, listText:pageText, previewOnly:true, visibleOnly:true };
     try {
       Object.defineProperty(result, '__node', { value:row, enumerable:false });
       Object.defineProperty(result, '__identityTitles', { value:primaryTitles, enumerable:false });
     } catch {}
     return result;
  }).filter(row => row && (row.displayName || row.externalId || row.lastMessagePreview));
   window.__zhikeWsReadHistoryCandidates = readHistoryCandidates;
  const discover = () => {
     const conversations = [], excludedConversations = [], seen = new Set();
     for (const row of readRows()) {
       if (!row.conversationKey || seen.has(row.conversationKey)) continue;
       seen.add(row.conversationKey);
       if (collectibleConversationType(row.conversationType)) conversations.push(row);
       else excludedConversations.push(row);
     }
     return {
       supported: conversations.length > 0 || excludedConversations.length > 0,
       conversations,
       excludedConversations,
       excludedGroupCount:excludedConversations.filter(row => row.conversationType === 'group').length,
       conversationTypeUnresolvedCount:excludedConversations.filter(row => row.conversationType === 'unknown').length,
     };
  };
  // WhatsApp virtualizes the chat list.  A synchronous scroll loop reads the
  // same DOM window repeatedly because React applies virtualization on the next
  // frame.  Use a bounded frame-by-frame scanner instead: the manual bridge
  // call returns the current window immediately, while the completed scan posts
  // one full-list capture back through WebView2.  The user's scroll position is
  // restored only after the final frame has rendered.
  let allScan = null;
  let allScanTimer = null;
  let allScanGeneration = 0;
  let lastAllScanAt = 0;
  let lastListInteractionAt = 0;
  const maxConversationCount = () => {
    const configured = Number(window.__zhikeWsMaxConversations);
    return Number.isFinite(configured) && configured >= 1000
      ? Math.min(50000, Math.floor(configured))
      : 50000;
  };
  // This deadline only yields the virtual-list discovery pass. It never marks
  // unread/read-history work complete; the next incremental pass resumes from
  // durable per-conversation fingerprints.
  const LIST_SCAN_DEADLINE_MS = 10 * 60 * 1000;
  const LIST_SCAN_STALL_MS = 30 * 1000;
  const markListInteraction = event => {
    // processNext dispatches synthetic pointer/mouse events to make WhatsApp
    // honor a row click. Those events bubble through this capture listener but
    // are not user intent and must not cancel the collector itself.
    if (event?.isTrusted === false) return;
    if (!event.target?.closest?.(listSelector)) return;
    lastListInteractionAt = Date.now();
    if (allScan) {
      const run = allScan;
      allScanGeneration += 1;
      allScan = null;
      try { run.container.scrollTop = run.initial; } catch {}
    }
    if (readHistoryScan) {
      const run = readHistoryScan;
      readHistoryScan = null;
      try { run.container.scrollTop = run.initial; } catch {}
      postCollectorEvent('collection-paused', { event:'collection-paused', scanId:run.id, coverage:'read-history-paused', reason:'user-interaction', processed:run.processed.size, discovered:run.seen.size, attempted:run.attempted.size, retryable:run.retryable.length, skippedUnreadCount:run.skipped.length });
      // Yield immediately to the user, then resume from acknowledged
      // per-conversation checkpoints after the list has been idle.
      scheduleIncrementalReadHistory(3500);
    }
  };
  const mergeRows = (target, rows, limit = Number.MAX_SAFE_INTEGER) => {
    for (const row of rows) {
      if (target.size >= limit) break;
      const key = row.conversationKey || `${row.displayName}|${row.lastMessagePreview}`;
      if (key && !target.has(key)) target.set(key, { ...row, index: target.size });
    }
  };
   const postAllScan = (conversations, coverage = 'page-list-scanned', messageOverride = null) => {
    if (!window.chrome?.webview) return;
     const capturedMessages = (Array.isArray(messageOverride) ? messageOverride : capture().messages).map(item => ({
      conversationKey:clean(item.conversationKey).slice(0, 200),
      externalMessageId:clean(item.externalMessageId).slice(0, 200),
      legacyExternalMessageId:clean(item.legacyExternalMessageId).slice(0, 200),
      body:String(item.body ?? ''),
      direction:clean(item.direction).slice(0, 20),
      directionSource:clean(item.directionSource).slice(0, 40),
       conversationType:clean(item.conversationType || 'direct').slice(0, 20), isGroup:item.isGroup === true, vipGroup:item.vipGroup === true,
      senderId:clean(item.senderId).slice(0, 200), senderName:clean(item.senderName).slice(0, 200),
      senderPhone:clean(item.senderPhone).slice(0, 40), senderIdentitySource:clean(item.senderIdentitySource).slice(0, 40),
      senderIdentityTrusted:item.senderIdentityTrusted === true,
      sentAt:clean(item.sentAt).slice(0, 80),
      timestampText:String(item.timestampText ?? '').slice(0, 500),
      timestampSource:clean(item.timestampSource).slice(0, 40),
      cursor:clean(item.cursor).slice(0, 240),
      order:Number(item.order || 0),
    })).filter(item => item.body.length <= HISTORY_BODY_LIMIT);
    // Keep each bridge payload comfortably below the native 1.2 MB guard.
    // A single JSON document containing 5,000 rows can exceed that limit even
    // after field trimming (especially for non-ASCII names/previews).  Split
    // the completed virtual-list scan into bounded, idempotent chunks instead
    // of dropping the entire scan at the native boundary.
    const messageCounts = new Map();
    for (const item of capturedMessages) {
      const key = clean(item.conversationKey);
      if (key) messageCounts.set(key, Number(messageCounts.get(key) || 0) + 1);
    }
    const compact = conversations.slice(0, maxConversationCount()).map(item => ({
      index:item.index, conversationKey:item.conversationKey, externalId:item.externalId,
      displayName:clean(item.displayName).slice(0, 120),
      title:clean(item.title || item.displayName).slice(0, 120),
      // Keep one canonical preview field; the old three aliases multiplied
      // payload size without adding information to the checkpoint protocol.
      previewText:clean(item.previewText || item.lastMessagePreview || item.preview).slice(0, 180),
      lastMessageAt:clean(item.lastMessageAt).slice(0, 80),
      unreadCount:Number(item.unreadCount || 0),
      cursor:clean(item.cursor).slice(0, 240),
      lastMessageFingerprint:clean(item.lastMessageFingerprint).slice(0, 240),
       conversationType:clean(item.conversationType || 'unknown').slice(0, 20),
       isGroup:item.conversationType === 'group' || item.conversationType === 'vip_group' || item.isGroup === true,
       vipGroup:item.conversationType === 'vip_group' || item.vipGroup === true,
       previewOnly:item.previewOnly !== false, visibleOnly:item.visibleOnly !== false,
       historyLoaded:item.historyLoaded === true, historyMessageCount:Number(item.historyMessageCount || messageCounts.get(clean(item.conversationKey)) || 0), coverage:clean(item.coverage || coverage).slice(0, 40), collectionStatus:clean(item.status || '').slice(0, 30),
    }));
    const MAX_BYTES = 600000;
    const capturedAt = new Date().toISOString();
    const scanId = `ws-scan-${Date.now()}-${compactId(`${accountId}|${compact.length}|${capturedAt}`)}`;
    const envelope = { type:'zhike.ws.capture', accountId, capturedAt, scanned:true, coverage, scanId };
    const serializedSize = payload => encodedJsonSize(payload);
    const splitWithinLimit = (items, field) => {
      const chunks = [];
      let current = [];
      for (const item of items) {
        const candidate = [...current, item];
        const probe = { ...envelope, conversations: field === 'conversations' ? candidate : [], messages: field === 'messages' ? candidate : [] };
        if (current.length && (current.length >= 250 || serializedSize(probe) > MAX_BYTES)) { chunks.push(current); current = [item]; }
        else current = candidate;
      }
      if (current.length || !chunks.length) chunks.push(current);
      return chunks;
    };
    const rowChunks = splitWithinLimit(compact, 'conversations');
    const messageChunks = splitWithinLimit(capturedMessages, 'messages');
    const packets = rowChunks.map(rows => ({ ...envelope, conversations:rows, messages:[] }));
    // Attach the first message chunk to the first row chunk when it still fits;
    // otherwise send message-only chunks.  Ingest is idempotent, so chunk order
    // and retries are safe even when WebView2 delivers them asynchronously.
    if (messageChunks.length && packets.length) {
      const candidate = { ...packets[0], messages:messageChunks[0] };
      if (serializedSize(candidate) <= MAX_BYTES) { packets[0] = candidate; messageChunks.shift(); }
    }
    for (const messages of messageChunks) packets.push({ ...envelope, conversations:[], messages });
    packets.forEach((packet, index) => window.chrome.webview.postMessage(JSON.stringify({ ...packet, chunkIndex:index, chunkCount:packets.length })));
  };
  const interruptAllScanForHistoryRetry = () => {
    const run = allScan;
    if (!run) return false;
    allScanGeneration += 1;
    allScan = null;
    lastAllScanAt = Date.now();
    try {
      run.container.scrollTop = run.initial;
      run.container.dispatchEvent(new Event('scroll', { bubbles:true }));
    } catch {}
    // Preserve the partial, idempotent list result before yielding to durable
    // history retry. This is a scheduling interruption, never a completed scan.
    postAllScan([...run.seen.values()], 'page-list-interrupted');
    return true;
  };
  const discoverAll = () => {
    const container = listContainer();
    if (!container) return discover();
    if (readHistoryScan) return { ...discover(), scanned:true, scanning:true, coverage:'read-history-in-progress' };
    const maxConversations = maxConversationCount();
    const current = new Map();
    if (allScan) {
      // A second status/manual read must observe the scan owner's accumulated
      // window, not a new empty map. It remains read-only and never replaces,
      // cancels or advances the active scan.
      const values = [...allScan.seen.values()];
      return { supported:true, conversations:values.filter(row => collectibleConversationType(row.conversationType)), excludedConversations:values.filter(row => !collectibleConversationType(row.conversationType)), scanned:true, scanning:true, coverage:'scan-in-progress' };
    }
    const generation = ++allScanGeneration;
    const initial = Number(container.scrollTop || 0);
    const run = { generation, container, initial, seen: current, rounds: 0, stable: 0, previous: current.size, maxConversations, maxRounds: 0, startedAt: Date.now(), lastProgressAt:Date.now(), lastProgressSignature:'', lastScrollTop:initial, lastMax:0 };
    allScan = run;
    // Always discover from the physical top. Starting from the user's current
    // scroll position permanently omitted every conversation above it.
    container.scrollTop = 0;
    try { container.dispatchEvent(new Event('scroll', { bubbles:true })); } catch {}
    const finish = (coverageOverride = '') => {
      if (allScan !== run || run.generation !== allScanGeneration) return;
      container.scrollTop = run.initial;
      scheduleCollectorPaint(() => {
        if (allScan !== run || run.generation !== allScanGeneration) return;
        allScan = null; lastAllScanAt = Date.now();
        postAllScan([...run.seen.values()], coverageOverride || (run.seen.size ? 'page-list-scanned' : 'none'));
      });
    };
    const step = () => {
      if (allScan !== run || run.generation !== allScanGeneration) return;
      mergeRows(run.seen, readRows(), run.maxConversations);
      const before = Number(container.scrollTop || 0);
      const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
      const stepSize = Math.max(420, Number(container.clientHeight || 420) * 0.85);
      const next = Math.min(max, before + stepSize);
      run.rounds += 1;
      run.lastScrollTop = before;
      run.lastMax = max;
      const progressSignature = `${run.seen.size}|${Math.round(before)}|${Math.round(max)}`;
      if (progressSignature !== run.lastProgressSignature) {
        run.lastProgressSignature = progressSignature;
        run.lastProgressAt = Date.now();
      }
      const estimatedRounds = Math.max(240, Math.ceil(max / Math.max(stepSize, 1)) + 8);
      run.maxRounds = Math.min(5000, Math.max(run.maxRounds || 0, estimatedRounds));
      // A freshly mounted page can report zero scroll extent for a couple of
      // frames. Give layout/virtualization time to measure before concluding
      // that the list has no more pages.
      if (max <= 1 && run.rounds < 3) { scheduleCollectorPaint(step); return; }
      // The bottom window has only been scanned once it is already rendered at
      // the physical bottom. Finishing merely because next === max skips the
      // final virtualized viewport.
      const atBottom = max <= 1 || before >= max - 1;
      // Hitting the configured cap at the physical bottom is still a complete
      // scan (for example, exactly 50,000 chats); only report truncation when
      // there is demonstrably more scroll extent left to inspect.
      const reachedLimit = run.seen.size >= run.maxConversations && !atBottom;
      const deadlineReached = Date.now() - run.startedAt > LIST_SCAN_DEADLINE_MS;
      const stalled = Date.now() - Number(run.lastProgressAt || run.startedAt) >= LIST_SCAN_STALL_MS;
      const safetyYield = run.rounds >= run.maxRounds;
      if (reachedLimit || atBottom || safetyYield || deadlineReached || stalled) {
        finish(reachedLimit ? 'page-list-limit' : deadlineReached || safetyYield || stalled ? 'page-list-interrupted' : '');
        return;
      }
      container.scrollTop = next;
      container.dispatchEvent(new Event('scroll', { bubbles:true }));
      // Two frames let the virtualized list unmount/mount its next window.
      scheduleCollectorPaint(step);
    };
    scheduleCollectorPaint(step);
    return { supported:true, conversations:[...current.values()].filter(row => collectibleConversationType(row.conversationType)), excludedConversations:[...current.values()].filter(row => !collectibleConversationType(row.conversationType)), scanned:true, scanning:true, coverage:'scan-started' };
  };
   const waitForMessagePane = () => {
     const selectors = [
       '#main [data-testid="conversation-panel-messages"]',
       '#main [data-testid="conversation-panel-body"]',
       '#main [data-scroll-capture]',
       '#main .copyable-area',
       '#main [aria-label*="Messages" i]',
       '#main [aria-label*="消息"]',
       '#main [role="application"]'
     ];
     const candidates = [], seen = new Set();
     const add = node => { if (node && !seen.has(node)) { seen.add(node); candidates.push(node); } };
     for (const selector of selectors) { try { for (const node of document.querySelectorAll(selector)) add(node); } catch {} }
     // Current WhatsApp builds frequently remove the historical data-testid
     // attributes.  Derive the scroll viewport from a rendered message's
     // ancestors so full-history collection survives those markup changes.
     let sample = null;
     try { sample = document.querySelector('#main [data-pre-plain-text], #main .message-in, #main .message-out, #main span.selectable-text'); } catch {}
     for (let node = sample?.parentElement, depth = 0; node && depth < 16; node = node.parentElement, depth += 1) {
       add(node);
       if (node.id === 'main') break;
     }
     const scrollable = candidates.filter(node => Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 4);
     scrollable.sort((left, right) => Number(right.scrollHeight || 0) - Number(left.scrollHeight || 0));
     const populated = candidates.find(node => {
       try { return Boolean(node.querySelector?.('[data-pre-plain-text], .message-in, .message-out, [data-testid="msg-container"], span.selectable-text')); }
       catch { return false; }
     });
     return scrollable[0] || populated || candidates[0] || null;
   };
   const currentConversationIdentity = () => {
     const header = document.querySelector('[data-testid="conversation-header"], header [data-testid*="conversation"], #main header');
     if (!header) return { key:'', title:'', values:[] };
     const primaryTitles = primaryConversationTitles(header);
     const values = [
       header.getAttribute?.('data-id'), header.getAttribute?.('data-chat-id'), header.getAttribute?.('aria-label'),
       header.querySelector?.('[data-id]')?.getAttribute?.('data-id'), header.querySelector?.('[data-chat-id]')?.getAttribute?.('data-chat-id'),
       ...primaryTitles, header.querySelector?.('[title]')?.getAttribute?.('title'), text(header),
     ].map(clean).filter(Boolean);
     return { key:values[0] || '', title:values.at(-1) || '', values };
   };
    const currentConversationType = row => {
      const rowType = clean(row?.conversationType || 'unknown').toLocaleLowerCase();
      const header = document.querySelector('[data-testid="conversation-header"], header [data-testid*="conversation"], #main header');
      const identity = currentConversationIdentity();
      const headerEvidence = header ? conversationTypeFromNode(header, identity.key, identity.title) : { conversationType:'unknown', isGroup:false, source:'none' };
      if (rowType === 'vip_group' || headerEvidence.conversationType === 'vip_group') return { conversationType:'vip_group', isGroup:true, vipGroup:true, source:rowType === 'vip_group' ? clean(row?.conversationTypeSource || 'row-vip-group') : headerEvidence.source };
      if (rowType === 'group' || headerEvidence.conversationType === 'group') return { conversationType:'group', isGroup:true, vipGroup:false, source:rowType === 'group' ? clean(row?.conversationTypeSource || 'row') : headerEvidence.source };
      if (rowType === 'direct' && !['group','vip_group'].includes(headerEvidence.conversationType)) return { conversationType:'direct', isGroup:false, source:clean(row?.conversationTypeSource || 'row-direct') };
      if (rowType === 'unknown' && headerEvidence.conversationType === 'direct') return headerEvidence;
      return { conversationType:'unknown', isGroup:false, source:'unresolved' };
    };
   const currentConversationKey = fallback => currentConversationIdentity().key || clean(fallback || 'visible');
   const comparableIdentity = value => clean(value).toLocaleLowerCase().replace(/^\+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
   const machineIdentity = value => {
     const raw = clean(value).toLocaleLowerCase();
     const digits = raw.replace(/\D+/g, '');
     return raw.includes('@') || /^(?:true|false)_/i.test(raw) || digits.length >= 7 && /^[+\d\s().-]+$/.test(raw);
   };
   const matchesCurrentConversation = row => {
     const expected = [row?.conversationKey, row?.externalId, ...(Array.isArray(row?.__identityTitles) ? row.__identityTitles : []), row?.displayName, row?.title].map(value => ({ raw:clean(value), comparable:comparableIdentity(value) })).filter(item => item.comparable);
     const observed = currentConversationIdentity().values.map(value => ({ raw:clean(value), comparable:comparableIdentity(value) })).filter(item => item.comparable);
     return expected.some(left => observed.some(right => left.comparable === right.comparable || (
       machineIdentity(left.raw) && machineIdentity(right.raw) && left.comparable.length >= 7 && right.comparable.length >= 7
       && (right.comparable.endsWith(left.comparable) || left.comparable.endsWith(right.comparable))
     )));
   };
   const waitForConversationIdentity = (row, onReady, onFailure, startedAt = Date.now()) => {
     if (!readHistoryScan) return;
     if (matchesCurrentConversation(row)) { onReady(); return; }
     if (Date.now() - startedAt >= 8000) { onFailure(); return; }
     scheduleCollectorTask(() => waitForConversationIdentity(row, onReady, onFailure, startedAt), 160);
   };
   const timestampTextFromPreamble = preamble => {
     const raw = String(preamble ?? '');
     const bracket = raw.match(/\[([^\]]+)\]/);
     return String(bracket?.[1] ?? raw).trim().slice(0, 500);
   };
   const parseMessageTimestamp = preamble => {
     const ascii = String(preamble ?? '').replace(/[０-９]/g, value => String(value.charCodeAt(0) - 0xFEE0));
     const source = timestampTextFromPreamble(ascii).replace(/：/g, ':').trim();
     const time = source.match(/(?:(上午|下午|晚上|中午|凌晨|am|pm)\s*)?(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?\s*(上午|下午|晚上|中午|凌晨|am|pm)?/i);
     if (!time) return '';
     let hour = Number(time[2]);
     const minute = Number(time[3]);
     const meridiem = String(time[1] || time[4] || '').toLowerCase();
     if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';
     if ((meridiem === 'pm' || meridiem === '下午' || meridiem === '晚上' || meridiem === '中午') && hour < 12) hour += 12;
     if ((meridiem === 'am' || meridiem === '上午' || meridiem === '凌晨') && hour === 12) hour = 0;
     let year = 0, month = 0, day = 0;
     let date = source.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
     if (date) [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
     if (!date) {
       date = source.match(/(?:^|\D)(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:\D|$)/);
       if (date) [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
     }
     if (!date) {
       date = source.match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:\D|$)/);
       if (date) {
         const first = Number(date[1]), second = Number(date[2]);
         year = Number(date[3]); if (year < 100) year += 2000;
         const locale = clean(globalThis.navigator?.language || '').toLowerCase();
         const monthFirst = second > 12 || (first <= 12 && second <= 12 && /^en-us\b/.test(locale));
         [month, day] = monthFirst ? [first, second] : [second, first];
       }
     }
     if (!year || !month || !day) return '';
     const result = new Date(year, month - 1, day, hour, minute, 0, 0);
     if (!Number.isFinite(result.getTime()) || result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day || result.getHours() !== hour || result.getMinutes() !== minute) return '';
     return result.toISOString();
   };
   const resolveMessageSender = (node, wrapper, rawPreamble, direction, conversationType) => {
     if (direction === 'outgoing') return {
       senderId:`self:${accountId}`, senderName:'我', senderPhone:'',
       senderIdentitySource:'account-self', senderIdentityTrusted:true,
     };
     if (conversationType !== 'vip_group') return {
       senderId:'', senderName:'', senderPhone:'', senderIdentitySource:'direct-peer', senderIdentityTrusted:false,
     };
     const candidates = [];
     const add = (value, source) => {
       const normalized = clean(value);
       if (normalized && !/@g\.us(?:\b|$)/i.test(normalized)) candidates.push({ value:normalized, source });
     };
     const inspect = target => {
       if (!target) return;
       for (const name of ['data-sender-id','data-author','data-participant','data-jid','data-contact-id'])
         add(target.getAttribute?.(name), name);
     };
     for (let current = wrapper || node, depth = 0; current && depth < 8; current = current.parentElement, depth += 1) inspect(current);
     try { for (const target of wrapper?.querySelectorAll?.('[data-sender-id], [data-author], [data-participant], [data-jid], [data-contact-id]') || []) inspect(target); } catch {}
     const preambleAuthor = clean(String(rawPreamble ?? '').match(/\]\s*([^:\n]{1,160})\s*:\s*$/)?.[1] || '');
     const stableJid = candidates.find(item => /@(?:s\.whatsapp\.net|c\.us|lid)(?:\b|$)/i.test(item.value)) || null;
     const stablePhone = candidates.find(item => {
       const digits = item.value.replace(/\D/g, '');
       return digits.length >= 7 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(item.value);
     }) || null;
     const senderId = clean(stableJid?.value || '');
     const idDigits = senderId.replace(/@.*$/, '').replace(/\D/g, '');
     const stablePhoneDigits = clean(stablePhone?.value || '').replace(/\D/g, '');
     const authorDigits = preambleAuthor.replace(/\D/g, '');
     const authorLooksPhone = authorDigits.length >= 7 && authorDigits.length <= 15 && /^\+?[\d\s().-]+$/.test(preambleAuthor);
     const senderPhone = idDigits.length >= 7 && idDigits.length <= 15 ? idDigits : stablePhoneDigits || (authorLooksPhone ? authorDigits : '');
     const senderName = (preambleAuthor && !authorLooksPhone ? preambleAuthor : '').slice(0, 200);
     return {
       senderId:senderId.slice(0, 200), senderName, senderPhone,
       senderIdentitySource:senderId ? 'sender-jid' : senderPhone ? 'sender-phone' : 'unresolved',
       senderIdentityTrusted:Boolean(senderId || senderPhone),
     };
   };
   const captureHistory = (row, captureRound = 0) => {
     const conversationKey = clean(row?.conversationKey || row?.externalId || '');
     const conversationType = clean(row?.conversationType || 'unknown').toLocaleLowerCase();
     const messages = [], unresolvedDirectionKeys = new Set(), seen = new Set(), root = waitForMessagePane() || document;
      let unresolvedDiagnosticNode = null;
     let nodes = [];
     for (const selector of ['[data-testid="msg-container"]', '.message-in', '.message-out', '[data-pre-plain-text]', '[data-id*="message"]']) { try { nodes.push(...root.querySelectorAll(selector)); } catch {} }
     if (!nodes.length && root === document) { try { nodes = [...document.querySelectorAll('#main [data-testid="msg-container"], #main .message-in, #main .message-out, #main [data-pre-plain-text]')]; } catch {} }
     nodes.forEach((node, domIndex) => {
       const evidence = resolveMessageDirection(node);
       const wrapper = evidence.wrapper || node;
       if (seen.has(wrapper)) return;
       seen.add(wrapper);
       const body = messageBodyText(wrapper);
       if (!body.trim() || /scan to log in|扫码登录/i.test(clean(body))) return;
       const rawPreamble = String(node.getAttribute?.('data-pre-plain-text') || wrapper.querySelector?.('[data-pre-plain-text]')?.getAttribute?.('data-pre-plain-text') || '');
       const preamble = clean(rawPreamble);
       const direction = evidence.direction;
       if (!direction) {
         unresolvedDirectionKeys.add(compactId(`${conversationKey}|${preamble}|${body}`));
          unresolvedDiagnosticNode = unresolvedDiagnosticNode || node;
         return;
       }
       const explicitExternalMessageId = clean(evidence.externalMessageId) || messageExternalId(node, wrapper);
       const sender = resolveMessageSender(node, wrapper, rawPreamble, direction, conversationType);
       const syntheticId = `wa-${compactId(`${conversationKey}|${sender.senderId || sender.senderPhone || sender.senderName}|${preamble}|${direction}|${body}`)}`;
       const externalMessageId = explicitExternalMessageId || syntheticId;
       const legacyExternalMessageId = legacyMessageExternalId(node, conversationKey, rawPreamble, externalMessageId);
       const sentAt = parseMessageTimestamp(rawPreamble);
       messages.push({ conversationKey, externalMessageId, legacyExternalMessageId, directionSource:evidence.source, conversationType, isGroup:conversationType === 'vip_group', vipGroup:conversationType === 'vip_group', ...sender, body, direction, sentAt, timestampText:timestampTextFromPreamble(rawPreamble), timestampSource:sentAt ? 'whatsapp-preamble' : 'unparsed', cursor:externalMessageId, preamble, captureRound, domIndex });
     });
      if (unresolvedDiagnosticNode) postDirectionDiagnostic(unresolvedDiagnosticNode);
     return { root, messages, unresolvedDirectionKeys };
   };
   const orderedHistoryMessages = run => [...run.currentMessages.values()].sort((left, right) => {
     const time = clean(left.sentAt).localeCompare(clean(right.sentAt));
     if (left.sentAt && right.sentAt && time) return time;
     return Number(right.captureRound || 0) - Number(left.captureRound || 0) || Number(left.domIndex || 0) - Number(right.domIndex || 0) || clean(left.externalMessageId).localeCompare(clean(right.externalMessageId));
   }).map((item, index) => ({ ...item, order:index + 1 }));
   const postHistoryPackets = (row, sourceItems, complete, coverage, metadata = {}) => {
     if (!window.chrome?.webview) return;
     const items = sourceItems.map(item => ({
       conversationKey:clean(item.conversationKey).slice(0, 200), externalMessageId:clean(item.externalMessageId).slice(0, 200),
       legacyExternalMessageId:clean(item.legacyExternalMessageId).slice(0, 200), directionSource:clean(item.directionSource).slice(0, 40),
       body:String(item.body ?? ''), direction:clean(item.direction).slice(0, 20), sentAt:clean(item.sentAt).slice(0, 80),
        conversationType:clean(item.conversationType || row.conversationType || 'unknown').slice(0, 20),
        isGroup:item.isGroup === true || row.conversationType === 'vip_group', vipGroup:item.vipGroup === true || row.conversationType === 'vip_group',
       senderId:clean(item.senderId).slice(0, 200), senderName:clean(item.senderName).slice(0, 200),
       senderPhone:clean(item.senderPhone).slice(0, 40), senderIdentitySource:clean(item.senderIdentitySource).slice(0, 40),
       senderIdentityTrusted:item.senderIdentityTrusted === true,
       timestampText:String(item.timestampText ?? '').slice(0, 500), timestampSource:clean(item.timestampSource).slice(0, 40),
       cursor:clean(item.cursor).slice(0, 240), order:Number(item.order || 0),
     }));
     const capturedAt = new Date().toISOString();
     const scanId = readHistoryScan?.id || `ws-history-${Date.now()}`;
     const chunks = [];
     let current = [];
     for (const item of items) {
       const candidate = [...current, item];
       const probe = JSON.stringify(candidate);
       if (current.length && (current.length >= 250 || encodedJsonSize(probe) > 600000)) { chunks.push(current); current = [item]; }
       else current = candidate;
     }
     if (current.length || !chunks.length) chunks.push(current);
     chunks.forEach((messages, chunkIndex) => {
       const isFinal = complete && chunkIndex === chunks.length - 1;
       const checkpoint = {
         index:row.index, conversationKey:row.conversationKey, externalId:row.externalId,
         displayName:clean(row.displayName).slice(0, 120), title:clean(row.title || row.displayName).slice(0, 120),
         previewText:clean(row.previewText || row.lastMessagePreview || row.preview).slice(0, 180), lastMessageAt:clean(row.lastMessageAt).slice(0, 80),
         unreadCount:Number(row.unreadCount || 0), cursor:clean(row.cursor).slice(0, 240), lastMessageFingerprint:checkpointFingerprint(row),
          conversationType:clean(row.conversationType || 'unknown').slice(0, 20), isGroup:row.conversationType === 'group' || row.conversationType === 'vip_group' || row.isGroup === true,
         vipGroup:row.conversationType === 'vip_group' || row.vipGroup === true,
         directionVersion:4,
         previewOnly:!isFinal, visibleOnly:!isFinal, historyLoaded: isFinal, historyMessageCount:Math.max(items.length, Number(metadata.historyMessageCount || 0)),
         oversizedMessageCount:Math.max(0, Number(metadata.oversizedMessageCount || 0)), maxCapturedBodyLength:Math.max(0, Number(metadata.maxCapturedBodyLength || 0)),
         directionUnresolvedCount:Math.max(0, Number(metadata.directionUnresolvedCount || 0)),
          coverage:clean(row.conversationType === 'group' ? 'excluded-group' : isFinal ? coverage : complete ? 'read-history-chunk' : coverage).slice(0, 40),
          collectionStatus:row.conversationType === 'group' ? 'skipped-group' : isFinal ? 'completed' : complete ? 'collecting' : 'retryable',
       };
       const packet = { type:'zhike.ws.capture', accountId, capturedAt, scanned:true, coverage:checkpoint.coverage, scanId, historyPacket:true, historyFinal:isFinal, chunkIndex, chunkCount:chunks.length, conversations:[checkpoint], messages };
       window.chrome.webview.postMessage(JSON.stringify(packet));
     });
   };
    let readHistoryScan = null;
    let incrementalHistoryTimer = null;
    let highPriorityHistoryRetryPending = false;
   const HISTORY_ATTEMPT_DEADLINE_MS = 4 * 60 * 1000;
   const HISTORY_TOP_QUIET_MS = 4000;
   const isHistoryTopBusy = pane => {
     if (!pane) return false;
     if (clean(pane.getAttribute?.('aria-busy')).toLocaleLowerCase() === 'true') return true;
     // Only accept an explicit history-loading indicator near the top of this
     // message pane. Media/audio progress controls inside a message bubble must
     // never hold the whole conversation open indefinitely.
     let indicators = [];
     try {
       indicators = [...pane.querySelectorAll?.('[data-testid*="history" i][role="progressbar"], [data-testid*="history" i][aria-busy="true"], [data-testid*="loading-messages" i][role="progressbar"]') || []];
     } catch {}
     let paneRect = null;
     try { paneRect = pane.getBoundingClientRect?.() || null; } catch {}
     for (const indicator of indicators) {
       try {
         if (indicator.closest?.('[data-testid="msg-container"], .message-in, .message-out, [data-pre-plain-text]')) continue;
         if (!paneRect) return true;
         const rect = indicator.getBoundingClientRect?.();
         const topLimit = paneRect.top + Math.min(160, Math.max(72, Number(paneRect.height || 0) * 0.18));
         if (rect && rect.bottom >= paneRect.top && rect.top <= topLimit) return true;
       } catch {}
     }
     return false;
   };
   const collectAllRead = () => {
     if (readHistoryScan) return { supported:true, started:true, scanning:true, scanId:readHistoryScan.id, skippedUnread:readHistoryScan.skipped.map(item => ({ conversationKey:item.conversationKey, displayName:item.displayName, unreadCount:item.unreadCount, status:'skipped_unread' })) };
     const container = listContainer();
     if (!container) return { supported:false, error:'当前 WS 页面未找到会话列表。' };
     if (allScan) {
       allScanGeneration += 1;
       allScan = null;
     }
     if (allScanTimer) { cancelCollectorTask(allScanTimer); allScanTimer = null; }
     const initialIdentity = currentConversationIdentity();
      const run = { id:`ws-read-${Date.now()}-${compactId(`${accountId}|${Date.now()}`)}`, container, initial:Number(container.scrollTop || 0), initialIdentity, seen:new Map(), pending:[], attempted:new Set(), processed:new Set(), skipped:[], retryable:[], excludedGroups:new Set(), unresolvedTypes:new Set(), current:null, currentMessages:new Map(), currentDirectionUnresolved:new Set(), captureRound:0, rounds:0, startedAt:Date.now() };
     readHistoryScan = run;
     postCollectorEvent('collection-run-start', { event:'collection-run-start', coverage:'read-history-start', reason:'', discovered:0, processed:0, attempted:0, retryable:0, skippedUnreadCount:0 });
     const skippedByKey = new Set();
     const addWindowRows = () => {
       const windowRows = readRows();
       let readCount = 0, skipCount = 0, domNodeKnownCount = 0;
       for (const row of windowRows) {
         if (row.__node) domNodeKnownCount += 1;
         const key = row.conversationKey || `${row.displayName}|${row.lastMessagePreview}`;
         if (!key) continue;
          if (row.conversationType === 'group') {
            run.excludedGroups.add(key);
            run.seen.set(key, { ...row, historyLoaded:false, previewOnly:true, visibleOnly:true, coverage:'excluded-group', status:'skipped-group' });
            continue;
          }
          if (!collectibleConversationType(row.conversationType)) {
            run.unresolvedTypes.add(key);
            run.seen.set(key, { ...row, historyLoaded:false, previewOnly:true, visibleOnly:true, coverage:'conversation-type-unresolved', status:'retryable' });
            continue;
          }
         const signal = unreadState(row);
         if (signal.unread || signal.uncertainUnread) {
           skipCount += 1;
           if (!skippedByKey.has(key)) { skippedByKey.add(key); run.skipped.push({ ...row, status:'skipped_unread' }); }
           run.seen.set(key, { ...row, status:'skipped_unread' });
           continue;
         }
         readCount += 1;
         if (!run.seen.has(key)) run.seen.set(key, row);
         if (checkpointMatches(row)) {
           const acknowledged = checkpointState.completed?.[checkpointKey(row)];
           run.processed.add(key);
           run.seen.set(key, { ...row, historyLoaded:true, historyMessageCount:Math.max(0, Number(acknowledged?.historyMessageCount || 0)), previewOnly:false, visibleOnly:false, coverage:'read-history-checkpoint', status:'completed' });
           continue;
         }
         if (!run.attempted.has(key) && !run.processed.has(key) && !run.pending.some(item => item.conversationKey === key)) run.pending.push(row);
       }
       const diagnosticSignature = `${windowRows.length}|${readCount}|${skipCount}|${run.pending.length}|${domNodeKnownCount}|${run.seen.size}|${run.processed.size}|${run.attempted.size}`;
       if (run.lastWindowDiagnostic !== diagnosticSignature) {
         run.lastWindowDiagnostic = diagnosticSignature;
          postCollectorEvent('collection-window', { event:'collection-window', coverage:'read-history-window', reason:'', rowCount:windowRows.length, readCount, skipCount, pendingCount:run.pending.length, domNodeKnownCount, discovered:run.seen.size, processed:run.processed.size, attempted:run.attempted.size, retryable:run.retryable.length, skippedUnreadCount:run.skipped.length, excludedGroupCount:run.excludedGroups.size, conversationTypeUnresolvedCount:run.unresolvedTypes.size });
       }
     };
     const finishRun = (complete = true, reason = '') => {
       if (readHistoryScan !== run) return;
       readHistoryScan = null;
       try { run.container.scrollTop = run.initial; run.container.dispatchEvent(new Event('scroll', { bubbles:true })); } catch {}
       scheduleCollectorPaint(() => {
         const restore = readRows().find(row => run.initialIdentity.values.some(value => comparableIdentity(value) === comparableIdentity(row.conversationKey) || comparableIdentity(value) === comparableIdentity(row.displayName)) && !unreadState(row).unread);
         try { restore?.__node?.click?.(); } catch {}
       });
       postAllScan([...run.seen.values()], complete ? 'read-history-list' : 'read-history-interrupted', []);
       const needsRetry = !complete || run.retryable.length > 0;
        highPriorityHistoryRetryPending = needsRetry;
       const finishReason = reason || (needsRetry ? 'retryable-pending' : 'completed');
        const eventDetail = { scanId:run.id, coverage:complete ? 'read-history-complete' : 'read-history-interrupted', reason:finishReason, processed:run.processed.size, discovered:run.seen.size, attempted:run.attempted.size, retryable:run.retryable.length, skippedUnreadCount:run.skipped.length, excludedGroupCount:run.excludedGroups.size, conversationTypeUnresolvedCount:run.unresolvedTypes.size, skippedUnread:run.skipped.map(item => ({ conversationKey:item.conversationKey, displayName:item.displayName, unreadCount:item.unreadCount, status:'skipped_unread' })) };
       postCollectorEvent('collection-run-finish', { event:'collection-run-finish', ...eventDetail });
       if (needsRetry) postCollectorEvent('collection-retry-scheduled', { event:'collection-retry-scheduled', ...eventDetail });
       else postCollectorEvent('collection-complete', { event:'collection-complete', ...eventDetail });
       // Re-evaluate the restored top window after the pass. A message sent on
       // the phone while a lower list window was being scanned then produces a
       // fresh fingerprint and starts an incremental pass. Failed identities
       // and interrupted passes resume from durable checkpoints.
       scheduleCollectorTask(() => emit(false), 500);
        if (needsRetry) scheduleIncrementalReadHistory(3500, true);
     };
     const finishCurrent = (row, complete, coverage) => {
        if (!collectibleConversationType(row.conversationType)) {
          const key = row.conversationKey;
          const isGroup = row.conversationType === 'group';
          const blockedCoverage = isGroup ? 'excluded-group' : 'conversation-type-unresolved';
          postHistoryPackets(row, [], false, blockedCoverage, { historyMessageCount:0, directionUnresolvedCount:0 });
          run.seen.set(key, { ...row, historyLoaded:false, previewOnly:true, visibleOnly:true, coverage:blockedCoverage, status:isGroup ? 'skipped-group' : 'retryable' });
          if (isGroup) run.excludedGroups.add(key); else run.unresolvedTypes.add(key);
          run.current = null; run.currentMessages = new Map(); run.currentDirectionUnresolved = new Set(); run.captureRound = 0;
          scheduleCollectorTask(processNext, 0);
          return;
        }
       const items = orderedHistoryMessages(run);
       const oversizedItems = items.filter(item => String(item.body ?? '').length > HISTORY_BODY_LIMIT);
       const directionUnresolvedCount = run.currentDirectionUnresolved.size;
       const packetComplete = complete && oversizedItems.length === 0 && directionUnresolvedCount === 0;
       const packetCoverage = oversizedItems.length ? 'read-history-body-too-large' : directionUnresolvedCount ? 'read-history-direction-unresolved' : coverage;
       const transportItems = oversizedItems.length ? items.filter(item => String(item.body ?? '').length <= HISTORY_BODY_LIMIT) : items;
       postHistoryPackets(row, transportItems, packetComplete, packetCoverage, { historyMessageCount:items.length + directionUnresolvedCount, oversizedMessageCount:oversizedItems.length, maxCapturedBodyLength:items.reduce((max, item) => Math.max(max, String(item.body ?? '').length), 0), directionUnresolvedCount });
       const key = row.conversationKey;
       const observed = run.seen.get(key) || row;
       run.seen.set(key, { ...observed, historyLoaded:packetComplete, historyMessageCount:items.length, previewOnly:!packetComplete, visibleOnly:!packetComplete, coverage:packetCoverage, status:packetComplete ? 'completed' : 'retryable' });
       if (packetComplete) run.processed.add(key); else run.retryable.push({ conversationKey:key, coverage:packetCoverage, historyMessageCount:items.length + directionUnresolvedCount, oversizedMessageCount:oversizedItems.length, directionUnresolvedCount, status:'retryable' });
       run.current = null; run.currentMessages = new Map(); run.currentDirectionUnresolved = new Set(); run.captureRound = 0;
       scheduleCollectorTask(processNext, packetComplete ? 100 : 300);
     };
     const collectMessageFrames = (row, pane, state = { startedAt:Date.now(), topReachedAt:0, lastHistoryGrowthAt:Date.now(), lastHistorySignature:'' }) => {
       if (readHistoryScan !== run || run.current?.conversationKey !== row.conversationKey) return;
       if (!matchesCurrentConversation(row)) { finishCurrent(row, false, 'read-history-identity-lost'); return; }
       const captured = captureHistory(row, run.captureRound++);
       for (const key of captured.unresolvedDirectionKeys || []) run.currentDirectionUnresolved.add(key);
       for (const item of captured.messages) {
         const key = item.externalMessageId || `${item.conversationKey}\u001f${item.preamble}\u001f${item.direction}\u001f${item.body}`;
         if (key && !run.currentMessages.has(key)) run.currentMessages.set(key, item);
       }
       pane = pane || captured.root;
       const paneKnown = Boolean(pane && pane !== document && typeof pane.scrollTop === 'number');
       if (!paneKnown) { finishCurrent(row, false, 'read-history-pane-unresolved'); return; }
       const count = run.currentMessages.size;
       const height = Number(pane.scrollHeight || 0);
       const before = Number(pane.scrollTop || 0);
       const noScrollableHistory = height <= Number(pane.clientHeight || 0) + 4;
       const atTop = before <= 1 || noScrollableHistory;
       const now = Date.now();
       const historySignature = `${count}|${height}`;
       const historyGrew = !state.lastHistorySignature || historySignature !== state.lastHistorySignature;
       const topReachedAt = atTop ? (Number(state.topReachedAt || 0) || now) : 0;
       let lastHistoryGrowthAt = historyGrew ? now : Number(state.lastHistoryGrowthAt || state.startedAt || now);
       const historyTopBusy = atTop && isHistoryTopBusy(pane);
       // Clearing an explicit loader starts a fresh quiet window; otherwise a
       // loader that disappeared between polls could make us finalize early.
       if (historyTopBusy) lastHistoryGrowthAt = now;
       if (now - state.startedAt > HISTORY_ATTEMPT_DEADLINE_MS) {
         finishCurrent(row, false, 'read-history-retryable');
         postCollectorEvent('history-retryable', { event:'history-retryable', scanId:run.id, coverage:'read-history-retryable', reason:'attempt-deadline', messageCount:count, discovered:run.seen.size, processed:run.processed.size, attempted:run.attempted.size, retryable:run.retryable.length, skippedUnreadCount:run.skipped.length });
         return;
       }
       const quietSince = Math.max(topReachedAt, lastHistoryGrowthAt);
       if (atTop && !historyTopBusy && now - quietSince >= HISTORY_TOP_QUIET_MS) { finishCurrent(row, true, 'read-history'); return; }
       const next = atTop ? 0 : Math.max(0, before - Math.max(360, Number(pane.clientHeight || 480) * 0.82));
       try { pane.scrollTop = next; pane.dispatchEvent(new Event('scroll', { bubbles:true })); } catch {}
       scheduleCollectorTask(() => collectMessageFrames(row, pane, { startedAt:state.startedAt, topReachedAt, lastHistoryGrowthAt, lastHistorySignature:historySignature }), atTop ? 350 : 140);
     };
     const processNext = () => {
       if (readHistoryScan !== run) return;
       addWindowRows();
       const row = run.pending.shift();
       if (row) {
         const currentRow = readRows().find(item => item.conversationKey === row.conversationKey) || row;
          if (!collectibleConversationType(currentRow.conversationType)) {
            const key = currentRow.conversationKey;
            if (currentRow.conversationType === 'group') {
              run.excludedGroups.add(key);
              run.seen.set(key, { ...currentRow, historyLoaded:false, coverage:'excluded-group', status:'skipped-group' });
            } else {
              run.unresolvedTypes.add(key);
              run.seen.set(key, { ...currentRow, historyLoaded:false, coverage:'conversation-type-unresolved', status:'retryable' });
            }
            scheduleCollectorTask(processNext, 0); return;
          }
         const signal = unreadState(currentRow);
         if (signal.unread || signal.uncertainUnread || !currentRow.__node) {
           if (!skippedByKey.has(currentRow.conversationKey)) { skippedByKey.add(currentRow.conversationKey); run.skipped.push({ ...currentRow, status:'skipped_unread' }); }
           scheduleCollectorTask(processNext, 0); return;
         }
         if (checkpointMatches(currentRow)) {
           const acknowledged = checkpointState.completed?.[checkpointKey(currentRow)];
           run.processed.add(currentRow.conversationKey);
           run.seen.set(currentRow.conversationKey, { ...currentRow, historyLoaded:true, historyMessageCount:Math.max(0, Number(acknowledged?.historyMessageCount || 0)), previewOnly:false, visibleOnly:false, coverage:'read-history-checkpoint', status:'completed' });
           scheduleCollectorTask(processNext, 0); return;
         }
         if (run.attempted.has(currentRow.conversationKey)) { scheduleCollectorTask(processNext, 0); return; }
         // Mark before clicking. A failed identity/pane/click is retryable in a
         // later pass, but it must never be reinserted ahead of later customers
         // forever during the current pass.
         run.attempted.add(currentRow.conversationKey);
         postCollectorEvent('collection-attempt', { event:'collection-attempt', coverage:'read-history-attempt', reason:'', discovered:run.seen.size, processed:run.processed.size, attempted:run.attempted.size, retryable:run.retryable.length, skippedUnreadCount:run.skipped.length });
         run.current = currentRow; run.currentMessages = new Map(); run.currentDirectionUnresolved = new Set(); run.captureRound = 0;
         try {
           const candidates = [currentRow.__node, ...(currentRow.__node.querySelectorAll?.('[role="gridcell"], [data-testid="cell-frame-container"], [tabindex="0"]') || [])];
           const isAuxiliary = node => {
             const role = clean(node?.getAttribute?.('role')).toLowerCase();
             const label = clean(node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || node?.getAttribute?.('data-testid')).toLowerCase();
             return role === 'menuitem' || role === 'checkbox' || /menu|avatar|profile|more|context|select|菜单|头像|更多|选择/.test(label);
           };
           const wantedName = comparableIdentity(currentRow.displayName || currentRow.title);
           const namedLeaf = [...(currentRow.__node.querySelectorAll?.('[title], span[dir="auto"]') || [])].find(node => {
             const value = comparableIdentity(node?.getAttribute?.('title') || text(node));
             return wantedName && value === wantedName;
           });
           const namedTarget = namedLeaf?.closest?.('[role="gridcell"], [data-testid="cell-frame-container"], [tabindex="0"]') || namedLeaf;
           const target = (namedTarget && !isAuxiliary(namedTarget) ? namedTarget : null)
             || candidates.find(node => node?.getAttribute?.('tabindex') === '0' && !isAuxiliary(node))
             || candidates.find(node => !isAuxiliary(node))
             || currentRow.__node;
           target.scrollIntoView?.({ block:'nearest' });
           target.focus?.({ preventScroll:true });
           if (typeof target.dispatchEvent === 'function') {
             const rect = target.getBoundingClientRect?.();
             const clientX = rect && Number.isFinite(rect.left) && Number.isFinite(rect.width) ? rect.left + rect.width / 2 : 0;
             const clientY = rect && Number.isFinite(rect.top) && Number.isFinite(rect.height) ? rect.top + rect.height / 2 : 0;
             const down = { bubbles:true, cancelable:true, composed:true, view:window, button:0, buttons:1, detail:1, clientX, clientY, pointerType:'mouse', isPrimary:true };
             const up = { ...down, buttons:0 };
             const PointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
             if (typeof PointerCtor === 'function') target.dispatchEvent(new PointerCtor('pointerdown', down));
             if (typeof MouseEvent === 'function') target.dispatchEvent(new MouseEvent('mousedown', down));
             if (typeof PointerCtor === 'function') target.dispatchEvent(new PointerCtor('pointerup', up));
             if (typeof MouseEvent === 'function') target.dispatchEvent(new MouseEvent('mouseup', up));
           }
           target.click?.();
         } catch { finishCurrent(currentRow, false, 'read-history-click-failed'); return; }
         waitForConversationIdentity(currentRow,
            () => {
              const typeEvidence = currentConversationType(currentRow);
              if (!collectibleConversationType(typeEvidence.conversationType)) {
                finishCurrent({ ...currentRow, conversationType:typeEvidence.conversationType, isGroup:typeEvidence.isGroup, vipGroup:typeEvidence.vipGroup === true, conversationTypeSource:typeEvidence.source }, false, typeEvidence.conversationType === 'group' ? 'excluded-group' : 'conversation-type-unresolved');
                return;
              }
              collectMessageFrames({ ...currentRow, conversationType:typeEvidence.conversationType, isGroup:typeEvidence.isGroup, vipGroup:typeEvidence.vipGroup === true }, waitForMessagePane());
            },
           () => finishCurrent(currentRow, false, 'read-history-identity-unconfirmed'));
         return;
       }
       const before = Number(run.container.scrollTop || 0);
       const max = Math.max(0, Number(run.container.scrollHeight || 0) - Number(run.container.clientHeight || 0));
       const next = Math.min(max, before + Math.max(420, Number(run.container.clientHeight || 420) * 0.85));
       run.rounds += 1;
       const atBottom = max <= 1 || before >= max - 1;
       if (atBottom) { finishRun(true); return; }
       if (run.seen.size >= maxConversationCount()) { finishRun(false, 'conversation-limit'); return; }
       run.container.scrollTop = next;
       try { run.container.dispatchEvent(new Event('scroll', { bubbles:true })); } catch {}
       scheduleCollectorPaint(processNext);
     };
     // A restart always scans from the top, but durable fingerprints prevent
     // reopening completed unchanged chats. This is slower than a fragile DOM
     // cursor and guarantees that rows above the last viewport are not lost.
     run.container.scrollTop = 0;
     try { run.container.dispatchEvent(new Event('scroll', { bubbles:true })); } catch {}
     scheduleCollectorPaint(processNext);
     return { supported:true, started:true, scanning:true, scanId:run.id, resumed:Object.keys(checkpointState.completed || {}).length > 0, skippedUnread:[] };
   };
   window.__zhikeWsCollectAllRead = collectAllRead;
   window.__zhikeWsCollectorDiagnostics = Object.freeze({ matchesCurrentConversation, parseMessageTimestamp, checkpointMatches, isHistoryTopBusy });
    const scheduleIncrementalReadHistory = (delay = 1800, highPriority = false) => {
      if (highPriority) highPriorityHistoryRetryPending = true;
      if (readHistoryScan || incrementalHistoryTimer) return;
     incrementalHistoryTimer = scheduleCollectorTask(() => {
       incrementalHistoryTimer = null;
        const retryPriority = highPriorityHistoryRetryPending;
        if (allScan) {
          if (!retryPriority) { scheduleIncrementalReadHistory(1200); return; }
          interruptAllScanForHistoryRetry();
        }
        if (Date.now() - lastListInteractionAt < 1500) { scheduleIncrementalReadHistory(1500, retryPriority); return; }
        highPriorityHistoryRetryPending = false;
        const started = collectAllRead();
        if (retryPriority && started?.started !== true) {
          highPriorityHistoryRetryPending = true;
          scheduleIncrementalReadHistory(1500, true);
        }
     }, delay);
   };
  const scheduleAllScan = (delay = 80) => {
     if (highPriorityHistoryRetryPending || allScan || allScanTimer || Date.now() - lastAllScanAt < 30000) return;
    allScanTimer = scheduleCollectorTask(() => {
      allScanTimer = null;
       if (highPriorityHistoryRetryPending) return;
      if (Date.now() - lastListInteractionAt < 1200) { scheduleAllScan(1200); return; }
      discoverAll();
    }, delay);
  };
  const capture = () => {
    const messages = [], seen = new Set();
    // Message bubbles have their own data-id. That value identifies a message,
    // never the customer conversation. Resolve the selected conversation once
    // from the verified scan row or the visible header; if identity cannot be
    // established, wait for full-history collection instead of creating one
    // fake conversation per bubble.
    const scanRow = readHistoryScan?.current;
    let currentRow = scanRow && matchesCurrentConversation(scanRow) ? scanRow : null;
    if (!currentRow) {
      try { currentRow = readRows().find(row => matchesCurrentConversation(row)) || null; } catch {}
    }
    const conversationKey = clean(currentRow?.conversationKey || currentConversationIdentity().key);
    if (!conversationKey) return { supported:true, messages:[] };
    const typeEvidence = currentConversationType(currentRow);
    if (!collectibleConversationType(typeEvidence.conversationType)) {
      const identity = currentConversationIdentity();
      return {
        supported:true, messages:[], conversationKey,
        displayName:clean(currentRow?.displayName || identity.title).slice(0, 200),
        conversationType:typeEvidence.conversationType, isGroup:typeEvidence.isGroup, blocked:true,
      };
    }
    [...document.querySelectorAll('[data-testid="msg-container"], [data-pre-plain-text]')].forEach((node, order) => {
      const evidence = resolveMessageDirection(node);
      const wrapper = evidence.wrapper || node;
       if (!evidence.direction) { postDirectionDiagnostic(node); return; }
      const body = messageBodyText(wrapper);
      if (!body.trim() || body.length > HISTORY_BODY_LIMIT || /scan to log in|扫码登录/i.test(clean(body))) return;
      const rawPreamble = String(node.getAttribute?.('data-pre-plain-text') || wrapper.querySelector?.('[data-pre-plain-text]')?.getAttribute?.('data-pre-plain-text') || '');
      const preamble = clean(rawPreamble);
      const explicitExternalMessageId = clean(evidence.externalMessageId) || messageExternalId(node, wrapper);
      const sender = resolveMessageSender(node, wrapper, rawPreamble, evidence.direction, typeEvidence.conversationType);
      const syntheticId = `wa-${compactId(`${conversationKey}|${sender.senderId || sender.senderPhone || sender.senderName}|${preamble}|${evidence.direction}|${body}`)}`;
      const externalMessageId = explicitExternalMessageId || syntheticId;
      const legacyExternalMessageId = legacyMessageExternalId(node, conversationKey, rawPreamble, externalMessageId);
      const key = externalMessageId + '\u001f' + conversationKey + '\u001f' + body;
      if (seen.has(key)) return;
      seen.add(key);
      const sentAt = parseMessageTimestamp(rawPreamble);
      messages.push({ conversationKey, externalMessageId, legacyExternalMessageId, directionSource:evidence.source, conversationType:typeEvidence.conversationType, isGroup:typeEvidence.conversationType === 'vip_group', vipGroup:typeEvidence.conversationType === 'vip_group', ...sender, body, direction:evidence.direction, sentAt, timestampText:timestampTextFromPreamble(rawPreamble), timestampSource:sentAt ? 'whatsapp-preamble' : 'unparsed', cursor:externalMessageId, preamble, order:order + 1 });
    });
    return {
      supported:true, messages, conversationKey,
      displayName:clean(currentRow?.displayName || currentConversationIdentity().title).slice(0, 200),
      conversationType:typeEvidence.conversationType, isGroup:typeEvidence.conversationType === 'vip_group', vipGroup:typeEvidence.conversationType === 'vip_group',
    };
  };
  window.__zhikeWsDiscover = discover;
  window.__zhikeWsDiscoverAll = discoverAll;
  window.__zhikeWsCapture = capture;
  let lastFingerprint = '';
  let lastListFingerprint = '';
  let emitTimer = null;
  let observer = null;
  const fingerprint = payload => JSON.stringify({ c: payload.conversations.map(item => [item.conversationKey, item.displayName, item.lastMessagePreview, item.unreadCount, item.conversationType]), m: payload.messages.map(item => [item.conversationKey, item.externalMessageId, item.body, item.direction]) });
  const emit = (force = false) => {
    if (!window.chrome?.webview || !document.body) return;
    // The dedicated state machine owns mutations while it opens chats and
    // scrolls both virtualized panes. finishRun performs one authoritative
    // comparison after restoring the list, avoiding feedback-loop scans.
    if (readHistoryScan && !force) return;
    const list = discover(); const messages = capture();
    const checkpointRows = [...list.conversations, ...(list.excludedConversations || [])];
    if (messages.conversationKey && !checkpointRows.some(item => item.conversationKey === messages.conversationKey)) {
      const isGroup = messages.conversationType === 'group';
      const isVipGroup = messages.conversationType === 'vip_group';
      const isCollectible = collectibleConversationType(messages.conversationType);
      checkpointRows.push({
        conversationKey:messages.conversationKey, externalId:messages.conversationKey,
        displayName:messages.displayName || '', conversationType:messages.conversationType || 'unknown', isGroup:isGroup || isVipGroup, vipGroup:isVipGroup,
        status:isGroup ? 'skipped-group' : isCollectible ? 'captured' : 'retryable',
        coverage:isGroup ? 'excluded-group' : isCollectible ? 'visible-chat' : 'conversation-type-unresolved',
        historyLoaded:false, historyMessageCount:0, directionVersion:4, directionUnresolvedCount:0,
        previewOnly:true, visibleOnly:true, unreadCount:0, unread:false, uncertainUnread:false,
      });
    }
    const payload = { type:'zhike.ws.capture', accountId, capturedAt:new Date().toISOString(), conversations:checkpointRows, messages:messages.messages };
    const nextFingerprint = fingerprint(payload);
    if (!force && nextFingerprint === lastFingerprint) return;
    const nextListFingerprint = JSON.stringify(payload.conversations.map(item => [item.conversationKey, item.lastMessageFingerprint, item.unreadCount, item.conversationType]));
    const listChanged = Boolean(lastListFingerprint && nextListFingerprint !== lastListFingerprint);
    lastListFingerprint = nextListFingerprint;
    lastFingerprint = nextFingerprint;
    window.chrome.webview.postMessage(JSON.stringify(payload));
    // Keep background collection independent of the currently rendered list
    // window.  The full scan is throttled and non-blocking; only its completed
    // payload is sent to the native host.
    scheduleAllScan(force ? 120 : 900);
    if (force || listChanged) scheduleIncrementalReadHistory(force ? 1200 : 1800);
  };
  window.__zhikeWsBackgroundTick = () => {
    if (!document.body) return { supported:false };
    const advanced = drainDueCollectorTasks();
    emit(false);
    scheduleIncrementalReadHistory(80);
    let listReady = false;
    try { listReady = Boolean(listContainer()); } catch {}
    return {
      supported:true, scanning:Boolean(readHistoryScan), allScanning:Boolean(allScan),
      retryScheduled:Boolean(incrementalHistoryTimer || highPriorityHistoryRetryPending), highPriorityRetryPending:Boolean(highPriorityHistoryRetryPending), listReady,
      allRounds:Number(allScan?.rounds || 0), allSeen:Number(allScan?.seen?.size || 0),
      allScrollTop:Math.max(0, Math.round(Number(allScan?.lastScrollTop || 0))), allMax:Math.max(0, Math.round(Number(allScan?.lastMax || 0))),
      allAgeMs:allScan ? Math.max(0, Date.now() - Number(allScan.startedAt || Date.now())) : 0,
      allNoProgressMs:allScan ? Math.max(0, Date.now() - Number(allScan.lastProgressAt || allScan.startedAt || Date.now())) : 0,
      advanced, queuedTasks:collectorTasks.size,
    };
  };
  const schedule = () => {
    if (emitTimer) return;
    emitTimer = scheduleCollectorTask(() => { emitTimer = null; emit(false); }, 350);
  };
  window.__zhikeStopCapture = () => {
    if (window.__zhikeCaptureTimer) { clearInterval(window.__zhikeCaptureTimer); window.__zhikeCaptureTimer = null; }
    if (emitTimer) { cancelCollectorTask(emitTimer); emitTimer = null; }
    if (allScanTimer) { cancelCollectorTask(allScanTimer); allScanTimer = null; }
    if (incrementalHistoryTimer) { cancelCollectorTask(incrementalHistoryTimer); incrementalHistoryTimer = null; }
    highPriorityHistoryRetryPending = false;
    cancelAllCollectorTasks();
    allScanGeneration += 1;
    allScan = null;
    if (readHistoryScan) {
      try { readHistoryScan.container.scrollTop = readHistoryScan.initial; } catch {}
      readHistoryScan = null;
    }
    if (observer) { observer.disconnect(); observer = null; }
    try { window.removeEventListener('wheel', markListInteraction, { capture:true }); } catch {}
    try { window.removeEventListener('pointerdown', markListInteraction, { capture:true }); } catch {}
  };
  window.__zhikeStopCapture();
  window.addEventListener('wheel', markListInteraction, { passive:true, capture:true });
  window.addEventListener('pointerdown', markListInteraction, { passive:true, capture:true });
  observer = new MutationObserver(schedule);
  if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__zhikeCaptureTimer = setInterval(() => emit(false), 4500);
  emit(true);
})();
""";
    }

    private static string StringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined ? value.ToString().Trim() : string.Empty;

    private static string RawStringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
            ? value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.ToString()
            : string.Empty;

    private static double GetDouble(JsonElement element, string name)
        => element.TryGetProperty(name, out var value)
            && value.TryGetDouble(out var result)
            && double.IsFinite(result)
            ? result
            : 0;

    private static int GetInt(JsonElement element, string name)
        => element.TryGetProperty(name, out var value)
            && value.TryGetInt32(out var result)
            && result >= 0
            ? result
            : 0;

    private static long GetLong(JsonElement element, string name)
        => element.TryGetProperty(name, out var value)
            && value.TryGetInt64(out var result)
            && result >= 0
            ? result
            : 0;

    private static bool GetBool(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static string ResolveResourcesRoot()
    {
        var packaged = Path.Combine(AppContext.BaseDirectory, "resources", "app");
        if (Directory.Exists(packaged)) return packaged;
        if (!string.Equals(Environment.GetEnvironmentVariable("ZHIKE_ALLOW_DEV_RESOURCES"), "1", StringComparison.Ordinal))
            throw new DirectoryNotFoundException("resources/app is missing from the signed desktop bundle");
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "resources", "app")),
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "resources", "app")),
        };
        return candidates.FirstOrDefault(Directory.Exists)
            ?? throw new DirectoryNotFoundException("development resources/app path is not available");
    }

    private void ShowStatus(string message, InfoBarSeverity severity)
    {
        HostStatus.Message = message;
        HostStatus.Severity = severity;
        HostStatus.IsOpen = true;
    }

    private async void RetryHost(object sender, RoutedEventArgs args)
    {
        HostActions.Visibility = Visibility.Collapsed;
        await TryReloadAsync();
    }

    private void ShowHostDiagnostics(object sender, RoutedEventArgs args)
        => ShowStatus($"资源根目录：{ResolveResourcesRoot()}；WebView2：{(_webView?.CoreWebView2 is null ? "未初始化" : "已初始化")}。", InfoBarSeverity.Informational);

    internal static string BuildWsBoundsObserverScript() => """
(() => {
  if (window.__zhikeWsBoundsObserverInstalled) return;
  window.__zhikeWsBoundsObserverInstalled = true;
  let frame = 0;
  let observed = null;
  let resizeObserver = null;
  let mutationRoot = null;
  let mutationObserver = null;
  let sequence = 0;
  let lastSignature = '';
  const documentId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const bounds = () => {
    const node = document.querySelector('#wsBrowserHost');
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    if (!node) return { hidden:true, viewportWidth, viewportHeight };
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      hidden:style.display === 'none' || style.visibility === 'hidden' || rect.width < 40 || rect.height < 40,
      x:rect.left, y:rect.top, width:rect.width, height:rect.height,
      viewportWidth, viewportHeight,
    };
  };
  const publish = () => {
    frame = 0;
    try {
      const next = bounds();
      const number = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '0.0';
      const signature = [
        next.hidden ? '1' : '0', number(next.x), number(next.y),
        number(next.width), number(next.height),
        number(next.viewportWidth), number(next.viewportHeight),
      ].join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      window.chrome?.webview?.postMessage(JSON.stringify({
        type:'zhike.ws.bounds', route:'ws-workbench', routeVisible:!next.hidden,
        documentId, sequence:++sequence, bounds:next,
      }));
    } catch {}
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(publish);
  };
  const bind = () => {
    const next = document.querySelector('#wsBrowserHost');
    if (next !== observed) {
      resizeObserver?.disconnect?.();
      observed = next;
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(schedule);
        if (observed) resizeObserver.observe(observed);
      }
      schedule();
    }
    const nextRoot = document.querySelector('#viewContainer');
    if (nextRoot !== mutationRoot) {
      mutationObserver?.disconnect?.();
      mutationRoot = nextRoot;
      if (mutationRoot && typeof MutationObserver === 'function') {
        mutationObserver = new MutationObserver(() => { bind(); schedule(); });
        mutationObserver.observe(mutationRoot, { childList:true });
      }
    }
  };
  window.addEventListener('resize', schedule, { passive:true });
  const install = () => {
    bind();
    document.querySelector('#viewContainer')?.addEventListener('scroll', schedule, { passive:true });
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
""";

    private static string EscapeJs(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
