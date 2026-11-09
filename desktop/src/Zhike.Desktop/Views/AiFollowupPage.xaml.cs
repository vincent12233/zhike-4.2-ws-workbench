using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class AiFollowupPage : Page
{
    private readonly ApiClient? _api = ApiClient.TryCreateFromEnvironment();
    private readonly ObservableCollection<FollowupDto> _followups = [];
    private readonly ObservableCollection<AiJobDto> _jobs = [];
    private bool _loaded;

    public AiFollowupPage()
    {
        InitializeComponent();
        FollowupsList.ItemsSource = _followups;
        JobsList.ItemsSource = _jobs;
        StateFilter.SelectedIndex = 0;
        JobStateFilter.SelectedIndex = 0;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (_loaded) return;
        _loaded = true;
        await LoadFollowupsAsync();
        await LoadJobsAsync();
    }

    private async void RefreshFollowups(object sender, RoutedEventArgs args) => await LoadFollowupsAsync();
    private async void OnStateChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_loaded) await LoadFollowupsAsync();
    }
    private async void OnHighIntentChanged(object sender, RoutedEventArgs args)
    {
        if (_loaded) await LoadFollowupsAsync();
    }

    private async void RefreshJobs(object sender, RoutedEventArgs args) => await LoadJobsAsync();
    private async void OnJobStateChanged(object sender, SelectionChangedEventArgs args)
    {
        if (_loaded) await LoadJobsAsync();
    }

    private async void RetryFailedJobs(object sender, RoutedEventArgs args)
    {
        if (_api is null) return;
        var ids = _jobs.Where(job => job.State is "dead" or "retrying").Select(job => job.Id).ToArray();
        if (ids.Length == 0)
        {
            SetStatus(InfoBarSeverity.Informational, "没有失败任务", "当前列表没有可重试的 AI 任务。");
            return;
        }
        var changed = await _api.RetryAiJobsAsync(ids);
        SetStatus(InfoBarSeverity.Success, "已重新排队", $"{changed} 个 AI 任务已进入等待队列。");
        await LoadJobsAsync();
    }

    private async Task LoadJobsAsync()
    {
        try
        {
            if (_api is null) throw new InvalidOperationException("未配置 ZHIKE_API_BASE_URL");
            var state = (JobStateFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString();
            var rows = await _api.GetAiJobsAsync(state);
            _jobs.Clear();
            foreach (var row in rows ?? []) _jobs.Add(row);
        }
        catch (Exception error)
        {
            _jobs.Clear();
            SetStatus(InfoBarSeverity.Error, "AI 任务加载失败", error.Message);
        }
    }

    private async Task LoadFollowupsAsync()
    {
        FollowupLoading.IsActive = true;
        FollowupEmptyState.Visibility = Visibility.Collapsed;
        FollowupStatus.IsOpen = false;
        try
        {
            if (_api is null) throw new InvalidOperationException("未配置 ZHIKE_API_BASE_URL");
            var state = (StateFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString();
            var rows = await _api.GetFollowupsAsync(state);
            _followups.Clear();
            foreach (var row in rows ?? [])
            {
                if (!HighIntentToggle.IsChecked.GetValueOrDefault() || IsHighIntent(row)) _followups.Add(row);
            }
            FollowupEmptyState.Visibility = _followups.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (_followups.Count == 0) SetStatus(InfoBarSeverity.Informational, "暂无提醒", "当前筛选没有需要处理的 AI 跟进任务。");
        }
        catch (Exception error)
        {
            _followups.Clear();
            FollowupEmptyState.Visibility = Visibility.Visible;
            SetStatus(InfoBarSeverity.Error, "提醒加载失败", error.Message);
        }
        finally { FollowupLoading.IsActive = false; }
    }

    private static bool IsHighIntent(FollowupDto row)
        => string.Equals(row.Priority, "high", StringComparison.OrdinalIgnoreCase)
            || row.Priority.Contains("高", StringComparison.OrdinalIgnoreCase)
            || row.ReasonKey.Contains("high", StringComparison.OrdinalIgnoreCase)
            || row.ReasonKey.Contains("intent", StringComparison.OrdinalIgnoreCase);

    private void SetStatus(InfoBarSeverity severity, string title, string message)
    {
        FollowupStatus.Severity = severity;
        FollowupStatus.Title = title;
        FollowupStatus.Message = message;
        FollowupStatus.IsOpen = true;
    }
}
