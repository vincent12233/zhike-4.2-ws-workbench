using System.Net;
using System.Text.Json;

namespace Zhike.Desktop.Services;

public static class WsIngestQueue
{
    public static async Task FlushAsync(LocalQueue queue, ApiClient api,
        Action<WsIngestBatchRequestDto, WsIngestBatchResponseDto> onSynced, CancellationToken cancellationToken = default)
    {
        var deferredAccounts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in await queue.PeekAsync(cancellationToken))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (item.Route != "api/ws/ingest/batch") continue;
            WsIngestBatchRequestDto? request = null;
            WsIngestBatchResponseDto result;
            try
            {
                request = LocalQueue.DeserializePayload<WsIngestBatchRequestDto>(item.PayloadJson)
                    ?? throw new InvalidDataException("WS 待同步数据无法反序列化。");
                if (deferredAccounts.Contains(request.AccountId)) continue;
                ApiClient.ValidateWsIngestBatch(request);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(15));
                await api.AuthorizeWsCollectorBatchAsync(request, timeout.Token);
                result = await api.IngestWsBatchAsync(request, timeout.Token)
                    ?? throw new InvalidDataException("本机服务未返回 WS 入库结果。");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                await queue.MarkFailureAsync(item.Id, error, cancellationToken);
                // Retry an unavailable service on the next tick. A rejected packet
                // only blocks later checkpoints belonging to that same account.
                if (error is not (InvalidDataException or JsonException or HttpRequestException
                    { StatusCode: HttpStatusCode.BadRequest or HttpStatusCode.NotFound or HttpStatusCode.UnprocessableEntity })) break;
                if (!string.IsNullOrEmpty(request?.AccountId)) deferredAccounts.Add(request.AccountId);
                continue;
            }
            await queue.RemoveAsync(item.Id, cancellationToken);
            onSynced(request, result);
        }
    }
}
