using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Dispatching;
using Microsoft.Web.WebView2.Core;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class WsWorkbenchPage : Page
{
    private bool _leftCollapsed;
    private bool _rightCollapsed;
    private readonly WebViewProfileService _profiles = new();
    private readonly WindowLayoutService _layout = new("ws-workbench");
    private string _mobilePanel = "center";
    private readonly WsAccountStore _accountStore = new();
    private readonly LocalQueue _localQueue = new();
    private readonly SemaphoreSlim _flushGate = new(1, 1);
    private readonly SemaphoreSlim _messageGate = new(1, 1);
    private readonly ObservableCollection<WsAccountItem> _accounts = [];
    private ApiClient? _api;
    private WebView2? _webView;
    private readonly DispatcherQueueTimer? _statusTimer;
    private long _switchGeneration;
    private bool _loaded;
    private bool _suppressAccountSelection;
    private bool _layoutRestored;
    private DateTimeOffset _nextSessionRotation = DateTimeOffset.UtcNow.AddHours(12);

    public WsWorkbenchPage()
    {
        InitializeComponent();
        NavigationCacheMode = Microsoft.UI.Xaml.Navigation.NavigationCacheMode.Required;
        AccountsList.ItemsSource = _accounts;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _statusTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_statusTimer is not null)
        {
            _statusTimer.Interval = TimeSpan.FromSeconds(5);
            _statusTimer.Tick += async (_, _) =>
            {
                await App.RecoverLocalServiceAsync();
                _api = App.LocalService?.CreateApiClient();
                if (_api is not null && DateTimeOffset.UtcNow >= _nextSessionRotation)
                {
                    await _api.TryRotateSessionAsync();
                    _nextSessionRotation = DateTimeOffset.UtcNow.AddHours(12);
                }
                await FlushQueuedBatchesAsync();
                if (AccountsList.SelectedItem is WsAccountItem account && _webView is not null)
                {
                    var view = _webView;
                    var generation = Volatile.Read(ref _switchGeneration);
                    await ProbeLoginStateAsync(account, view, generation);
                    if (generation == Volatile.Read(ref _switchGeneration) && ReferenceEquals(view, _webView) && view.CoreWebView2 is not null)
                    {
                        try { await view.CoreWebView2.ExecuteScriptAsync("window.__zhikeWsBackgroundTick?.(); void 0;"); }
                        catch { /* account navigation/reconnect will reinstall the collector */ }
                    }
                }
            };
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (_loaded)
        {
            _statusTimer?.Start();
            ApplyResponsiveLayout();
            return;
        }
        _loaded = true;
        _statusTimer?.Start();
        try
        {
            await App.EnsureLocalServiceAsync();
            _api = App.LocalService?.CreateApiClient();
        }
        catch
        {
            _api = null;
        }
        await RestoreLayoutAsync();
        ApplyResponsiveLayout();
        await LoadAccountsAsync();
        await SwitchAccountAsync(_accounts.FirstOrDefault());
    }

    private void OnUnloaded(object sender, RoutedEventArgs args)
    {
        // Native fallback navigation is not a user-requested WS shutdown.
        // Keep the cached WebView/profile, collector and durable queue alive
        // while another knowledge-work page is displayed. Account switching,
        // explicit session close and process shutdown still own disposal.
    }

    private async Task LoadAccountsAsync()
    {
        var local = await LoadLocalAccountsWithRetryAsync();
        _accounts.Clear();
        foreach (var stored in local) _accounts.Add(new WsAccountItem(stored.Id, stored.DisplayName, stored.Status, stored.LastSeen, stored.LastKnownStatus));
        if (_api is not null)
        {
            try
            {
                var remote = await _api.GetWsAccountsAsync();
                if (remote is not null)
                {
                    foreach (var account in remote)
                    {
                        var existing = _accounts.FirstOrDefault(item => item.Id.Equals(account.Id, StringComparison.OrdinalIgnoreCase));
                        if (existing is null) _accounts.Add(new WsAccountItem(account.Id, account.DisplayName, account.RuntimeStatusOrStatus(), account.LastSeen, account.LastKnownStatus));
                        else existing.Apply(account.DisplayName, account.RuntimeStatusOrStatus(), account.LastSeen, account.LastKnownStatus);
                    }
                    await SaveAccountsAsync();
                }
            }
            catch
            {
                // The local index is the offline fallback. A server outage
                // must not make the account list appear empty.
            }
        }
        AccountsEmptyState.Visibility = _accounts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task<IReadOnlyList<StoredWsAccount>> LoadLocalAccountsWithRetryAsync()
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                var rows = await _accountStore.LoadAsync();
                if (rows.Count > 0 || attempt == 1) return rows;
            }
            catch when (attempt == 0) { }
            await Task.Delay(40);
        }
        return [];
    }

    private void ToggleLeftPane(object sender, RoutedEventArgs args)
    {
        if (IsMobileLayout())
        {
            _mobilePanel = _mobilePanel == "left" ? "center" : "left";
            ApplyResponsiveLayout();
            return;
        }
        _leftCollapsed = !_leftCollapsed;
        ApplyResponsiveLayout();
        _ = PersistLayoutAsync();
    }

    private void ToggleRightPane(object sender, RoutedEventArgs args)
    {
        if (IsMobileLayout())
        {
            _mobilePanel = _mobilePanel == "right" ? "center" : "right";
            ApplyResponsiveLayout();
            return;
        }
        _rightCollapsed = !_rightCollapsed;
        ApplyResponsiveLayout();
        _ = PersistLayoutAsync();
    }

    private void OnWorkbenchSizeChanged(object sender, SizeChangedEventArgs args) => ApplyResponsiveLayout();

    private void ApplyResponsiveLayout()
    {
        if (WorkbenchRoot.ActualWidth <= 0 || WorkbenchRoot.ActualHeight <= 0) return;
        var state = _layout.CalculateLayout(WorkbenchRoot.ActualWidth, WorkbenchRoot.ActualHeight, WorkbenchRoot.XamlRoot?.RasterizationScale ?? 1d, _leftCollapsed, _rightCollapsed);
        if (state.UseMobileTabs)
        {
            LeftPaneColumn.Width = _mobilePanel == "left" ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            CenterPaneColumn.Width = _mobilePanel == "center" ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            RightPaneColumn.Width = _mobilePanel == "right" ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
            LeftPane.Visibility = _mobilePanel == "left" ? Visibility.Visible : Visibility.Collapsed;
            CenterPane.Visibility = _mobilePanel == "center" ? Visibility.Visible : Visibility.Collapsed;
            RightPane.Visibility = _mobilePanel == "right" ? Visibility.Visible : Visibility.Collapsed;
            LeftPaneButton.Content = _mobilePanel == "left" ? "返回聊天" : "显示会话";
            RightPaneButton.Content = _mobilePanel == "right" ? "返回聊天" : "显示辅助";
            return;
        }
        CenterPaneColumn.Width = new GridLength(1, GridUnitType.Star);
        CenterPane.Visibility = Visibility.Visible;
        LeftPaneColumn.Width = new GridLength(state.LeftPaneWidth);
        RightPaneColumn.Width = new GridLength(state.RightPaneWidth);
        LeftPane.Visibility = state.LeftCollapsed ? Visibility.Collapsed : Visibility.Visible;
        RightPane.Visibility = state.RightCollapsed ? Visibility.Collapsed : Visibility.Visible;
        LeftPaneButton.Content = state.LeftCollapsed ? "显示会话" : "收起会话";
        RightPaneButton.Content = state.RightCollapsed ? "显示辅助" : "收起辅助";
    }

    private bool IsMobileLayout()
        => WorkbenchRoot.ActualWidth > 0
           && _layout.CalculateLayout(WorkbenchRoot.ActualWidth, WorkbenchRoot.ActualHeight, WorkbenchRoot.XamlRoot?.RasterizationScale ?? 1d, _leftCollapsed, _rightCollapsed).UseMobileTabs;

    private async Task RestoreLayoutAsync()
    {
        if (_layoutRestored) return;
        _layoutRestored = true;
        try
        {
            var saved = await _layout.LoadAsync();
            if (saved is not null)
            {
                _leftCollapsed = saved.LeftCollapsed;
                _rightCollapsed = saved.RightCollapsed;
            }
        }
        catch { }
    }

    private async Task PersistLayoutAsync()
    {
        if (WorkbenchRoot.ActualWidth <= 0 || WorkbenchRoot.ActualHeight <= 0) return;
        try
        {
            var state = _layout.ApplyLayout(WorkbenchRoot.ActualWidth, WorkbenchRoot.ActualHeight, WorkbenchRoot.XamlRoot?.RasterizationScale ?? 1d, _leftCollapsed, _rightCollapsed);
            await _layout.SaveAsync(state);
        }
        catch { }
    }

    private async void AddAccount(object sender, RoutedEventArgs args)
    {
        var input = new TextBox { PlaceholderText = "例如：个人号 / 客服号", MinWidth = 300 };
        var dialog = new ContentDialog
        {
            Title = "添加 WS 账号",
            Content = input,
            PrimaryButtonText = "创建并登录",
            CloseButtonText = "取消",
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var displayName = input.Text.Trim();
        if (displayName.Length == 0) return;
        var account = new WsAccountItem($"ws-{Guid.NewGuid():N}", displayName, "等待登录");
        _accounts.Add(account);
        AccountsEmptyState.Visibility = Visibility.Collapsed;
        await SaveAccountsAsync();
        if (_api is not null)
        {
            try
            {
                var remote = await _api.UpsertWsAccountAsync(new WsAccountRequest(account.Id, account.DisplayName, account.Status));
                if (remote is not null) account.Apply(remote.DisplayName, remote.RuntimeStatusOrStatus(), remote.LastSeen, remote.LastKnownStatus);
                await SaveAccountsAsync();
            }
            catch
            {
                // Keep the local account and allow login; it will sync when
                // the API becomes available again.
            }
        }

        // Select only after the account has been persisted.  Setting
        // SelectedItem raises SelectionChanged synchronously; selecting
        // before the upsert used to start two concurrent WebView2 switches
        // and could leave the newly added account showing a blank/old page.
        _suppressAccountSelection = true;
        try { AccountsList.SelectedItem = account; }
        finally { _suppressAccountSelection = false; }
        await SwitchAccountAsync(account);
    }

    private async void OnAccountChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_suppressAccountSelection) return;
        if (AccountsList.SelectedItem is WsAccountItem account) await SwitchAccountAsync(account);
    }

    private async Task SwitchAccountAsync(WsAccountItem? account)
    {
        var generation = Interlocked.Increment(ref _switchGeneration);
        if (account is null)
        {
            AccountStatusText.Text = "未添加账号";
            try { _webView?.Close(); } catch { }
            WebViewHost.Children.Clear();
            _webView = null;
            return;
        }
        AccountStatusText.Text = $"{account.DisplayName} · {account.Status}";
        WebView2? staleView = null;
        try
        {
            // A WebView2 environment is bound to one profile for its entire
            // lifetime. Recreate the control on account switches so multiple
            // WS accounts never share cookies or session state.
            if (_webView?.CoreWebView2 is not null)
            {
                _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                _webView.CoreWebView2.NavigationStarting -= OnNavigationStarting;
            }
            try { _webView?.Close(); } catch { }
            WebViewHost.Children.Clear();
            var view = new WebView2 { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
            staleView = view;
            WebViewHost.Children.Add(view);
            _webView = view;
            var environment = await _profiles.GetOrCreateProfileAsync(account.Id);
            await view.EnsureCoreWebView2Async(environment);
            if (generation != _switchGeneration)
            {
                // A fast account switch can finish environment creation after
                // a newer switch already installed another WebView. Detach and
                // close this stale local control or it will retain the profile
                // lock and keep a hidden collector alive.
                if (view.CoreWebView2 is not null)
                {
                    view.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                    view.CoreWebView2.NavigationStarting -= OnNavigationStarting;
                }
                try { view.Close(); } catch { }
                if (ReferenceEquals(_webView, view))
                {
                    WebViewHost.Children.Remove(view);
                    _webView = null;
                }
                return;
            }
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            // Use WebView2's supported runtime user-agent.  A hard-coded
            // future Chrome version is rejected by WhatsApp Web.
            view.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            view.CoreWebView2.NavigationStarting += OnNavigationStarting;
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("(()=>{const apply=()=>{if(document.documentElement)document.documentElement.style.zoom='80%';};apply();document.addEventListener('DOMContentLoaded',apply,{once:true});})();");
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildCollectorScript(account.Id));
            view.CoreWebView2.NavigationCompleted += async (_, navigation) =>
            {
                if (generation != _switchGeneration || !navigation.IsSuccess) return;
                await ProbeLoginStateAsync(account, view, generation);
            };
            view.Source = new Uri("https://web.whatsapp.com/");
            account.SetStatus("等待登录");
            AccountStatusText.Text = $"{account.DisplayName} · {account.Status}";
            await SyncStatusAsync(account);
            await SaveAccountsAsync();
        }
        catch (Exception error)
        {
            if (generation != _switchGeneration && staleView is not null)
            {
                if (staleView.CoreWebView2 is not null)
                {
                    staleView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                    staleView.CoreWebView2.NavigationStarting -= OnNavigationStarting;
                }
                try { staleView.Close(); } catch { }
                if (ReferenceEquals(_webView, staleView))
                {
                    WebViewHost.Children.Remove(staleView);
                    _webView = null;
                }
                return;
            }
            account.SetStatus("连接失败");
            AccountStatusText.Text = $"{account.DisplayName} · {account.Status}：{error.Message}";
            await SyncStatusAsync(account);
            await SaveAccountsAsync();
        }
    }

    private async Task SaveAccountsAsync()
        => await _accountStore.SaveAsync(_accounts.Select(item => new StoredWsAccount(item.Id, item.DisplayName, item.Status, item.LastSeen, item.LastKnownStatus)));

    private async Task SyncStatusAsync(WsAccountItem account)
    {
        if (_api is null) return;
        try { await _api.UpdateWsAccountStatusAsync(account.Id, account.Status); }
        catch { /* local status remains authoritative while the API is offline */ }
    }

    private async Task FlushQueuedBatchesAsync()
    {
        if (_api is null) return;
        if (!await _flushGate.WaitAsync(0)) return;
        try
        {
            foreach (var item in await _localQueue.PeekAsync())
            {
                if (!string.Equals(item.Route, "api/ws/ingest/batch", StringComparison.Ordinal)) continue;
                try
                {
                    var request = LocalQueue.DeserializePayload<WsIngestBatchRequestDto>(item.PayloadJson)
                        ?? throw new InvalidDataException("WS 待同步数据无法反序列化。");
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                    await _api.IngestWsBatchAsync(request, timeout.Token);
                    await _localQueue.RemoveAsync(item.Id);
                }
                catch (Exception error)
                {
                    await _localQueue.MarkFailureAsync(item.Id, error);
                    break;
                }
            }
        }
        catch
        {
            // Keep the first failed item for the next timer tick; ordering is
            // important for checkpoint monotonicity.
        }
        finally
        {
            _flushGate.Release();
        }
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        await _messageGate.WaitAsync();
        try
        {
            if (_webView?.CoreWebView2 is null || !ReferenceEquals(sender, _webView.CoreWebView2)) return;
            if (!IsAllowedNavigation(args.Source)) return;
            var rawMessage = args.TryGetWebMessageAsString();
            if (rawMessage.Length > 1_200_000) return;
            using var document = JsonDocument.Parse(rawMessage);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var type) || !string.Equals(type.GetString(), "zhike.ws.capture", StringComparison.Ordinal)) return;
            var accountId = root.TryGetProperty("accountId", out var account) ? account.GetString() ?? string.Empty : string.Empty;
            var selected = AccountsList.SelectedItem as WsAccountItem;
            if (selected is null || !string.Equals(selected.Id, accountId, StringComparison.Ordinal)) return;
            var capturedAt = root.TryGetProperty("capturedAt", out var captured) && DateTimeOffset.TryParse(captured.GetString(), out var parsedCaptured) ? parsedCaptured : DateTimeOffset.UtcNow;
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
                    LongValue(root, "discovered"),
                    LongValue(root, "processed"),
                    LongValue(root, "attempted"),
                    LongValue(root, "retryable"),
                    LongValue(root, "skippedUnreadCount"),
                    LongValue(root, "rowCount"),
                    LongValue(root, "readCount"),
                    LongValue(root, "skipCount"),
                    LongValue(root, "pendingCount"),
                    LongValue(root, "domNodeKnownCount"),
                    capturedAt);
                var isComplete = string.Equals(eventName, "collection-complete", StringComparison.Ordinal);
                AccountStatusText.Text = isComplete
                    ? $"{selected.DisplayName} · 历史采集完成（{LongValue(root, "processed")}/{LongValue(root, "discovered")}）"
                    : $"{selected.DisplayName} · {eventName}";
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
                    var sentAt = DateTimeOffset.TryParse(StringValue(item, "sentAt"), out var sent) ? sent : (DateTimeOffset?)null;
                    messages.Add(new WsMessageEnvelopeDto(
                        "desktop-webview2", accountId, conversationKey, StringValue(item, "externalMessageId"), sent,
                        StringValue(item, "direction"), body, false, capturedAt, StringValue(item, "cursor"), LongValue(item, "order"),
                        RawStringValue(item, "timestampText"), StringValue(item, "timestampSource"), StringValue(item, "legacyExternalMessageId"), StringValue(item, "directionSource")));
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
                        var historyMessageCount = item.TryGetProperty("historyMessageCount", out var historyCount) && historyCount.TryGetInt32(out var parsedHistoryCount) && parsedHistoryCount >= 0 ? parsedHistoryCount : 0;
                        var historyLoaded = item.TryGetProperty("historyLoaded", out var loaded) && loaded.ValueKind == JsonValueKind.True;
                        var directionVersion = (int)Math.Clamp(LongValue(item, "directionVersion"), 0, int.MaxValue);
                        var directionUnresolvedCount = (int)Math.Clamp(LongValue(item, "directionUnresolvedCount"), 0, int.MaxValue);
                        var conversationType = StringValue(item, "conversationType").ToLowerInvariant();
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
                            isGroup));
                        if (historyLoaded && directionVersion >= 4 && directionUnresolvedCount == 0 && conversationType == "direct")
                            historyAcks.Add(new { conversationKey = key, fingerprint = StringValue(item, "lastMessageFingerprint"), historyMessageCount, conversationType = "direct" });
                    }
                }
            }
            var directConversationKeys = checkpoints
                .Where(item => string.Equals(item.ConversationType, "direct", StringComparison.OrdinalIgnoreCase))
                .Select(item => item.ConversationKey)
                .ToHashSet(StringComparer.Ordinal);
            messages.RemoveAll(item => !directConversationKeys.Contains(item.ConversationKey));
            if (messages.Count == 0 && checkpoints.Count == 0) return;
            var request = new WsIngestBatchRequestDto("zhike.ws.ingest.batch.v1", "desktop-webview2", accountId, capturedAt, "visible-authorized-content", messages, checkpoints);
            await _localQueue.EnqueueAsync("api/ws/ingest/batch", request);
            if (historyAcks.Count > 0 && _webView?.CoreWebView2 is not null)
            {
                var ackJson = JsonSerializer.Serialize(historyAcks);
                try { await _webView.CoreWebView2.ExecuteScriptAsync($"window.__zhikeWsAcknowledgeHistory?.({ackJson}); void 0;"); } catch { }
            }
            _ = FlushQueuedBatchesAsync();
            if (selected.Status != "已连接")
            {
                selected.SetStatus("已连接");
                selected.SetLastSeen(DateTimeOffset.UtcNow);
                AccountStatusText.Text = $"{selected.DisplayName} · {selected.Status}";
                await SyncStatusAsync(selected);
                await SaveAccountsAsync();
            }
        }
        catch (Exception error)
        {
            // Keep the page alive, but do not report success when the durable
            // local queue rejected a packet (for example because disk/capacity
            // is exhausted). The JS checkpoint remains unacknowledged and the
            // collector can safely retry it.
            var detail = string.Join(" ", (error.Message ?? error.GetType().Name).Split(new[] { '\r', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries));
            if (detail.Length > 240) detail = detail[..240];
            AccountStatusText.Text = $"WS 数据暂存失败：{detail}";
        }
        finally { _messageGate.Release(); }
    }

    private static void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        args.Cancel = !IsAllowedNavigation(args.Uri);
    }

    private static bool IsAllowedNavigation(string? uriText)
    {
        if (string.Equals(uriText, "about:blank", StringComparison.OrdinalIgnoreCase)) return true;
        if (!Uri.TryCreate(uriText, UriKind.Absolute, out var uri)) return false;
        return string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, "web.whatsapp.com", StringComparison.OrdinalIgnoreCase);
    }

    private static string StringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined ? value.ToString().Trim() : string.Empty;

    private static string RawStringValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
            ? value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.ToString()
            : string.Empty;

    private static string BuildCollectorScript(string accountId)
        => LegacyUiHostPage.BuildWsCollectorScript(accountId);

    private static long LongValue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.TryGetInt64(out var result) && result >= 0 ? result : 0;

    private async Task ProbeLoginStateAsync(WsAccountItem account, WebView2 view, long generation)
    {
        try
        {
            var json = await view.CoreWebView2.ExecuteScriptAsync("(() => { const body=document.body; const text=(body?.innerText||'').slice(0,12000); const login=!!document.querySelector('[data-testid=\\\"qrcode\\\"], canvas[aria-label*=\\\"QR\\\" i], [data-ref]'); const chatText=/搜索或开始新聊天|Search or start new chat|已归档|Archived/i.test(text); const chat=!!document.querySelector('#pane-side') || (!!document.querySelector('[data-testid=\\\"chat-list\\\"], [aria-label=\\\"Chat list\\\"], [aria-label=\\\"聊天列表\\\"], [role=\\\"grid\\\"]') && !!document.querySelector('[data-testid=\\\"search-input\\\"], [contenteditable=\\\"true\\\"], [role=\\\"textbox\\\"]')) || chatText; const problem=/此页面存在问题|page has a problem|update your browser|更新浏览器/i.test(text); return JSON.stringify({login,chat,problem,text:text.slice(0,2000)}); })()");
            var probeText = JsonSerializer.Deserialize<string>(json) ?? "{}";
            using var probe = JsonDocument.Parse(probeText);
            var root = probe.RootElement;
            var login = root.TryGetProperty("login", out var loginValue) && loginValue.ValueKind == JsonValueKind.True;
            var chat = root.TryGetProperty("chat", out var chatValue) && chatValue.ValueKind == JsonValueKind.True;
            var problem = root.TryGetProperty("problem", out var problemValue) && problemValue.ValueKind == JsonValueKind.True;
            var text = root.TryGetProperty("text", out var textValue) ? textValue.ToString() : string.Empty;
            var next = problem ? "连接失败" : chat ? "已连接" : login || text.Contains("Scan to log in", StringComparison.OrdinalIgnoreCase) || text.Contains("扫码", StringComparison.OrdinalIgnoreCase) ? "等待登录" : account.Status;
            if (generation != _switchGeneration || string.Equals(next, account.Status, StringComparison.Ordinal)) return;
            account.SetStatus(next);
            AccountStatusText.Text = $"{account.DisplayName} · {account.Status}";
            account.SetLastSeen(next == "已连接" ? DateTimeOffset.UtcNow : account.LastSeen);
            await SyncStatusAsync(account);
            await SaveAccountsAsync();
        }
        catch
        {
            // DOM shape changes are non-fatal; the user can still use WS and
            // the next navigation will probe again.
        }
    }

    private sealed class WsAccountItem : INotifyPropertyChanged
    {
        private string _displayName;
        private string _status;
        private DateTimeOffset? _lastSeen;
        private string? _lastKnownStatus;
        public WsAccountItem(string id, string displayName, string status, DateTimeOffset? lastSeen = null, string? lastKnownStatus = null)
        {
            Id = id;
            _displayName = displayName;
            _status = status;
            _lastSeen = lastSeen;
            _lastKnownStatus = lastKnownStatus;
        }
        public string Id { get; }
        public string DisplayName => _displayName;
        public string Status => _status;
        public DateTimeOffset? LastSeen => _lastSeen;
        public string? LastKnownStatus => _lastKnownStatus;
        public event PropertyChangedEventHandler? PropertyChanged;
        public void Apply(string displayName, string status, DateTimeOffset? lastSeen, string? lastKnownStatus = null)
        {
            _displayName = string.IsNullOrWhiteSpace(displayName) ? _displayName : displayName;
            _status = string.IsNullOrWhiteSpace(status) ? _status : status;
            _lastSeen = lastSeen ?? _lastSeen;
            _lastKnownStatus = string.IsNullOrWhiteSpace(lastKnownStatus) ? _lastKnownStatus : lastKnownStatus;
            OnPropertyChanged(nameof(DisplayName));
            OnPropertyChanged(nameof(Status));
            OnPropertyChanged(nameof(LastSeen));
            OnPropertyChanged(nameof(LastKnownStatus));
        }
        public void SetStatus(string value) { _status = value; if (!string.Equals(value, "未连接", StringComparison.Ordinal)) _lastKnownStatus = value; OnPropertyChanged(nameof(Status)); OnPropertyChanged(nameof(LastKnownStatus)); }
        public void SetLastSeen(DateTimeOffset? value) { _lastSeen = value; OnPropertyChanged(nameof(LastSeen)); }
        private void OnPropertyChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

internal static class WsAccountDtoExtensions
{
    public static string RuntimeStatusOrStatus(this WsAccountDto dto)
        => string.IsNullOrWhiteSpace(dto.RuntimeStatus) ? (string.IsNullOrWhiteSpace(dto.Status) ? "未连接" : dto.Status) : dto.RuntimeStatus;
}
