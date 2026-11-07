using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<PlaceholderWorker>();
using var host = builder.Build();
await host.RunAsync();

internal sealed class PlaceholderWorker(ILogger<PlaceholderWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Zhike worker skeleton started");
        await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
    }
}
