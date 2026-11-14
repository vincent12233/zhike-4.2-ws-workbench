using Microsoft.UI.Xaml;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Zhike.Desktop.Services;

public sealed record DesktopToolsConfig(
    string Directory,
    int Minutes,
    int Keep,
    bool Enabled,
    string LastAt,
    string LastError);

public sealed record DesktopBackupResult(
    bool Skipped,
    string Path,
    string CreatedAt,
    long Bytes,
    string Reason = "");

public sealed record DesktopNotificationResult(bool Supported, string Reason = "");

/// <summary>
/// Owns the native-only productivity features used by the legacy web shell.
/// Configuration and generated backups live below %LOCALAPPDATA%\Zhike6, while
/// customer data remains owned by the guarded SQLite sidecar.
/// </summary>
public sealed class DesktopToolsService
{
    private const string BackupPrefix = "知客自动备份_";
    private readonly string _dataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6");
    private readonly SemaphoreSlim _configGate = new(1, 1);
    private readonly SemaphoreSlim _backupGate = new(1, 1);
    private readonly SemaphoreSlim _reminderGate = new(1, 1);
    private readonly Dictionary<string, DateTimeOffset> _notified = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNameCaseInsensitive = true,
    };
    private bool _notificationRegistered;

    public event Action<string>? CustomerNotificationInvoked;

    private string ConfigPath => Path.Combine(_dataRoot, "desktop-tools.json");
    private string DefaultBackupDirectory => Path.Combine(_dataRoot, "backups");

    public async Task<DesktopToolsConfig> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        await _configGate.WaitAsync(cancellationToken);
        try { return await LoadConfigUnlockedAsync(cancellationToken); }
        finally { _configGate.Release(); }
    }

    public async Task<DesktopToolsConfig> SelectDirectoryAsync(Window owner, CancellationToken cancellationToken = default)
    {
        var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
        picker.FileTypeFilter.Add("*");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(owner));
        var folder = await picker.PickSingleFolderAsync();
        cancellationToken.ThrowIfCancellationRequested();
        if (folder is null) return await GetStatusAsync(cancellationToken);
        var selected = Path.GetFullPath(folder.Path);
        Directory.CreateDirectory(selected);
        await _configGate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadConfigUnlockedAsync(cancellationToken);
            var updated = current with { Directory = selected, LastError = string.Empty };
            await SaveConfigUnlockedAsync(updated, cancellationToken);
            return updated;
        }
        finally { _configGate.Release(); }
    }

    public async Task<DesktopToolsConfig> ConfigureAsync(int minutes, int keep, bool enabled, CancellationToken cancellationToken = default)
    {
        await _configGate.WaitAsync(cancellationToken);
        try
        {
            var current = await LoadConfigUnlockedAsync(cancellationToken);
            var updated = current with
            {
                Minutes = Math.Clamp(minutes, 15, 1440),
                Keep = Math.Clamp(keep, 3, 100),
                Enabled = enabled,
                LastError = string.Empty,
            };
            Directory.CreateDirectory(updated.Directory);
            await SaveConfigUnlockedAsync(updated, cancellationToken);
            return updated;
        }
        finally { _configGate.Release(); }
    }

    public async Task<DesktopBackupResult> TryRunScheduledBackupAsync(ApiClient api, string accountId, CancellationToken cancellationToken = default)
    {
        var config = await GetStatusAsync(cancellationToken);
        if (!config.Enabled) return new(true, string.Empty, string.Empty, 0, "disabled");
        if (DateTimeOffset.TryParse(config.LastAt, out var lastAt)
            && DateTimeOffset.UtcNow - lastAt < TimeSpan.FromMinutes(config.Minutes))
            return new(true, string.Empty, config.LastAt, 0, "not-due");
        return await CreateBackupAsync(api, accountId, cancellationToken);
    }

    public async Task<DesktopBackupResult> CreateBackupAsync(ApiClient api, string accountId, CancellationToken cancellationToken = default)
    {
        if (!await _backupGate.WaitAsync(0, cancellationToken))
            return new(true, string.Empty, string.Empty, 0, "busy");
        try
        {
            var config = await GetStatusAsync(cancellationToken);
            var directory = Path.GetFullPath(string.IsNullOrWhiteSpace(config.Directory) ? DefaultBackupDirectory : config.Directory);
            Directory.CreateDirectory(directory);

            var stateResponse = await api.SendJsonAsync("api/state", HttpMethod.Get, cancellationToken: cancellationToken);
            if (!stateResponse.Ok || stateResponse.Data is null)
                throw new InvalidOperationException("无法读取本机业务数据，未生成备份。");
            var state = JsonNode.Parse(stateResponse.Data.Value.GetRawText())?.AsObject()
                ?? throw new InvalidDataException("本机业务数据格式异常，未生成备份。");
            state.Remove("initialized");
            state.Remove("version");

            var activeAccount = string.IsNullOrWhiteSpace(accountId) ? "default" : accountId.Trim();
            var wsAccounts = new JsonObject();
            var wsAccountMetadata = new JsonArray();
            JsonNode? activeWs = null;
            var accounts = await api.GetWsAccountsAsync(cancellationToken) ?? [];
            foreach (var account in accounts)
            {
                wsAccountMetadata.Add(new JsonObject
                {
                    ["id"] = account.Id,
                    ["displayName"] = account.DisplayName,
                    ["status"] = account.Status,
                });
                cancellationToken.ThrowIfCancellationRequested();
                var response = await api.SendJsonAsync($"api/ws/export?accountId={Uri.EscapeDataString(account.Id)}", HttpMethod.Get, cancellationToken: cancellationToken);
                if (!response.Ok || response.Data is null) continue;
                var node = JsonNode.Parse(response.Data.Value.GetRawText());
                if (node is null) continue;
                wsAccounts[account.Id] = node.DeepClone();
                if (account.Id.Equals(activeAccount, StringComparison.OrdinalIgnoreCase)) activeWs = node.DeepClone();
            }
            if (activeWs is null)
            {
                var response = await api.SendJsonAsync($"api/ws/export?accountId={Uri.EscapeDataString(activeAccount)}", HttpMethod.Get, cancellationToken: cancellationToken);
                if (response.Ok && response.Data is not null)
                    activeWs = JsonNode.Parse(response.Data.Value.GetRawText());
            }

            var createdAt = DateTimeOffset.UtcNow;
            state["appVersion"] = "6.0.1";
            state["version"] = 5;
            state["schemaVersion"] = 5;
            state["createdAt"] = createdAt.ToString("O");
            state["summary"] = BuildSummary(state);
            state["ws"] = activeWs ?? EmptyWsBackup(createdAt);
            state["wsAccounts"] = wsAccounts;
            state["wsAccountMetadata"] = wsAccountMetadata;

            var bytes = JsonSerializer.SerializeToUtf8Bytes(state, _json);
            if (bytes.LongLength > 250L * 1024 * 1024)
                throw new InvalidDataException("完整备份超过 250 MB 安全上限，未写入文件。");
            var filename = $"{BackupPrefix}{createdAt.ToLocalTime():yyyyMMdd_HHmmssfff}.json";
            var finalPath = Path.Combine(directory, filename);
            EnsureDirectChild(directory, finalPath);
            var temporaryPath = finalPath + $".{Guid.NewGuid():N}.tmp";
            try
            {
                await File.WriteAllBytesAsync(temporaryPath, bytes, cancellationToken);
                File.Move(temporaryPath, finalPath, overwrite: false);
            }
            finally
            {
                try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
            }

            RetainManagedBackups(directory, config.Keep);
            var updated = config with { LastAt = createdAt.ToString("O"), LastError = string.Empty };
            await SaveConfigAsync(updated, cancellationToken);
            return new(false, finalPath, updated.LastAt, bytes.LongLength);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            try
            {
                var current = await GetStatusAsync(CancellationToken.None);
                await SaveConfigAsync(current with { LastError = SafeError(error.Message) }, CancellationToken.None);
            }
            catch { }
            throw;
        }
        finally { _backupGate.Release(); }
    }

    public DesktopNotificationResult Notify(string customerId, string body)
    {
        try
        {
            var manager = AppNotificationManager.Default;
            if (!_notificationRegistered)
            {
                manager.NotificationInvoked += OnNotificationInvoked;
                manager.Register();
                _notificationRegistered = true;
            }
            var safeId = Regex.Replace(customerId ?? string.Empty, @"[^\p{L}\p{N}_-]", string.Empty);
            if (safeId.Length > 96) safeId = safeId[..96];
            var safeBody = RedactNotificationBody(body);
            var builder = new AppNotificationBuilder()
                .AddArgument("action", "openCustomer")
                .AddArgument("customer", safeId)
                .AddText("知客跟进提醒")
                .AddText(string.IsNullOrWhiteSpace(safeBody) ? "有客户需要跟进，请打开今日工作台查看。" : safeBody);
            manager.Show(builder.BuildNotification());
            return new(true);
        }
        catch (Exception error)
        {
            return new(false, SafeError(error.Message));
        }
    }

    public async Task<int> PollDueRemindersAsync(ApiClient api, CancellationToken cancellationToken = default)
    {
        if (!await _reminderGate.WaitAsync(0, cancellationToken)) return 0;
        try
        {
            var response = await api.SendJsonAsync("api/state", HttpMethod.Get, cancellationToken: cancellationToken);
            if (!response.Ok || response.Data is null) return 0;
            using var document = JsonDocument.Parse(response.Data.Value.GetRawText());
            var root = document.RootElement;
            if (!root.TryGetProperty("settings", out var settings) || settings.ValueKind != JsonValueKind.Object) return 0;
            if (!settings.TryGetProperty("desktopReminders", out var enabled) || enabled.ValueKind != JsonValueKind.True) return 0;
            if (settings.TryGetProperty("reminderSnoozeUntil", out var snooze)
                && snooze.TryGetInt64(out var snoozeUntil)
                && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < snoozeUntil) return 0;
            if (!root.TryGetProperty("customers", out var customers) || customers.ValueKind != JsonValueKind.Array) return 0;
            var today = DateTimeOffset.Now.ToString("yyyy-MM-dd");
            var now = DateTimeOffset.UtcNow;
            foreach (var expired in _notified.Where(pair => now - pair.Value >= TimeSpan.FromHours(1)).Select(pair => pair.Key).ToArray())
                _notified.Remove(expired);
            var count = 0;
            foreach (var customer in customers.EnumerateArray())
            {
                if (customer.TryGetProperty("deleted", out var deleted) && deleted.ValueKind == JsonValueKind.True) continue;
                var due = JsonText(customer, "due");
                if (!Regex.IsMatch(due, @"^\d{4}-\d{2}-\d{2}$") || string.CompareOrdinal(due, today) > 0) continue;
                var id = JsonText(customer, "id");
                var key = $"{id}:{due}";
                if (string.IsNullOrWhiteSpace(id) || _notified.ContainsKey(key)) continue;
                var name = JsonText(customer, "name");
                var result = Notify(id, $"{(string.IsNullOrWhiteSpace(name) ? "客户" : name)} · {(string.CompareOrdinal(due, today) < 0 ? "已逾期" : "今日到期")} · 点击查看客户");
                if (result.Supported) _notified[key] = now;
                if (++count >= 3) break;
            }
            return count;
        }
        finally { _reminderGate.Release(); }
    }

    public void UnregisterNotifications()
    {
        if (!_notificationRegistered) return;
        try
        {
            AppNotificationManager.Default.NotificationInvoked -= OnNotificationInvoked;
            AppNotificationManager.Default.Unregister();
        }
        catch { }
        _notificationRegistered = false;
    }

    private void OnNotificationInvoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args)
    {
        try
        {
            var match = Regex.Match(args.Argument ?? string.Empty, @"(?:^|&)customer=([^&]*)", RegexOptions.IgnoreCase);
            var customerId = match.Success ? Uri.UnescapeDataString(match.Groups[1].Value) : string.Empty;
            if (!string.IsNullOrWhiteSpace(customerId)) CustomerNotificationInvoked?.Invoke(customerId);
        }
        catch { }
    }

    private async Task<DesktopToolsConfig> LoadConfigUnlockedAsync(CancellationToken cancellationToken)
    {
        var fallback = new DesktopToolsConfig(DefaultBackupDirectory, 60, 10, false, string.Empty, string.Empty);
        try
        {
            if (!File.Exists(ConfigPath)) return fallback;
            var json = await File.ReadAllTextAsync(ConfigPath, cancellationToken);
            var value = JsonSerializer.Deserialize<DesktopToolsConfig>(json, _json);
            if (value is null) return fallback;
            var directory = string.IsNullOrWhiteSpace(value.Directory) ? DefaultBackupDirectory : Path.GetFullPath(value.Directory);
            return value with
            {
                Directory = directory,
                Minutes = Math.Clamp(value.Minutes, 15, 1440),
                Keep = Math.Clamp(value.Keep, 3, 100),
                LastError = SafeError(value.LastError),
            };
        }
        catch { return fallback; }
    }

    private async Task SaveConfigAsync(DesktopToolsConfig config, CancellationToken cancellationToken)
    {
        await _configGate.WaitAsync(cancellationToken);
        try { await SaveConfigUnlockedAsync(config, cancellationToken); }
        finally { _configGate.Release(); }
    }

    private async Task SaveConfigUnlockedAsync(DesktopToolsConfig config, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_dataRoot);
        var temporary = ConfigPath + $".{Guid.NewGuid():N}.tmp";
        try
        {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(config, _json), cancellationToken);
            File.Move(temporary, ConfigPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    private static JsonObject BuildSummary(JsonObject state)
        => new()
        {
            ["customers"] = Count(state, "customers"),
            ["tickets"] = Count(state, "tickets"),
            ["deposits"] = Count(state, "deposits"),
            ["followups"] = Count(state, "followups"),
            ["registrations"] = Count(state, "registrations"),
            ["phoneRegistry"] = Count(state, "phoneRegistry"),
            ["batchOperations"] = Count(state, "batchOperations"),
        };

    private static int Count(JsonObject state, string name) => state[name] is JsonArray values ? values.Count : 0;

    private static string JsonText(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
            ? value.ToString().Trim()
            : string.Empty;

    private static JsonObject EmptyWsBackup(DateTimeOffset createdAt)
        => new()
        {
            ["schemaVersion"] = 6,
            ["createdAt"] = createdAt.ToString("O"),
            ["settings"] = new JsonArray(),
            ["conversations"] = new JsonArray(),
            ["messages"] = new JsonArray(),
            ["analyses"] = new JsonArray(),
            ["replies"] = new JsonArray(),
            ["batches"] = new JsonArray(),
            ["collectionRuns"] = new JsonArray(),
            ["collectionItems"] = new JsonArray(),
            ["followupAlerts"] = new JsonArray(),
        };

    private static void RetainManagedBackups(string directory, int keep)
    {
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var managed = Directory.EnumerateFiles(directory, $"{BackupPrefix}*.json", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFullPath)
            .Where(path => path.StartsWith(root, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(path).StartsWith(BackupPrefix, StringComparison.Ordinal)
                && Path.GetExtension(path).Equals(".json", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .ThenByDescending(Path.GetFileName, StringComparer.Ordinal)
            .ToArray();
        foreach (var path in managed.Skip(Math.Clamp(keep, 3, 100)))
            try { File.Delete(path); } catch { }
    }

    private static void EnsureDirectChild(string directory, string path)
    {
        var root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(path);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(Path.GetDirectoryName(full)?.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("备份目标不在所选目录中，已取消写入。");
    }

    private static string SafeError(string? message)
    {
        var value = Regex.Replace(message ?? string.Empty, @"(?i)(api[_ -]?key|token|authorization)\s*[:=]\s*\S+", "$1=[已隐藏]");
        return value.Length > 240 ? value[..240] : value;
    }

    private static string RedactNotificationBody(string? body)
    {
        var value = (body ?? string.Empty).Trim();
        value = Regex.Replace(
            value,
            @"(?<!\p{L})(?:\+?\d[\d\s().-]{5,}\d)(?!\p{L})",
            match => match.Value.Count(char.IsDigit) >= 7 ? "***" : match.Value);
        value = Regex.Replace(value, @"\d{7,}", "***");
        return value.Length > 180 ? value[..180] : value;
    }
}
