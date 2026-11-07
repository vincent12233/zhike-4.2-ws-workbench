using System.Threading.Channels;
using Zhike.Domain.Messaging;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Worker.Workers;

public sealed class WsIngestWorker(WsRepository wsRepository, ILogger<WsIngestWorker> logger) : BackgroundService
{
    private readonly Channel<MessageEnvelope> queue = Channel.CreateBounded<MessageEnvelope>(new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.Wait });

    public ValueTask EnqueueAsync(MessageEnvelope message, CancellationToken cancellationToken = default) => queue.Writer.WriteAsync(message, cancellationToken);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await wsRepository.IngestAsync(message, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogError(error, "WS message ingestion failed for account {AccountId}", message.AccountId);
            }
        }
    }
}
