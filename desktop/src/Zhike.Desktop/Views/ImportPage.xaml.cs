using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Dispatching;
using System.Text.Json;
using System.Collections.ObjectModel;
using System.Text;
using Zhike.Desktop.Services;

namespace Zhike.Desktop.Views;

public sealed partial class ImportPage : Page
{
    private readonly ApiClient? _api = ApiClient.TryCreateFromEnvironment();
    private readonly LocalQueue _queue = new();
    private readonly ObservableCollection<ImportPreviewRowDto> _preview = [];
    private readonly DispatcherQueueTimer? _queueTimer;
    private string? _batchId;
    private bool _loaded;

    public ImportPage()
    {
        InitializeComponent();
        PreviewList.ItemsSource = _preview;
        Loaded += OnLoaded;
        Unloaded += (_, _) => _queueTimer?.Stop();
        _queueTimer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_queueTimer is not null)
        {
            _queueTimer.Interval = TimeSpan.FromSeconds(10);
            _queueTimer.Tick += async (_, _) => await FlushImportQueueAsync();
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        _loaded = true;
        _queueTimer?.Start();
        await FlushImportQueueAsync();
    }

    private async void PreviewImport(object sender, RoutedEventArgs args) => await PreviewAsync();

    private async Task PreviewAsync()
    {
        var parsed = ParseCsv(CsvInput.Text);
        if (parsed.Headers.Count == 0 || parsed.Rows.Count == 0)
        {
            SetStatus(InfoBarSeverity.Informational, "没有可预览的数据", "请粘贴包含表头和至少一行数据的 CSV。");
            return;
        }
        var request = new ImportPreviewRequest(parsed.Headers, parsed.Rows, "desktop", SourceNameBox.Text.Trim());
        ImportLoading.IsActive = true;
        CommitButton.IsEnabled = false;
        ImportEmptyState.Visibility = Visibility.Collapsed;
        try
        {
            if (_api is null) throw new InvalidOperationException("未配置 ZHIKE_API_BASE_URL");
            var response = await _api.PreviewImportAsync(request);
            _preview.Clear();
            foreach (var row in response?.Rows ?? []) _preview.Add(row);
            _batchId = response?.Id;
            CommitButton.IsEnabled = !string.IsNullOrWhiteSpace(_batchId);
            ImportEmptyState.Visibility = _preview.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            SetStatus(InfoBarSeverity.Success, "预览完成", $"识别 {_preview.Count} 行，低置信度或冲突行请人工确认后再提交。");
        }
        catch (Exception error)
        {
            await _queue.EnqueueAsync("api/v2/import/batches/preview", request);
            _preview.Clear();
            ImportEmptyState.Visibility = Visibility.Visible;
            SetStatus(InfoBarSeverity.Warning, "已加入离线队列", $"服务端暂不可用：{error.Message}");
        }
        finally { ImportLoading.IsActive = false; }
    }

    private async void CommitImport(object sender, RoutedEventArgs args)
    {
        if (string.IsNullOrWhiteSpace(_batchId) || _api is null) return;
        try
        {
            if (await _api.CommitImportAsync(_batchId))
            {
                SetStatus(InfoBarSeverity.Success, "导入已提交", "批次已写入服务端，客户与业务记录将按原有规则去重。");
                CommitButton.IsEnabled = false;
            }
            else SetStatus(InfoBarSeverity.Error, "提交失败", "服务端未接受该批次。");
        }
        catch (Exception error) { SetStatus(InfoBarSeverity.Error, "提交失败", error.Message); }
    }

    private async Task FlushImportQueueAsync()
    {
        if (!_loaded || _api is null) return;
        try
        {
            foreach (var item in await _queue.PeekAsync())
            {
                if (!string.Equals(item.Route, "api/v2/import/batches/preview", StringComparison.Ordinal)) continue;
                var request = JsonSerializer.Deserialize<ImportPreviewRequest>(item.PayloadJson);
                if (request is null) { await _queue.RemoveAsync(item.Id); continue; }
                var response = await _api.PreviewImportAsync(request);
                await _queue.RemoveAsync(item.Id);
                _preview.Clear();
                foreach (var row in response?.Rows ?? []) _preview.Add(row);
                _batchId = response?.Id;
                CommitButton.IsEnabled = !string.IsNullOrWhiteSpace(_batchId);
                ImportEmptyState.Visibility = _preview.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                SetStatus(InfoBarSeverity.Success, "离线导入已恢复", $"已重新预览 {_preview.Count} 行，可继续确认并提交。");
            }
        }
        catch
        {
            // Keep queued input until the next retry interval.
        }
    }

    private static (IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string>> Rows) ParseCsv(string text)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Where(line => !string.IsNullOrWhiteSpace(line)).ToArray();
        if (lines.Length < 2) return ([], []);
        var headers = SplitCsvLine(lines[0]);
        var rows = lines.Skip(1).Select(SplitCsvLine).Where(row => row.Any(value => !string.IsNullOrWhiteSpace(value))).Cast<IReadOnlyList<string>>().ToArray();
        return (headers, rows);
    }

    private static IReadOnlyList<string> SplitCsvLine(string line)
    {
        var values = new List<string>();
        var builder = new StringBuilder();
        var quoted = false;
        for (var index = 0; index < line.Length; index++)
        {
            var ch = line[index];
            if (ch == '"' && (index + 1 >= line.Length || line[index + 1] != '"')) { quoted = !quoted; continue; }
            if (ch == '"' && index + 1 < line.Length && line[index + 1] == '"') { builder.Append('"'); index++; continue; }
            if (ch == ',' && !quoted) { values.Add(builder.ToString().Trim()); builder.Clear(); continue; }
            builder.Append(ch);
        }
        values.Add(builder.ToString().Trim());
        return values;
    }

    private void SetStatus(InfoBarSeverity severity, string title, string message)
    {
        ImportStatus.Severity = severity;
        ImportStatus.Title = title;
        ImportStatus.Message = message;
        ImportStatus.IsOpen = true;
    }
}
