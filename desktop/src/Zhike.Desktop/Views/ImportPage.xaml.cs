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
        var requestedTarget = (ImportTargetBox.SelectedItem as ComboBoxItem)?.Tag?.ToString()?.Trim().ToLowerInvariant() ?? "auto";
        var target = requestedTarget is "customer" or "ticket" or "deposit" or "mixed"
            ? requestedTarget
            : InferImportTarget(parsed.Headers);
        var request = new ImportPreviewRequest(parsed.Headers, parsed.Rows, "desktop", SourceNameBox.Text.Trim(), target);
        ImportLoading.IsActive = true;
        CommitButton.IsEnabled = false;
        ImportEmptyState.Visibility = Visibility.Collapsed;
        try
        {
            if (_api is null) throw new InvalidOperationException("本机数据服务尚未就绪，请返回工作台后重试。");
            var response = await _api.PreviewImportAsync(request);
            _preview.Clear();
            foreach (var row in response?.Rows ?? []) _preview.Add(row);
            _batchId = response?.Id;
            CommitButton.IsEnabled = !string.IsNullOrWhiteSpace(_batchId);
            ImportEmptyState.Visibility = _preview.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (!string.IsNullOrWhiteSpace(response?.DuplicateOf))
            {
                SetStatus(InfoBarSeverity.Warning, "发现重复导入文件", $"该文件与批次 {response.DuplicateOf} 内容一致。为避免重复写入，提交按钮已关闭；请核对后更换文件。");
                CommitButton.IsEnabled = false;
            }
            else
            {
                SetStatus(InfoBarSeverity.Success, "预览完成", $"识别 {_preview.Count} 行 · 目标：{TargetLabel(target)}。低置信度或冲突行请人工确认后再提交。");
            }
        }
        catch (Exception error)
        {
            await _queue.EnqueueAsync("local/import/preview", request);
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
                if (!string.Equals(item.Route, "local/import/preview", StringComparison.Ordinal)) continue;
                try
                {
                    var request = LocalQueue.DeserializePayload<ImportPreviewRequest>(item.PayloadJson)
                        ?? throw new InvalidDataException("导入待同步数据无法反序列化。");
                    if (request.Headers is null || request.Rows is null || request.Headers.Count == 0)
                        throw new InvalidDataException("导入待同步数据缺少表头或数据行。");
                    var response = await _api.PreviewImportAsync(request);
                    await _queue.RemoveAsync(item.Id);
                    _preview.Clear();
                    foreach (var row in response?.Rows ?? []) _preview.Add(row);
                    _batchId = response?.Id;
                    CommitButton.IsEnabled = !string.IsNullOrWhiteSpace(_batchId);
                    ImportEmptyState.Visibility = _preview.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                    SetStatus(InfoBarSeverity.Success, "离线导入已恢复", $"已重新预览 {_preview.Count} 行 · 目标：{TargetLabel(request.Target)}，可继续确认并提交。");
                }
                catch (Exception error)
                {
                    await _queue.MarkFailureAsync(item.Id, error);
                    break;
                }
            }
        }
        catch
        {
            // Keep queued input until the next retry interval.
        }
    }

    internal static string InferImportTarget(IReadOnlyList<string> headers)
    {
        var list = headers.Select(value => (value ?? string.Empty).Trim()).ToArray();
        static bool Has(string value, params string[] tokens) => tokens.Any(token => value.Contains(token, StringComparison.OrdinalIgnoreCase));
        static bool Exact(string value, params string[] tokens) => tokens.Any(token => string.Equals(value, token, StringComparison.OrdinalIgnoreCase));

        // Customer-center exports often contain columns named “跟票/入金/报名”
        // and “入金金额”.  Those are *derived customer attributes*, not a
        // request to create business rows.  Keep them inside the customer
        // boundary unless a real business date/reference/product is present.
        var hasIdentity = list.Any(value => Has(value, "姓名", "名称", "name", "customer", "联系人", "昵称"))
            && list.Any(value => Has(value, "电话", "手机", "号码", "phone", "mobile", "contact"));
        var hasCustomerCore = list.Any(value => Has(value, "渠道", "来源", "状态", "登记", "注册", "入群", "客户阶段", "phase", "source", "助理", "负责人"));
        var derivedCustomer = list.Any(value => Exact(value, "跟票", "跟票状态", "是否跟票", "入金", "入金状态", "是否入金", "报名", "报名状态", "热聊", "热聊状态", "VIP", "VIP状态", "是否股民", "最后跟进", "下次跟进", "下次跟进日期", "登记日期", "登记时间", "入金金额"));
        var explicitRecordType = list.Any(value => Has(value, "记录类型", "业务类型", "数据类型", "recordtype", "business.type"));
        var ticketSignals = list.Any(value => Has(value, "股票代码", "证券代码", "产品代码", "交易流水", "成交编号", "订单号", "跟票日期", "买入日期", "卖出日期", "买卖方向", "交易方向", "trade.ref"));
        var depositSignals = list.Any(value => Has(value, "入金日期", "付款日期", "充值日期", "支付流水", "付款流水", "币种", "currency", "付款金额", "充值金额", "deposit", "payment"))
            || list.Any(value => Exact(value, "业务日期", "交易日期", "交易时间") && list.Any(other => Has(other, "金额", "amount")));
        var productOrDirection = list.Any(value => Has(value, "股票", "证券", "品种", "symbol", "stock", "product"))
            && list.Any(value => Has(value, "方向", "买卖", "操作", "side", "action"));

        if (hasIdentity && hasCustomerCore && derivedCustomer && !ticketSignals && !depositSignals && !explicitRecordType && !productOrDirection)
            return "customer";
        if (ticketSignals || productOrDirection) return hasIdentity ? "mixed" : "ticket";
        if (depositSignals) return hasIdentity ? "mixed" : "deposit";
        // A record-type column is an explicit opt-in to row-level routing;
        // without it, never infer business rows from a generic “金额” or
        // “状态” column in a customer export.
        if (explicitRecordType) return "mixed";
        return "customer";
    }

    private static string TargetLabel(string? target) => (target ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "customer" => "客户中心（仅客户资料）",
        "ticket" => "跟票业务",
        "deposit" => "入金业务",
        "mixed" => "混合业务（按行分流）",
        _ => "自动识别",
    };

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
