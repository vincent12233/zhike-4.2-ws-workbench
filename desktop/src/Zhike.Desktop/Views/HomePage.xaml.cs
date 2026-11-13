using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class HomePage : Page
{
    public HomePage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await CheckAsync();
    }

    private async void CheckLocalService(object sender, RoutedEventArgs args) => await CheckAsync();

    private async Task CheckAsync()
    {
        try
        {
            var info = await App.EnsureLocalServiceAsync();
            var healthy = await App.LocalService!.HealthAsync();
            if (!healthy) throw new InvalidOperationException("本机数据服务未响应，请关闭后重新打开知客。");
            var api = App.LocalService.CreateApiClient();
            var health = await api.GetHealthAsync();
            ServiceStatusText.Text = "运行正常";
            ServiceDetailText.Text = $"端口 {info.Port} · 版本 {health?.AppVersion ?? "未知"} · 数据库 {health?.DatabaseStatus ?? "healthy"} · 服务目录已隔离保存。";
            SetStatus(InfoBarSeverity.Success, "服务正常", "知客正在使用本机 SQLite；无需 Docker 或远程配对。", true);
        }
        catch (Exception error)
        {
            ServiceStatusText.Text = "暂不可用";
            ServiceDetailText.Text = error.Message;
            SetStatus(InfoBarSeverity.Error, "本机服务异常", error.Message, true);
        }
    }

    private void OpenDataCenter(object sender, RoutedEventArgs args) => App.MainWindowInstance?.OpenWorkspaceRoute("data");

    private void ReturnToWorkspace(object sender, RoutedEventArgs args) => App.MainWindowInstance?.ReturnToLegacyHost();

    private void SetStatus(InfoBarSeverity severity, string title, string message, bool open)
    {
        ServiceStatusBar.Severity = severity;
        ServiceStatusBar.Title = title;
        ServiceStatusBar.Message = message;
        ServiceStatusBar.IsOpen = open;
    }
}
