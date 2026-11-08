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
    private readonly WindowLayoutService _layout = new();
    private readonly WsAccountStore _accountStore = new();
    private readonly LocalQueue _localQueue = new();
    private readonly ObservableCollection<WsAccountItem> _accounts = [];
    private readonly ApiClient? _api;
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
        _api = ApiClient.TryCreateFromEnvironment();
        AccountsList.ItemsSource = _accounts;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _statusTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_statusTimer is not null)
        {
            _statusTimer.Interval = TimeSpan.FromSeconds(5);
            _statusTimer.Tick += async (_, _) =>
            {
                if (_api is not null && DateTimeOffset.UtcNow >= _nextSessionRotation)
                {
                    await _api.TryRotateSessionAsync();
                    _nextSessionRotation = DateTimeOffset.UtcNow.AddHours(12);
                }
                await FlushQueuedBatchesAsync();
                if (AccountsList.SelectedItem is WsAccountItem account && _webView is not null)
                    await ProbeLoginStateAsync(account, _webView, _switchGeneration);
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
        await RestoreLayoutAsync();
        ApplyResponsiveLayout();
        await LoadAccountsAsync();
        await SwitchAccountAsync(_accounts.FirstOrDefault());
    }

    private void OnUnloaded(object sender, RoutedEventArgs args)
    {
        Interlocked.Increment(ref _switchGeneration);
        var view = _webView;
        _webView = null;
        if (view?.CoreWebView2 is not null)
        {
            view.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
            view.CoreWebView2.NavigationStarting -= OnNavigationStarting;
        }
        try { view?.Close(); } catch { }
        WebViewHost.Children.Clear();
        _statusTimer?.Stop();
        _loaded = false;
    }

    private async Task LoadAccountsAsync()
    {
        var local = await LoadLocalAccountsWithRetryAsync();
        _accounts.Clear();
        foreach (var stored in local) _accounts.Add(new WsAccountItem(stored.Id, stored.DisplayName, stored.Status, stored.LastSeen));
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
                        if (existing is null) _accounts.Add(new WsAccountItem(account.Id, account.DisplayName, account.RuntimeStatusOrStatus(), account.LastSeen));
                        else existing.Apply(account.DisplayName, account.RuntimeStatusOrStatus(), account.LastSeen);
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
        _leftCollapsed = !_leftCollapsed;
        ApplyResponsiveLayout();
        _ = PersistLayoutAsync();
    }

    private void ToggleRightPane(object sender, RoutedEventArgs args)
    {
        _rightCollapsed = !_rightCollapsed;
        ApplyResponsiveLayout();
        _ = PersistLayoutAsync();
    }

    private void OnWorkbenchSizeChanged(object sender, SizeChangedEventArgs args) => ApplyResponsiveLayout();

    private void ApplyResponsiveLayout()
    {
        var state = _layout.CalculateLayout(WorkbenchRoot.ActualWidth, WorkbenchRoot.ActualHeight, WorkbenchRoot.XamlRoot?.RasterizationScale ?? 1d, _leftCollapsed, _rightCollapsed);
        LeftPaneColumn.Width = new GridLength(state.LeftPaneWidth);
        RightPaneColumn.Width = new GridLength(state.RightPaneWidth);
        LeftPane.Visibility = state.LeftCollapsed ? Visibility.Collapsed : Visibility.Visible;
        RightPane.Visibility = state.RightCollapsed ? Visibility.Collapsed : Visibility.Visible;
    }

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
                if (remote is not null) account.Apply(remote.DisplayName, remote.RuntimeStatusOrStatus(), remote.LastSeen);
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
            view.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            view.CoreWebView2.NavigationStarting += OnNavigationStarting;
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
        => await _accountStore.SaveAsync(_accounts.Select(item => new StoredWsAccount(item.Id, item.DisplayName, item.Status, item.LastSeen)));

    private async Task SyncStatusAsync(WsAccountItem account)
    {
        if (_api is null) return;
        try { await _api.UpdateWsAccountStatusAsync(account.Id, account.Status); }
        catch { /* local status remains authoritative while the API is offline */ }
    }

    private async Task FlushQueuedBatchesAsync()
    {
        if (_api is null) return;
        try
        {
            foreach (var item in await _localQueue.PeekAsync())
            {
                if (!string.Equals(item.Route, "api/v2/ws/ingest/batch", StringComparison.Ordinal)) continue;
                var request = JsonSerializer.Deserialize<WsIngestBatchRequestDto>(item.PayloadJson);
                if (request is null) { await _localQueue.RemoveAsync(item.Id); continue; }
                await _api.IngestWsBatchAsync(request);
                await _localQueue.RemoveAsync(item.Id);
            }
        }
        catch
        {
            // Keep the first failed item for the next timer tick; ordering is
            // important for checkpoint monotonicity.
        }
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
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
            var messages = new List<WsMessageEnvelopeDto>();
            if (root.TryGetProperty("messages", out var messageArray) && messageArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in messageArray.EnumerateArray())
                {
                    var conversationKey = StringValue(item, "conversationKey");
                    var body = StringValue(item, "body");
                    if (string.IsNullOrWhiteSpace(conversationKey) || string.IsNullOrWhiteSpace(body)) continue;
                    var sentAt = DateTimeOffset.TryParse(StringValue(item, "sentAt"), out var sent) ? sent : (DateTimeOffset?)null;
                    messages.Add(new WsMessageEnvelopeDto(
                        "desktop-webview2", accountId, conversationKey, StringValue(item, "externalMessageId"), sent,
                        StringValue(item, "direction"), body, false, capturedAt, StringValue(item, "cursor")));
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
            try
            {
                if (_api is null) throw new InvalidOperationException("API 未配置");
                await _api.IngestWsBatchAsync(request);
            }
            catch
            {
                await _localQueue.EnqueueAsync("api/v2/ws/ingest/batch", request);
            }
            if (selected.Status != "已连接")
            {
                selected.SetStatus("已连接");
                selected.SetLastSeen(DateTimeOffset.UtcNow);
                AccountStatusText.Text = $"{selected.DisplayName} · {selected.Status}";
                await SyncStatusAsync(selected);
                await SaveAccountsAsync();
            }
        }
        catch
        {
            // A DOM shape change or malformed page message must not stop WS.
        }
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

    private static string BuildCollectorScript(string accountId)
    {
        var encodedAccount = JsonSerializer.Serialize(accountId);
        return $$"""
(() => {
  const accountId = {{encodedAccount}};
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const text = node => clean(node?.innerText || node?.textContent || '');
  const emit = () => {
    if (!window.chrome?.webview || !document.body) return;
    const conversations = [];
    const seenConversations = new Set();
    const rows = document.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]');
    for (const row of rows) {
      const conversationKey = clean(row.getAttribute('data-id') || row.getAttribute('data-chat-id') || row.getAttribute('aria-label') || '');
      const displayName = clean(row.querySelector('[title], span[dir="auto"]')?.getAttribute('title') || row.querySelector('span[dir="auto"]')?.textContent || '');
      if (!conversationKey || seenConversations.has(conversationKey)) continue;
      seenConversations.add(conversationKey);
      conversations.push({ conversationKey, displayName, lastMessagePreview: text(row).slice(-500), lastMessageAt: '', unreadCount: Number(row.querySelector('[aria-label*="unread" i]')?.textContent || 0) || 0, visibleOnly: true });
    }
    const messages = [];
    const seenMessages = new Set();
    for (const node of document.querySelectorAll('[data-testid="msg-container"], [data-pre-plain-text]')) {
      const externalMessageId = clean(node.getAttribute('data-id') || node.getAttribute('data-message-id') || '');
      const body = text(node.querySelector('span.selectable-text') || node);
      if (!body || /scan to log in|扫码登录/i.test(body)) continue;
      const conversationKey = clean(node.closest('[data-id]')?.getAttribute('data-id') || document.querySelector('[data-testid="conversation-header"] [title]')?.getAttribute('title') || 'visible');
      const key = externalMessageId + '\u001f' + conversationKey + '\u001f' + body;
      if (seenMessages.has(key)) continue;
      seenMessages.add(key);
      messages.push({ conversationKey, externalMessageId, body, direction: /message-out|data-pre-plain-text="\[.*\] you:/i.test(node.outerHTML || '') ? 'outgoing' : 'incoming', sentAt: '', cursor: externalMessageId });
    }
    window.chrome.webview.postMessage(JSON.stringify({ type: 'zhike.ws.capture', accountId, capturedAt: new Date().toISOString(), conversations, messages }));
  };
  if (window.__zhikeCaptureTimer) clearInterval(window.__zhikeCaptureTimer);
  window.__zhikeCaptureTimer = setInterval(emit, 5000);
  emit();
})();
""";
    }

    private async Task ProbeLoginStateAsync(WsAccountItem account, WebView2 view, long generation)
    {
        try
        {
            var json = await view.CoreWebView2.ExecuteScriptAsync("document.body ? document.body.innerText : ''");
            var text = JsonSerializer.Deserialize<string>(json) ?? string.Empty;
            var next = text.Contains("搜索或开始新聊天", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Search or start new chat", StringComparison.OrdinalIgnoreCase)
                || text.Contains("Archived", StringComparison.OrdinalIgnoreCase)
                ? "已连接"
                : text.Contains("Scan to log in", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("扫码", StringComparison.OrdinalIgnoreCase)
                    ? "等待登录"
                    : account.Status;
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
        public WsAccountItem(string id, string displayName, string status, DateTimeOffset? lastSeen = null)
        {
            Id = id;
            _displayName = displayName;
            _status = status;
            _lastSeen = lastSeen;
        }
        public string Id { get; }
        public string DisplayName => _displayName;
        public string Status => _status;
        public DateTimeOffset? LastSeen => _lastSeen;
        public event PropertyChangedEventHandler? PropertyChanged;
        public void Apply(string displayName, string status, DateTimeOffset? lastSeen)
        {
            _displayName = string.IsNullOrWhiteSpace(displayName) ? _displayName : displayName;
            _status = string.IsNullOrWhiteSpace(status) ? _status : status;
            _lastSeen = lastSeen ?? _lastSeen;
            OnPropertyChanged(nameof(DisplayName));
            OnPropertyChanged(nameof(Status));
            OnPropertyChanged(nameof(LastSeen));
        }
        public void SetStatus(string value) { _status = value; OnPropertyChanged(nameof(Status)); }
        public void SetLastSeen(DateTimeOffset? value) { _lastSeen = value; OnPropertyChanged(nameof(LastSeen)); }
        private void OnPropertyChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

internal static class WsAccountDtoExtensions
{
    public static string RuntimeStatusOrStatus(this WsAccountDto dto)
        => string.IsNullOrWhiteSpace(dto.RuntimeStatus) ? (string.IsNullOrWhiteSpace(dto.Status) ? "未连接" : dto.Status) : dto.RuntimeStatus;
}
