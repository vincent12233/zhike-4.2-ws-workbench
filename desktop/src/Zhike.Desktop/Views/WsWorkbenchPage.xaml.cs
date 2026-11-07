using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Zhike.Desktop.Views;

public sealed partial class WsWorkbenchPage : Page
{
    private bool _leftCollapsed;
    private bool _rightCollapsed;

    public WsWorkbenchPage() => InitializeComponent();

    private void ToggleLeftPane(object sender, RoutedEventArgs args)
    {
        _leftCollapsed = !_leftCollapsed;
        LeftPaneColumn.Width = new GridLength(_leftCollapsed ? 0 : 220);
        LeftPane.Visibility = _leftCollapsed ? Visibility.Collapsed : Visibility.Visible;
    }

    private void ToggleRightPane(object sender, RoutedEventArgs args)
    {
        _rightCollapsed = !_rightCollapsed;
        RightPaneColumn.Width = new GridLength(_rightCollapsed ? 0 : 300);
        RightPane.Visibility = _rightCollapsed ? Visibility.Collapsed : Visibility.Visible;
    }

    private void AddAccount(object sender, RoutedEventArgs args)
    {
        AccountsList.Items.Add(new ListViewItem { Content = $"账号 {AccountsList.Items.Count + 1} · 等待登录" });
    }
}
