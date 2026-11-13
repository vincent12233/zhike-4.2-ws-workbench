using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class OperationsPage : Page
{
    private readonly ApiClient? _api = ApiClient.TryCreateFromEnvironment();
    private readonly ObservableCollection<BusinessRecordDto> _records = [];
    private bool _loaded;

    public OperationsPage()
    {
        InitializeComponent();
        OperationsList.ItemsSource = _records;
        DirectionFilter.SelectedIndex = 0;
        OperationsPivot.SelectedIndex = 0;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (_loaded) return;
        _loaded = true;
        await LoadOperationsAsync();
    }

    private async void RefreshOperations(object sender, RoutedEventArgs args) => await LoadOperationsAsync();
    private async void OnPivotChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_loaded) await LoadOperationsAsync();
    }
    private async void OnProductFilterChanged(object sender, TextChangedEventArgs args)
    {
        if (_loaded) await LoadOperationsAsync();
    }
    private async void OnDirectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_loaded) await LoadOperationsAsync();
    }

    private async Task LoadOperationsAsync()
    {
        OperationsLoading.IsActive = true;
        OperationsEmptyState.Visibility = Visibility.Collapsed;
        OperationsStatus.IsOpen = false;
        try
        {
            if (_api is null) throw new InvalidOperationException("本机数据服务尚未就绪，请返回工作台后重试。");
            var type = (OperationsPivot.SelectedItem as PivotItem)?.Tag?.ToString() ?? "ticket";
            var direction = (DirectionFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString();
            _records.Clear();
            if (type.Equals("followup", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var followup in await _api.GetFollowupsAsync() ?? [])
                {
                    _records.Add(new BusinessRecordDto(followup.Id, followup.CustomerId, "followup", string.Empty, string.Empty, null, null, followup.DueAt?.ToString("yyyy-MM-dd"), string.Empty, followup.State, string.Empty, followup.Detail, followup.ReasonKey, followup.DueAt ?? DateTimeOffset.MinValue));
                }
            }
            else
            {
                var requestedType = type is "stats" or "vip" ? null : type;
                foreach (var record in await _api.GetBusinessRecordsAsync(ProductFilter.Text, requestedType, direction) ?? [])
                {
                    if (type.Equals("vip", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(record.VipCode)) continue;
                    _records.Add(record);
                }
            }
            OperationsEmptyState.Visibility = _records.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (type.Equals("stats", StringComparison.OrdinalIgnoreCase)) StatisticsText.Text = $"当前筛选共 {_records.Count} 条业务记录；统计以服务端明细为准。";
            if (_records.Count == 0) SetStatus(InfoBarSeverity.Informational, "暂无记录", "调整股票代码、方向或切换业务标签后重试。");
        }
        catch (Exception error)
        {
            _records.Clear();
            OperationsEmptyState.Visibility = Visibility.Visible;
            SetStatus(InfoBarSeverity.Error, "运营数据加载失败", error.Message);
        }
        finally { OperationsLoading.IsActive = false; }
    }

    private void SetStatus(InfoBarSeverity severity, string title, string message)
    {
        OperationsStatus.Severity = severity;
        OperationsStatus.Title = title;
        OperationsStatus.Message = message;
        OperationsStatus.IsOpen = true;
    }
}
