using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using System.Text.Json;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class LegacyUiHostPage : Page
{
    private readonly WebViewProfileService _profiles = new();
    private readonly ApiClient? _api;
    private DesktopBridgeService? _bridge;
    private WebView2? _webView;
    private bool _initialized;
    private string _currentRoute = "home";

    public LegacyUiHostPage()
    {
        InitializeComponent();
        _api = ApiClient.TryCreateFromEnvironment();
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
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
        return Task.FromResult(false);
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try { await EnsureInitializedAsync(); }
        catch { ShowStatus("知客页面暂时不可用，可点击重试或使用原生兼容页面。", InfoBarSeverity.Error); }
    }

    private void OnUnloaded(object sender, RoutedEventArgs args)
    {
        // Keep the WebView profile alive for fast route changes, but stop
        // page-level events so a hidden route cannot mutate the UI.
        if (_webView?.CoreWebView2 is not null)
            _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized && _webView?.CoreWebView2 is not null) return;
        _webView ??= new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        if (!WebViewHost.Children.Contains(_webView)) WebViewHost.Children.Add(_webView);

        var environment = await _profiles.GetOrCreateProfileAsync("legacy-ui");
        cancellationToken.ThrowIfCancellationRequested();
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.WebMessageReceived -= OnWebMessageReceived;
        core.WebMessageReceived += OnWebMessageReceived;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(LegacyBridgeScript.Source);
        core.SetVirtualHostNameToFolderMapping("zhike.local", ResolveResourcesRoot(), CoreWebView2HostResourceAccessKind.Allow);
        _initialized = true;
        HostStatus.IsOpen = false;
        _webView.Source = new Uri("https://zhike.local/index.html?desktop=1");
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.TryGetWebMessageAsString());
            var root = document.RootElement;
            if (!string.Equals(root.TryGetProperty("type", out var type) ? type.GetString() : null, "zhike.bridge.request", StringComparison.Ordinal)) return;
            var requestId = root.TryGetProperty("requestId", out var request) ? request.GetString() ?? string.Empty : string.Empty;
            var method = root.TryGetProperty("method", out var methodValue) ? methodValue.GetString() ?? string.Empty : string.Empty;
            var payload = root.TryGetProperty("payload", out var payloadValue) ? payloadValue : JsonDocument.Parse("{}").RootElement;
            var timeout = root.TryGetProperty("timeoutMs", out var timeoutValue) && timeoutValue.TryGetInt32(out var parsedTimeout) ? parsedTimeout : 15000;
            _bridge ??= new DesktopBridgeService(_api is null ? new LegacyApiAdapter(new ApiClient(new HttpClient())) : new LegacyApiAdapter(_api));
            var response = await _bridge.InvokeAsync(requestId, method, payload, timeout, root.TryGetProperty("accountId", out var account) ? account.GetString() : null);
            var message = new { type = "zhike.bridge.response", response.RequestId, response.BridgeVersion, response.Ok, response.ErrorCode, response.Message, response.Data };
            sender.PostWebMessageAsJson(JsonSerializer.Serialize(message));
        }
        catch
        {
            // Malformed page messages must not crash the desktop shell.
        }
    }

    private static string ResolveResourcesRoot()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "resources", "app"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "resources", "app")),
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "resources", "app")),
        };
        return candidates.FirstOrDefault(Directory.Exists)
            ?? throw new DirectoryNotFoundException("resources/app is not available in the desktop bundle");
    }

    private void ShowStatus(string message, InfoBarSeverity severity)
    {
        HostStatus.Message = message;
        HostStatus.Severity = severity;
        HostStatus.IsOpen = true;
    }

    private static string EscapeJs(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
