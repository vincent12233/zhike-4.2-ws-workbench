using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Windowing;
using Microsoft.UI;
using WinRT.Interop;
using Zhike.Desktop.Views;

namespace Zhike.Desktop;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        SetBrandTitle();
        RootNavigation.SelectedItem = RootNavigation.MenuItems[0];
        ContentFrame.Navigate(typeof(HomePage));
    }

    private void SetBrandTitle()
    {
        // The unpackaged WinUI shell otherwise exposes the generic "WinUI
        // Desktop" title. Keep the OS chrome aligned with the existing
        // Zhike branding, while treating title assignment as best-effort so
        // it can never prevent the workbench from starting.
        try
        {
            var hWnd = WindowNative.GetWindowHandle(this);
            var windowId = Win32Interop.GetWindowIdFromWindow(hWnd);
            AppWindow.GetFromWindowId(windowId).Title = "知客工作台";
        }
        catch
        {
            // Some preview/runtime hosts do not expose an AppWindow yet.
        }
    }

    private void OnNavigationChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item || item.Tag is not string tag) return;
        var pageType = tag switch
        {
            "customers" => typeof(CustomersPage),
            "import" => typeof(ImportPage),
            "operations" => typeof(OperationsPage),
            "ws" => typeof(WsWorkbenchPage),
            "ai" => typeof(AiFollowupPage),
            _ => typeof(HomePage),
        };
        if (ContentFrame.CurrentSourcePageType != pageType) ContentFrame.Navigate(pageType);
    }
}
