using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class CustomersPage : Page
{
    private readonly ApiClient? _api = ApiClient.TryCreateFromEnvironment();
    private readonly ObservableCollection<CustomerDto> _customers = [];
    private bool _loaded;

    public CustomersPage()
    {
        InitializeComponent();
        CustomersList.ItemsSource = _customers;
        StageFilter.SelectedIndex = 0;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (_loaded) return;
        _loaded = true;
        await LoadCustomersAsync();
    }

    private async void RefreshCustomers(object sender, RoutedEventArgs args) => await LoadCustomersAsync();
    private async void OnSearchChanged(object sender, TextChangedEventArgs args)
    {
        if (_loaded) await LoadCustomersAsync();
    }
    private async void OnStageChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_loaded) await LoadCustomersAsync();
    }

    private async Task LoadCustomersAsync()
    {
        CustomersLoading.IsActive = true;
        CustomersEmptyState.Visibility = Visibility.Collapsed;
        CustomersStatus.IsOpen = false;
        try
        {
            if (_api is null) throw new InvalidOperationException("本机数据服务尚未就绪，请返回工作台后重试。");
            var rows = await _api.GetCustomersAsync(SearchBox.Text);
            var stage = (StageFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? string.Empty;
            _customers.Clear();
            foreach (var row in rows ?? [])
            {
                if (string.IsNullOrWhiteSpace(stage) || string.Equals(row.Stage, stage, StringComparison.OrdinalIgnoreCase)) _customers.Add(row);
            }
            CustomersEmptyState.Visibility = _customers.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (_customers.Count == 0) SetStatus(InfoBarSeverity.Informational, "暂无客户", "调整搜索条件或先在快速录入中创建客户。");
        }
        catch (Exception error)
        {
            _customers.Clear();
            CustomersEmptyState.Visibility = Visibility.Visible;
            SetStatus(InfoBarSeverity.Error, "客户加载失败", error.Message);
        }
        finally { CustomersLoading.IsActive = false; }
    }

    private void ExportCustomers(object sender, RoutedEventArgs args)
    {
        if (_customers.Count == 0)
        {
            SetStatus(InfoBarSeverity.Informational, "没有可导出的客户", "请先加载客户数据。");
            return;
        }
        SetStatus(InfoBarSeverity.Informational, "已准备导出", $"当前筛选包含 {_customers.Count} 位客户，可从应用数据目录继续处理。");
    }

    private void SetStatus(InfoBarSeverity severity, string title, string message)
    {
        CustomersStatus.Severity = severity;
        CustomersStatus.Title = title;
        CustomersStatus.Message = message;
        CustomersStatus.IsOpen = true;
    }
}
