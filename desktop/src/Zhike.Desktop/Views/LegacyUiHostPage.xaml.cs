using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel.DataTransfer;
using System.Net.Http;
using System.Text.Json;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class LegacyUiHostPage : Page
{
    private readonly WebViewProfileService _profiles = new();
    private readonly WebViewProfileService _wsProfiles = new();
    private readonly WsAccountStore _wsAccountStore = new();
    private readonly LocalQueue _wsQueue = new();
    private readonly SemaphoreSlim _wsGate = new(1, 1);
    private readonly AiBridgeService _ai = new();
    private readonly ApiClient? _api;
    private DesktopBridgeService? _bridge;
    private WebView2? _webView;
    private WebView2? _wsView;
    private DispatcherQueueTimer? _wsSyncTimer;
    private string _activeWsAccountId = "default";
    private string _wsViewAccountId = "";
    private long _wsGeneration;
    private bool _initialized;
    private bool _fallbackRaised;
    private string _currentRoute = "home";

    public event EventHandler<string>? FallbackRequested;

    public LegacyUiHostPage()
    {
        InitializeComponent();
        _api = ApiClient.TryCreateFromEnvironment();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _wsSyncTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_wsSyncTimer is not null)
        {
            _wsSyncTimer.Interval = TimeSpan.FromSeconds(10);
            _wsSyncTimer.Tick += async (_, _) => await FlushWsQueueAsync();
        }
    }

    public async Task NavigateRouteAsync(string route, CancellationToken cancellationToken = default)
    {
        _currentRoute = string.IsNullOrWhiteSpace(route) ? "home" : route;
        await EnsureInitializedAsync(cancellationToken);
        if (_webView?.CoreWebView2 is null) return;

        var selector = _currentRoute == "gpt"
            ? "#gptAssistantNav"
            : $"[data-view=\"{EscapeJs(_currentRoute)}\"]";
        var script = $"document.querySelector({JsonSerializer.Serialize(selector)})?.click(); void 0;";
        await _webView.CoreWebView2.ExecuteScriptAsync(script);
        if (!string.Equals(_currentRoute, "ws-workbench", StringComparison.OrdinalIgnoreCase))
            HideWsOverlay();
        else
            _ = ResizeWsOverlayFromDomAsync();
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

    public Task<bool> TryFallbackAsync(string route)
    {
        ShowStatus($"页面 {route} 暂时切换到兼容模式。", InfoBarSeverity.Warning);
        FallbackRequested?.Invoke(this, route);
        return Task.FromResult(true);
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try { await EnsureInitializedAsync(); }
        catch
        {
            ShowStatus("知客原版页面资源暂时不可用，已准备切换到兼容页面。", InfoBarSeverity.Error);
            FallbackRequested?.Invoke(this, _currentRoute);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs args)
    {
        // Keep the WebView profile alive for fast route changes, but stop
        // page-level events so a hidden route cannot mutate the UI.
        if (_webView?.CoreWebView2 is not null)
        {
            _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
            _webView.CoreWebView2.NavigationCompleted -= OnLegacyNavigationCompleted;
            _webView.CoreWebView2.ProcessFailed -= OnLegacyProcessFailed;
        }
        if (_wsView?.CoreWebView2 is not null)
        {
            _wsView.CoreWebView2.WebMessageReceived -= OnWsWebMessageReceived;
            try { _ = _wsView.CoreWebView2.ExecuteScriptAsync("window.__zhikeStopCapture?.();"); } catch { }
        }
        _wsSyncTimer?.Stop();
        HideWsOverlay();
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized && _webView?.CoreWebView2 is not null)
        {
            AttachLegacyHandlers(_webView.CoreWebView2);
            _wsSyncTimer?.Start();
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

        var environment = await _profiles.GetOrCreateProfileAsync("legacy-ui");
        cancellationToken.ThrowIfCancellationRequested();
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        AttachLegacyHandlers(core);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(LegacyBridgeScript.Source);
        core.SetVirtualHostNameToFolderMapping("zhike.local", ResolveResourcesRoot(), CoreWebView2HostResourceAccessKind.Allow);
        _initialized = true;
        HostStatus.IsOpen = false;
        _wsSyncTimer?.Start();
        _webView.Source = new Uri("https://zhike.local/index.html?desktop=1");
    }

    private void AttachLegacyHandlers(CoreWebView2 core)
    {
        core.WebMessageReceived -= OnWebMessageReceived;
        core.WebMessageReceived += OnWebMessageReceived;
        core.NavigationCompleted -= OnLegacyNavigationCompleted;
        core.NavigationCompleted += OnLegacyNavigationCompleted;
        core.ProcessFailed -= OnLegacyProcessFailed;
        core.ProcessFailed += OnLegacyProcessFailed;
    }

    private void OnLegacyNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            _fallbackRaised = false;
            HostActions.Visibility = Visibility.Collapsed;
            return;
        }
        ShowStatus("知客原版页面加载失败，请点击重试；如仍失败可切换兼容页面。", InfoBarSeverity.Error);
        HostActions.Visibility = Visibility.Visible;
        if (_fallbackRaised) return;
        _fallbackRaised = true;
        FallbackRequested?.Invoke(this, _currentRoute);
    }

    private void OnLegacyProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs args)
    {
        ShowStatus("知客页面进程异常，原有数据未受影响。请重试或切换兼容页面。", InfoBarSeverity.Error);
        HostActions.Visibility = Visibility.Visible;
        if (_fallbackRaised) return;
        _fallbackRaised = true;
        FallbackRequested?.Invoke(this, _currentRoute);
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            if (_webView?.CoreWebView2 is null || !ReferenceEquals(sender, _webView.CoreWebView2)) return;
            using var document = JsonDocument.Parse(args.TryGetWebMessageAsString());
            var root = document.RootElement;
            if (!string.Equals(root.TryGetProperty("type", out var type) ? type.GetString() : null, "zhike.bridge.request", StringComparison.Ordinal)) return;
            var requestId = root.TryGetProperty("requestId", out var request) ? request.GetString() ?? string.Empty : string.Empty;
            var method = root.TryGetProperty("method", out var methodValue) ? methodValue.GetString() ?? string.Empty : string.Empty;
            using var emptyPayload = JsonDocument.Parse("{}");
            var payload = root.TryGetProperty("payload", out var payloadValue) ? payloadValue : emptyPayload.RootElement;
            var timeout = root.TryGetProperty("timeoutMs", out var timeoutValue) && timeoutValue.TryGetInt32(out var parsedTimeout) ? parsedTimeout : 15000;
            var accountId = root.TryGetProperty("accountId", out var account) ? account.GetString() : null;
            var bridge = GetBridge();
            BridgeResponse? response;
            try
            {
                response = await HandleNativeBridgeAsync(requestId, method, payload, timeout, accountId)
                    .WaitAsync(TimeSpan.FromMilliseconds(Math.Clamp(timeout, 250, 120000)));
            }
            catch (TimeoutException)
            {
                response = BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "desktop bridge request timed out");
            }
            response ??= await bridge.InvokeAsync(requestId, method, payload, timeout, accountId);
            var message = new { type = "zhike.bridge.response", response.RequestId, response.BridgeVersion, response.Ok, response.ErrorCode, response.Message, response.Data };
            sender.PostWebMessageAsJson(JsonSerializer.Serialize(message));
        }
        catch
        {
            // Malformed page messages must not crash the desktop shell.
        }
    }

    private DesktopBridgeService GetBridge()
    {
        _bridge ??= new DesktopBridgeService(_api is null
            ? new LegacyApiAdapter(new ApiClient(new HttpClient()))
            : new LegacyApiAdapter(_api));
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
        string? accountId)
    {
        try
        {
            return method switch
            {
                "ws.accounts" => await HandleWsAccountsAsync(requestId, payload),
                "ws" => await HandleWsActionAsync(requestId, payload, accountId),
                "tools" => await HandleToolsAsync(requestId, payload),
                "ai" => await HandleAiBridgeAsync(requestId, "request", payload, timeout),
                _ when method.StartsWith("ws.", StringComparison.OrdinalIgnoreCase) => await HandleWsActionAsync(requestId, WithAction(payload, method[3..]), accountId),
                _ when method.StartsWith("tools.", StringComparison.OrdinalIgnoreCase) => await HandleToolsAsync(requestId, WithAction(payload, method[6..])),
                _ when method.StartsWith("ai.", StringComparison.OrdinalIgnoreCase) => await HandleAiBridgeAsync(requestId, method[3..], payload, timeout),
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

    private async Task<BridgeResponse> HandleToolsAsync(string requestId, JsonElement payload)
    {
        var action = StringValue(payload, "action");
        if (string.Equals(action, "status", StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { supported = true }));
        if (string.Equals(action, "notify", StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { supported = false, reason = "当前桌面版本未启用系统通知；请在知客首页查看跟进提醒。" }));
        if (string.Equals(action, "directory", StringComparison.OrdinalIgnoreCase) || string.Equals(action, "configure", StringComparison.OrdinalIgnoreCase) || string.Equals(action, "backup", StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", "自动备份请使用知客数据中心的服务器备份设置。");
        if (!string.Equals(action, "copy", StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", $"unsupported tools action: {action}");
        var value = StringValue(payload, "text");
        if (string.IsNullOrWhiteSpace(value))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "INVALID_REQUEST", "copy text is required");
        var package = new DataPackage();
        package.SetText(value);
        Clipboard.SetContent(package);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { copied = true }));
    }

    private async Task<BridgeResponse> HandleAiBridgeAsync(string requestId, string action, JsonElement payload, int timeoutMs)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 250, 120000)));
            var result = await _ai.InvokeAsync(action, payload, timeout.Token);
            return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, result);
        }
        catch (OperationCanceledException)
        {
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "TIMEOUT", "AI 请求超时或已取消，请重试。" );
        }
        catch (Exception error)
        {
            var message = error.Message.Contains("Key", StringComparison.OrdinalIgnoreCase) || error.Message.Contains("API", StringComparison.OrdinalIgnoreCase)
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

    private async Task<BridgeResponse> HandleWsAccountsAsync(string requestId, JsonElement payload)
    {
        var action = StringValue(payload, "action").ToLowerInvariant();
        var accounts = await LoadWsAccountsAsync();
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
        await _wsAccountStore.SaveAsync(accounts.Append(created));
        if (_api is not null)
        {
            try { await _api.UpsertWsAccountAsync(new WsAccountRequest(created.Id, created.DisplayName, created.Status)); }
            catch { /* local index remains usable; sync will retry on next list */ }
        }
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { account = ToWsAccountDto(created) }));
    }

    private async Task<BridgeResponse> HandleWsActionAsync(string requestId, JsonElement payload, string? requestAccountId)
    {
        var action = StringValue(payload, "action").ToLowerInvariant();
        var id = StringValue(payload, "accountId");
        if (string.IsNullOrWhiteSpace(id)) id = requestAccountId ?? _activeWsAccountId;
        if (string.IsNullOrWhiteSpace(id)) id = "default";
        if (_wsView is not null && !string.Equals(action, "open", StringComparison.OrdinalIgnoreCase) && !string.Equals(action, "reconnect", StringComparison.OrdinalIgnoreCase) && !string.Equals(_wsViewAccountId, id, StringComparison.OrdinalIgnoreCase))
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "ACCOUNT_NOT_ACTIVE", "请求的 WS 账号不是当前显示账号。");
        _activeWsAccountId = id;
        switch (action)
        {
            case "open":
                await OpenWsOverlayAsync(id, payload);
                return await WsStatusResponseAsync(requestId, id);
            case "resize":
                ApplyWsBounds(payload);
                return await WsStatusResponseAsync(requestId, id);
            case "hide":
                HideWsOverlay();
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "已连接" }));
            case "close":
                await CloseWsOverlayAsync(false);
                await SetWsStatusAsync(id, "未连接");
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "未连接" }));
            case "clear-session":
                await CloseWsOverlayAsync(true, _wsViewAccountId);
                await SetWsStatusAsync(id, "未连接");
                return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId = id, status = "未连接" }));
            case "reconnect":
                await OpenWsOverlayAsync(id, payload, reload: true);
                return await WsStatusResponseAsync(requestId, id);
            case "status":
            case "probe":
                return await WsStatusResponseAsync(requestId, id);
            case "discover-conversations":
                return await ExecuteWsCaptureAsync(requestId, "discover");
            case "capture-visible-messages":
            case "capture-selection":
                return await ExecuteWsCaptureAsync(requestId, "messages");
            default:
                return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "UNSUPPORTED", $"unsupported WS action: {action}");
        }
    }

    private async Task<List<StoredWsAccount>> LoadWsAccountsAsync()
    {
        var local = (await _wsAccountStore.LoadAsync()).ToList();
        if (local.Count == 0)
        {
            // The default row is a configuration anchor, not demo business
            // data. It keeps the original page from rendering an empty
            // account rail on first launch.
            local.Add(new StoredWsAccount("default", "默认账号", "未连接"));
            await _wsAccountStore.SaveAsync(local);
        }
        if (_api is null) return local;
        try
        {
            var remote = await _api.GetWsAccountsAsync();
            if (remote is null) return local;
            foreach (var item in remote)
            {
                var existing = local.FirstOrDefault(row => string.Equals(row.Id, item.Id, StringComparison.OrdinalIgnoreCase));
                var normalized = new StoredWsAccount(item.Id, item.DisplayName, string.IsNullOrWhiteSpace(item.RuntimeStatus) ? item.Status : item.RuntimeStatus!, item.LastSeen);
                if (existing is null) local.Add(normalized);
                else
                {
                    var index = local.IndexOf(existing);
                    local[index] = existing with
                    {
                        DisplayName = string.IsNullOrWhiteSpace(normalized.DisplayName) ? existing.DisplayName : normalized.DisplayName,
                        Status = string.IsNullOrWhiteSpace(normalized.Status) ? existing.Status : normalized.Status,
                        LastSeen = normalized.LastSeen ?? existing.LastSeen,
                    };
                }
            }
            await _wsAccountStore.SaveAsync(local);
        }
        catch { /* local account index is the offline fallback */ }
        return local;
    }

    private static object ToWsAccountDto(StoredWsAccount account)
        => new { id = account.Id, displayName = account.DisplayName, status = account.Status, runtimeStatus = account.Status, lastSeen = account.LastSeen };

    private async Task OpenWsOverlayAsync(string accountId, JsonElement payload, bool reload = false)
    {
        await _wsGate.WaitAsync();
        try
        {
            var generation = Interlocked.Increment(ref _wsGeneration);
            if (_wsView is null || !string.Equals(_wsViewAccountId, accountId, StringComparison.OrdinalIgnoreCase))
            {
                HideWsOverlay();
                if (_wsView?.CoreWebView2 is not null)
                {
                    _wsView.CoreWebView2.WebMessageReceived -= OnWsWebMessageReceived;
                    try { _wsView.CoreWebView2.Navigate("about:blank"); } catch { }
                }
                WsOverlayHost.Children.Clear();
                var view = new WebView2 { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
                WsOverlayHost.Children.Add(view);
                _wsView = view;
                var environment = await _wsProfiles.GetOrCreateProfileAsync(accountId);
                await view.EnsureCoreWebView2Async(environment);
                if (generation != _wsGeneration) return;
                view.CoreWebView2.Settings.AreDevToolsEnabled = false;
                view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                view.CoreWebView2.WebMessageReceived += OnWsWebMessageReceived;
                await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildWsCollectorScript(accountId));
                view.CoreWebView2.NavigationCompleted += async (_, navigation) =>
                {
                    if (generation != _wsGeneration || !navigation.IsSuccess) return;
                    await ProbeWsLoginStateAsync(accountId, view, generation);
                };
                _activeWsAccountId = accountId;
                _wsViewAccountId = accountId;
                view.Source = new Uri("https://web.whatsapp.com/");
            }
            else if (reload && _wsView.CoreWebView2 is not null)
            {
                _wsView.CoreWebView2.Reload();
            }
            ApplyWsBounds(payload);
            await SetWsStatusAsync(accountId, "等待登录");
        }
        finally { _wsGate.Release(); }
    }

    private async Task CloseWsOverlayAsync(bool clearProfile, string? profileAccountId = null)
    {
        var view = _wsView;
        _wsView = null;
        _wsViewAccountId = "";
        Interlocked.Increment(ref _wsGeneration);
        if (view?.CoreWebView2 is not null)
        {
            view.CoreWebView2.WebMessageReceived -= OnWsWebMessageReceived;
            try { view.CoreWebView2.Navigate("about:blank"); } catch { }
        }
        WsOverlayHost.Children.Clear();
        HideWsOverlay();
        if (clearProfile)
        {
            try { await Task.Delay(100); await _wsProfiles.ClearProfileAsync(profileAccountId ?? _activeWsAccountId); }
            catch { /* the profile may still be releasing; do not delete user data forcibly */ }
        }
    }

    private void HideWsOverlay()
    {
        WsOverlayLayer.Visibility = Visibility.Collapsed;
        WsOverlayLayer.IsHitTestVisible = false;
    }

    private void ApplyWsBounds(JsonElement payload)
    {
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
        var width = Math.Max(40, GetDouble(bounds, "width"));
        var height = Math.Max(40, GetDouble(bounds, "height"));
        var x = Math.Max(0, GetDouble(bounds, "x"));
        var y = Math.Max(0, GetDouble(bounds, "y"));
        WsOverlayBorder.Width = Math.Min(width, Math.Max(40, WebViewHost.ActualWidth - x));
        WsOverlayBorder.Height = Math.Min(height, Math.Max(40, WebViewHost.ActualHeight - y));
        Canvas.SetLeft(WsOverlayBorder, x);
        Canvas.SetTop(WsOverlayBorder, y);
        WsOverlayLayer.Visibility = Visibility.Visible;
        WsOverlayLayer.IsHitTestVisible = true;
    }

    private async Task ResizeWsOverlayFromDomAsync()
    {
        if (_webView?.CoreWebView2 is null || _wsView is null) return;
        try
        {
            var json = await _webView.CoreWebView2.ExecuteScriptAsync("(() => { const n=document.querySelector('#wsBrowserHost'); if(!n) return {hidden:true}; const r=n.getBoundingClientRect(), s=getComputedStyle(n); return {hidden:s.display==='none'||s.visibility==='hidden'||r.width<40||r.height<40,x:r.left,y:r.top,width:r.width,height:r.height}; })()");
            using var document = JsonDocument.Parse(json);
            var payload = JsonSerializer.SerializeToElement(new { bounds = document.RootElement });
            ApplyWsBounds(payload);
        }
        catch { }
    }

    private async Task<BridgeResponse> WsStatusResponseAsync(string requestId, string accountId)
    {
        var status = await ProbeWsLoginStateAsync(accountId, _wsView, _wsGeneration);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, JsonSerializer.SerializeToElement(new { accountId, status.status, detail = status.detail }));
    }

    private async Task<(string status, string detail)> ProbeWsLoginStateAsync(string accountId, WebView2? view, long generation)
    {
        if (view?.CoreWebView2 is null) return ("未连接", "WS 页面尚未打开。");
        try
        {
            var json = await view.CoreWebView2.ExecuteScriptAsync("document.body ? document.body.innerText : ''");
            var text = JsonSerializer.Deserialize<string>(json) ?? string.Empty;
            var status = text.Contains("搜索或开始新聊天", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Search or start new chat", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Archived", StringComparison.OrdinalIgnoreCase)
                ? "已连接"
                : text.Contains("Scan to log in", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("扫码", StringComparison.OrdinalIgnoreCase)
                    ? "等待登录"
                    : "连接中";
            var detail = status == "已连接" ? "已检测到 WS 主界面。" : "请在 WS 页面自行扫码或登录。";
            if (generation == _wsGeneration)
            {
                await SetWsStatusAsync(accountId, status);
                GetBridge().Publish("ws.status", JsonSerializer.SerializeToElement(new { accountId, status, detail }));
            }
            return (status, detail);
        }
        catch
        {
            return ("连接失败", "WS 页面状态检测失败，请重试。");
        }
    }

    private async Task SetWsStatusAsync(string accountId, string status)
    {
        var rows = await _wsAccountStore.LoadAsync();
        var existing = rows.FirstOrDefault(item => string.Equals(item.Id, accountId, StringComparison.OrdinalIgnoreCase));
        if (existing is null) return;
        await _wsAccountStore.SaveAsync(rows.Select(item => item.Id.Equals(accountId, StringComparison.OrdinalIgnoreCase) ? item with { Status = status, LastSeen = status == "已连接" ? DateTimeOffset.UtcNow : item.LastSeen } : item));
        if (_api is not null)
        {
            try { await _api.UpdateWsAccountStatusAsync(accountId, status); } catch { }
        }
    }

    private async Task<BridgeResponse> ExecuteWsCaptureAsync(string requestId, string kind)
    {
        if (_wsView?.CoreWebView2 is null)
            return BridgeResponse.Failure(requestId, DesktopBridgeService.CurrentVersion, "NOT_CONNECTED", "WS 页面尚未打开。");
        var script = kind == "discover" ? "window.__zhikeWsDiscover ? JSON.stringify(window.__zhikeWsDiscover()) : JSON.stringify({supported:false,error:'当前 WS 页面结构未识别'})" : "window.__zhikeWsCapture ? JSON.stringify(window.__zhikeWsCapture()) : JSON.stringify({supported:false,error:'当前 WS 页面结构未识别'})";
        var json = await _wsView.CoreWebView2.ExecuteScriptAsync(script);
        using var document = JsonDocument.Parse(json);
        return BridgeResponse.Success(requestId, DesktopBridgeService.CurrentVersion, document.RootElement.Clone());
    }

    private async void OnWsWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            if (_wsView?.CoreWebView2 is null || !ReferenceEquals(sender, _wsView.CoreWebView2)) return;
            using var document = JsonDocument.Parse(args.TryGetWebMessageAsString());
            var root = document.RootElement;
            if (!string.Equals(StringValue(root, "type"), "zhike.ws.capture", StringComparison.Ordinal)) return;
            var claimedAccountId = StringValue(root, "accountId");
            var accountId = _wsViewAccountId;
            if (string.IsNullOrWhiteSpace(accountId) || (!string.IsNullOrWhiteSpace(claimedAccountId) && !string.Equals(claimedAccountId, accountId, StringComparison.Ordinal))) return;
            var capturedAt = DateTimeOffset.TryParse(StringValue(root, "capturedAt"), out var parsedCaptured) ? parsedCaptured : DateTimeOffset.UtcNow;
            var messages = new List<WsMessageEnvelopeDto>();
            if (root.TryGetProperty("messages", out var messageArray) && messageArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in messageArray.EnumerateArray())
                {
                    var conversationKey = StringValue(item, "conversationKey");
                    var body = StringValue(item, "body");
                    if (string.IsNullOrWhiteSpace(conversationKey) || string.IsNullOrWhiteSpace(body)) continue;
                    messages.Add(new WsMessageEnvelopeDto("desktop-webview2", accountId, conversationKey, StringValue(item, "externalMessageId"), DateTimeOffset.TryParse(StringValue(item, "sentAt"), out var sent) ? sent : null, StringValue(item, "direction"), body, false, capturedAt, StringValue(item, "cursor")));
                }
            }
            var checkpoints = new List<WsCheckpointDto>();
            if (root.TryGetProperty("conversations", out var conversationArray) && conversationArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in conversationArray.EnumerateArray())
                {
                    var key = StringValue(item, "conversationKey");
                    if (!string.IsNullOrWhiteSpace(key)) checkpoints.Add(new WsCheckpointDto(accountId, key, StringValue(item, "cursor"), StringValue(item, "lastMessageFingerprint"), capturedAt));
                }
            }
            if (messages.Count == 0 && checkpoints.Count == 0) return;
            var request = new WsIngestBatchRequestDto("zhike.ws.ingest.batch.v1", "desktop-webview2", accountId, capturedAt, "visible-authorized-content", messages, checkpoints);
            var accepted = 0;
            var deduplicated = 0;
            try
            {
                if (_api is null) throw new InvalidOperationException("API 未配置");
                var result = await _api.IngestWsBatchAsync(request);
                accepted = result?.Accepted ?? 0;
                deduplicated = result?.Deduplicated ?? 0;
            }
            catch { await _wsQueue.EnqueueAsync("api/v2/ws/ingest/batch", request); }
            await SetWsStatusAsync(accountId, "已连接");
            GetBridge().Publish("ws.message", JsonSerializer.SerializeToElement(new { accountId, accepted, deduplicated, conversations = checkpoints.Count, observedAt = capturedAt }));
            GetBridge().Publish("sync.updated", JsonSerializer.SerializeToElement(new { accountId, accepted, deduplicated }));
        }
        catch { /* malformed WS DOM data must not crash the shell */ }
    }

    private async Task FlushWsQueueAsync()
    {
        if (_api is null) return;
        try
        {
            foreach (var item in await _wsQueue.PeekAsync())
            {
                if (!string.Equals(item.Route, "api/v2/ws/ingest/batch", StringComparison.Ordinal)) continue;
                var request = JsonSerializer.Deserialize<WsIngestBatchRequestDto>(item.PayloadJson);
                if (request is null) { await _wsQueue.RemoveAsync(item.Id); continue; }
                await _api.IngestWsBatchAsync(request);
                await _wsQueue.RemoveAsync(item.Id);
            }
        }
        catch { }
    }

    private static string BuildWsCollectorScript(string accountId)
    {
        var encodedAccount = JsonSerializer.Serialize(accountId);
        return $$"""
(() => {
  const accountId = {{encodedAccount}};
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const text = node => clean(node?.innerText || node?.textContent || '');
  const discover = () => {
    const conversations = [], seen = new Set();
    for (const row of document.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]')) {
      const conversationKey = clean(row.getAttribute('data-id') || row.getAttribute('data-chat-id') || row.getAttribute('aria-label') || '');
      const displayName = clean(row.querySelector('[title], span[dir="auto"]')?.getAttribute('title') || row.querySelector('span[dir="auto"]')?.textContent || '');
      if (!conversationKey || seen.has(conversationKey)) continue;
      seen.add(conversationKey);
      conversations.push({ conversationKey, displayName, lastMessagePreview: text(row).slice(-500), lastMessageAt: '', unreadCount: Number(row.querySelector('[aria-label*="unread" i]')?.textContent || 0) || 0, visibleOnly: true });
    }
    return { supported: true, conversations };
  };
  const capture = () => {
    const messages = [], seen = new Set();
    for (const node of document.querySelectorAll('[data-testid="msg-container"], [data-pre-plain-text]')) {
      const externalMessageId = clean(node.getAttribute('data-id') || node.getAttribute('data-message-id') || '');
      const body = text(node.querySelector('span.selectable-text') || node);
      if (!body || /scan to log in|扫码登录/i.test(body)) continue;
      const conversationKey = clean(node.closest('[data-id]')?.getAttribute('data-id') || document.querySelector('[data-testid="conversation-header"] [title]')?.getAttribute('title') || 'visible');
      const key = externalMessageId + '\u001f' + conversationKey + '\u001f' + body;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ conversationKey, externalMessageId, body, direction: /message-out|data-pre-plain-text="\[.*\] you:/i.test(node.outerHTML || '') ? 'outgoing' : 'incoming', sentAt: '', cursor: externalMessageId });
    }
    return { supported: true, messages };
  };
  window.__zhikeWsDiscover = discover;
  window.__zhikeWsCapture = capture;
  const emit = () => {
    if (!window.chrome?.webview || !document.body) return;
    const list = discover(); const messages = capture();
    window.chrome.webview.postMessage(JSON.stringify({ type:'zhike.ws.capture', accountId, capturedAt:new Date().toISOString(), conversations:list.conversations, messages:messages.messages }));
  };
  window.__zhikeStopCapture = () => { if (window.__zhikeCaptureTimer) { clearInterval(window.__zhikeCaptureTimer); window.__zhikeCaptureTimer = null; } };
  window.__zhikeStopCapture();
  window.__zhikeCaptureTimer = setInterval(emit, 5000);
  emit();
})();
""";
    }

    private static string StringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined ? value.ToString().Trim() : string.Empty;

    private static double GetDouble(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.TryGetDouble(out var result) ? result : 0;

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
        _fallbackRaised = false;
        await TryReloadAsync();
    }

    private void ShowHostDiagnostics(object sender, RoutedEventArgs args)
        => ShowStatus($"资源根目录：{ResolveResourcesRoot()}；WebView2：{(_webView?.CoreWebView2 is null ? "未初始化" : "已初始化")}。", InfoBarSeverity.Informational);

    private void OpenNativeFallback(object sender, RoutedEventArgs args)
    {
        _fallbackRaised = true;
        FallbackRequested?.Invoke(this, _currentRoute);
    }

    private static string EscapeJs(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
