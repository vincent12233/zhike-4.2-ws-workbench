using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Net.Http;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class HomePage : Page
{
    private ApiClient? _api;
    private readonly string _deviceId = $"{Environment.MachineName}-{Environment.UserName}";

    public HomePage()
    {
        InitializeComponent();
        var saved = DesktopConnectionStore.Load();
        ApiUrlBox.Text = Environment.GetEnvironmentVariable("ZHIKE_API_BASE_URL") ?? saved?.BaseUrl ?? string.Empty;
        PairingProofBox.Password = Environment.GetEnvironmentVariable("ZHIKE_PAIRING_APPROVAL_CODE") ?? saved?.PairingApprovalCode ?? string.Empty;
    }

    private async void CheckServer(object sender, RoutedEventArgs args)
    {
        try
        {
            _api = CreateClient();
            var health = await _api.GetHealthAsync();
            SetStatus(InfoBarSeverity.Success, "服务正常", $"版本 {health?.AppVersion ?? "未知"}，数据库 {health?.DatabaseStatus ?? "未知"}，Worker {health?.WorkerStatus ?? "未知"}。");
        }
        catch (Exception error) { SetStatus(InfoBarSeverity.Warning, "服务不可用", error.Message); }
    }

    private async void PairServer(object sender, RoutedEventArgs args)
    {
        try
        {
            _api = CreateClient();
            var start = await _api.StartPairingAsync(new PairingStartRequest(_deviceId)) ?? throw new InvalidOperationException("配对服务未返回挑战码");
            var proof = ApiClient.ComputePairingProof(start.Code, _deviceId);
            var complete = await _api.CompletePairingAsync(new PairingCompleteRequest(start.Code, proof)) ?? throw new InvalidOperationException("配对服务未返回会话");
            if (!complete.Ok || string.IsNullOrWhiteSpace(complete.Token)) throw new InvalidOperationException(complete.Reason ?? "配对失败");
            _api.SetSessionToken(complete.Token);
            Environment.SetEnvironmentVariable("ZHIKE_API_BASE_URL", ApiUrlBox.Text.Trim());
            Environment.SetEnvironmentVariable("ZHIKE_API_TOKEN", complete.Token);
            DesktopConnectionStore.Save(new DesktopConnection(ApiUrlBox.Text.Trim(), complete.Token, PairingProofBox.Password));
            SetStatus(InfoBarSeverity.Success, "已连接", "本机配对完成；后续页面会自动使用当前会话。");
        }
        catch (Exception error) { SetStatus(InfoBarSeverity.Error, "配对失败", error.Message); }
    }

    private ApiClient CreateClient()
    {
        if (!Uri.TryCreate(ApiUrlBox.Text.Trim(), UriKind.Absolute, out var baseUri)) throw new InvalidOperationException("请输入有效的 API 地址");
        var client = new ApiClient(new HttpClient { BaseAddress = new Uri(baseUri.ToString().TrimEnd('/') + "/") });
        client.SetPairingApprovalCode(PairingProofBox.Password);
        return client;
    }

    private void SetStatus(InfoBarSeverity severity, string title, string message)
    {
        ServerStatus.Severity = severity;
        ServerStatus.Title = title;
        ServerStatus.Message = message;
        ServerStatus.IsOpen = true;
    }
}
