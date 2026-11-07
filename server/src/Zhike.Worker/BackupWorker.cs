using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Zhike.Infrastructure.Secrets;

namespace Zhike.Worker;

public sealed record BackupReceipt(string Path, DateTimeOffset CreatedAt, bool Succeeded, string? Error);
public sealed record RestoreReport(string SourcePath, string TargetDatabase, bool DryRun, bool Succeeded, string? Error);

public sealed class BackupWorker(IConfiguration configuration, ILogger<BackupWorker> logger)
{
    public async Task<BackupReceipt> CreateSnapshotAsync(string reason, CancellationToken cancellationToken = default)
    {
        var root = Path.GetFullPath(configuration["ZHike:BackupDirectory"] ?? Path.Combine(AppContext.BaseDirectory, "backups"));
        Directory.CreateDirectory(root);
        var stamp = $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}";
        var output = Path.Combine(root, $"zhike-{stamp}.dump");
        var temporaryOutput = $"{output}.{Environment.ProcessId}.tmp";
        var connection = configuration.GetConnectionString("Postgres") ?? throw new InvalidOperationException("缺少 PostgreSQL 连接字符串。");
        var start = new ProcessStartInfo("pg_dump") { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = false, CreateNoWindow = true };
        start.ArgumentList.Add("--format=custom");
        start.ArgumentList.Add("--file");
        start.ArgumentList.Add(temporaryOutput);
        ConfigureConnection(start, connection);
        Process? process = null;
        try
        {
            process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 pg_dump");
            // Consume stderr concurrently so a verbose pg_dump failure cannot
            // fill the redirected pipe and deadlock the worker before exit.
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var errorText = (await errorTask).Trim();
            if (process.ExitCode != 0) throw new InvalidOperationException(errorText);
            File.Move(temporaryOutput, output, true);
            WriteManifest(output, reason);
            ApplyRetention(root, Math.Clamp(configuration.GetValue("ZHike:BackupRetention", 14), 1, 365));
            return new BackupReceipt(output, DateTimeOffset.UtcNow, true, null);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            if (File.Exists(temporaryOutput)) File.Delete(temporaryOutput);
            throw;
        }
        catch (Exception error)
        {
            logger.LogError("数据库备份失败：{Error}", SecretRedactor.Redact(error.Message));
            if (File.Exists(temporaryOutput)) File.Delete(temporaryOutput);
            return new BackupReceipt(output, DateTimeOffset.UtcNow, false, SecretRedactor.Redact(error.Message));
        }
        finally { TryKill(process); }
    }

    public RestoreReport RestoreSnapshot(string sourcePath, string targetDatabase, bool dryRun)
    {
        var source = Path.GetFullPath(sourcePath);
        if (!File.Exists(source)) return new(source, targetDatabase, dryRun, false, "备份文件不存在");
        if (dryRun) return new(source, targetDatabase, true, true, null);
        if (!configuration.GetValue("ZHike:AllowRestore", false)) return new(source, targetDatabase, false, false, "恢复默认关闭；请在隔离环境显式设置 ZHike:AllowRestore=true");
        if (string.IsNullOrWhiteSpace(targetDatabase)) return new(source, targetDatabase, false, false, "目标数据库不能为空");
        try
        {
            var start = new ProcessStartInfo("pg_restore")
            {
                UseShellExecute = false,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            start.ArgumentList.Add("--exit-on-error");
            ConfigureConnection(start, targetDatabase);
            start.ArgumentList.Add(source);
            using var process = Process.Start(start);
            if (process is null) return new(source, targetDatabase, false, false, "无法启动 pg_restore");
            var errorTask = process.StandardError.ReadToEndAsync();
            process.WaitForExit();
            var errorText = errorTask.GetAwaiter().GetResult();
            if (process.ExitCode != 0) return new(source, targetDatabase, false, false, SecretRedactor.Redact(errorText));
            return new(source, targetDatabase, false, true, null);
        }
        catch (Exception error) { return new(source, targetDatabase, false, false, SecretRedactor.Redact(error.Message)); }
    }

    private static void WriteManifest(string dumpPath, string reason)
    {
        var target = $"{dumpPath}.json";
        var temporary = $"{target}.{Environment.ProcessId}.tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(new { dumpPath, reason = SecretRedactor.Redact(reason), createdAt = DateTimeOffset.UtcNow }));
        File.Move(temporary, target, true);
    }

    private static void ApplyRetention(string root, int retention)
    {
        var files = Directory.EnumerateFiles(root, "zhike-*.dump").OrderByDescending(File.GetLastWriteTimeUtc).ToArray();
        foreach (var file in files.Skip(retention))
        {
            File.Delete(file);
            var manifest = $"{file}.json";
            if (File.Exists(manifest)) File.Delete(manifest);
        }
    }

    private static void ConfigureConnection(ProcessStartInfo start, string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        if (!string.IsNullOrWhiteSpace(builder.Host)) { start.ArgumentList.Add("--host"); start.ArgumentList.Add(builder.Host); }
        if (builder.Port > 0) { start.ArgumentList.Add("--port"); start.ArgumentList.Add(builder.Port.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
        if (!string.IsNullOrWhiteSpace(builder.Username)) { start.ArgumentList.Add("--username"); start.ArgumentList.Add(builder.Username); }
        if (!string.IsNullOrWhiteSpace(builder.Database)) { start.ArgumentList.Add("--dbname"); start.ArgumentList.Add(builder.Database); }
        if (!string.IsNullOrWhiteSpace(builder.Password)) start.Environment["PGPASSWORD"] = builder.Password;
        start.Environment["PGCONNECT_TIMEOUT"] = "30";
    }

    private static void TryKill(Process? process)
    {
        try
        {
            if (process is not null && !process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch { }
        finally { process?.Dispose(); }
    }
}
