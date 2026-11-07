namespace Zhike.Worker.Workers;

public sealed class AiAnalysisWorker(JobDispatcher dispatcher, IAiAnalysisProvider provider, ILogger<AiAnalysisWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await dispatcher.DispatchOnceAsync(provider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogError(error, "AI analysis dispatch cycle failed");
            }
        }
    }
}
