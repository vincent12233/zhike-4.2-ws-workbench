using Zhike.Infrastructure.Database;

namespace Zhike.Worker;

/// <summary>
/// Publishes a bounded liveness signal so the desktop health panel can tell a
/// running worker from a stale container. Heartbeats never contain message or
/// customer content.
/// </summary>
public sealed class WorkerHeartbeatService(
    WorkerHeartbeatRepository repository,
    ILogger<WorkerHeartbeatService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await repository.MarkAliveAsync("ai-worker", stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "Worker heartbeat update failed");
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}
