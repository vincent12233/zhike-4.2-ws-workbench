using Microsoft.Extensions.Configuration;

namespace Zhike.Worker;

/// <summary>
/// Runs the existing backup helper on a bounded interval. The helper remains
/// callable for manual snapshots; this scheduler only adds automatic copies
/// and never removes files outside the zhike-* retention set.
/// </summary>
public sealed class BackupScheduler(
    BackupWorker backup,
    IConfiguration configuration,
    ILogger<BackupScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var intervalMinutes = Math.Clamp(configuration.GetValue("ZHike:BackupIntervalMinutes", 60), 5, 24 * 60);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(intervalMinutes));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            for (var attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    var receipt = await backup.CreateSnapshotAsync("scheduled", stoppingToken);
                    if (receipt.Succeeded || attempt == 3)
                    {
                        if (!receipt.Succeeded) logger.LogWarning("自动备份未完成：{Error}", receipt.Error);
                        break;
                    }
                    logger.LogWarning("自动备份第 {Attempt} 次未完成，将重试：{Error}", attempt, receipt.Error);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception error)
                {
                    if (attempt == 3)
                    {
                        logger.LogError(error, "自动备份任务失败");
                        break;
                    }
                    logger.LogWarning(error, "自动备份第 {Attempt} 次失败，将重试", attempt);
                }

                await Task.Delay(TimeSpan.FromSeconds(Math.Min(60, attempt * 10)), stoppingToken);
            }
        }
    }
}
