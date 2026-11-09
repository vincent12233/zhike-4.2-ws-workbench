using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Zhike.Contracts;
using Zhike.Domain.Messaging;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Api.Routes;

public static class WsRoutes
{
    private const long MaxRequestBytes = 8L * 1024 * 1024;
    private const int MaxAccountIdLength = 160;
    private const int MaxConnectorIdLength = 160;
    private const int MaxDisplayNameLength = 200;
    private const string Protocol = "zhike.ws.ingest.batch.v1";
    private const string Scope = "visible-authorized-content";
    private static readonly HashSet<string> AccountStatuses = new(StringComparer.Ordinal) { "未连接", "等待登录", "登录中", "已连接", "会话过期", "连接失败", "正在重连" };
    private static readonly HashSet<string> Directions = new(StringComparer.OrdinalIgnoreCase) { "incoming", "outgoing", "receive", "send" };

    public static IEndpointRouteBuilder MapWsRoutes(this IEndpointRouteBuilder endpoints)
    {
        // Apply the limit at the server boundary so chunked requests are
        // rejected before JSON model binding allocates a large object graph.
        var group = endpoints.MapGroup("/api/v2/ws")
            .WithMetadata(new RequestSizeLimitAttribute(MaxRequestBytes));
        group.MapPost("/ingest/batch", IngestBatchAsync);
        group.MapPost("/checkpoints", SaveCheckpointsAsync);
        group.MapPost("/heartbeat", async (WsHeartbeatRequest request, WsRepository repository, CancellationToken cancellationToken) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.AccountId) || request.AccountId.Trim().Length > MaxAccountIdLength || !AccountStatuses.Contains(request.Status?.Trim() ?? string.Empty)) return (IResult)Results.BadRequest("accountId and a supported status are required");
            var changed = await repository.UpdateAccountStatusAsync(request.AccountId, request.Status!, cancellationToken);
            if (changed > 0) return Results.Ok(new { changed, status = request.Status, at = DateTimeOffset.UtcNow, created = false });
            var created = await repository.UpsertAccountAsync(request.AccountId, request.AccountId, request.Status!, cancellationToken);
            return created is null
                ? Results.NotFound(new { error = "WS 账号状态无法保存。", accountId = request.AccountId })
                : Results.Ok(new { changed = 0, status = created.Status, at = DateTimeOffset.UtcNow, created = true });
        });
        group.MapGet("/followups", GetFollowupsAsync);
        group.MapGet("/accounts", async (WsRepository repository, CancellationToken cancellationToken) => Results.Ok(await repository.ListAccountsAsync(cancellationToken)));
        group.MapPost("/accounts", async (WsAccountRequest request, WsRepository repository, CancellationToken cancellationToken) =>
        {
            if (request is null || string.IsNullOrWhiteSpace(request.Id) || request.Id.Trim().Length > MaxAccountIdLength || string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > MaxDisplayNameLength || !AccountStatuses.Contains(request.Status?.Trim() ?? string.Empty)) return (IResult)Results.BadRequest("id, displayName and a supported status are required");
            return Results.Ok(await repository.UpsertAccountAsync(request.Id, request.DisplayName, request.Status!, cancellationToken));
        });
        group.MapPost("/accounts/{id}/status", async (string id, WsAccountStatusRequest request, WsRepository repository, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(id) || id.Trim().Length > MaxAccountIdLength || request is null || !AccountStatuses.Contains(request.Status?.Trim() ?? string.Empty)) return (IResult)Results.BadRequest("id and a supported status are required");
            var changed = await repository.UpdateAccountStatusAsync(id, request.Status!, cancellationToken);
            return changed > 0
                ? Results.Ok(new { changed })
                : Results.NotFound(new { error = "WS 账号不存在。", accountId = id });
        });
        return endpoints;
    }

    private static async Task<Results<Ok<WsIngestBatchResponse>, BadRequest<string>>> IngestBatchAsync(
        HttpContext context,
        WsIngestBatchRequest request,
        WsRepository repository,
        CancellationToken cancellationToken)
    {
        if (context.Request.ContentLength is > MaxRequestBytes) return TypedResults.BadRequest("WS 批次请求不能超过 8 MiB");
        if (request is null || string.IsNullOrWhiteSpace(request.AccountId) || request.AccountId.Trim().Length > MaxAccountIdLength) return TypedResults.BadRequest("accountId is required and must be <= 160 characters");
        if (!string.Equals(request.Protocol?.Trim(), Protocol, StringComparison.Ordinal)) return TypedResults.BadRequest("unsupported ingest protocol");
        if (string.IsNullOrWhiteSpace(request.ConnectorId) || request.ConnectorId.Trim().Length > MaxConnectorIdLength) return TypedResults.BadRequest("connectorId is required and must be <= 160 characters");
        if (!string.Equals(request.Scope?.Trim(), Scope, StringComparison.Ordinal)) return TypedResults.BadRequest("unsupported capture scope");
        if (request.Messages is { Count: > 5000 } || request.Checkpoints is { Count: > 5000 } || request.Conversations is { Count: > 5000 }) return TypedResults.BadRequest("单批次最多 5000 条消息、会话和断点");
        var messages = request.Messages ?? Array.Empty<WsMessageEnvelope>();
        var checkpoints = request.Checkpoints ?? Array.Empty<WsCheckpoint>();
        var conversations = request.Conversations ?? Array.Empty<WsConversationEnvelope>();
        foreach (var item in messages)
        {
            if (item is null || !string.Equals(item.AccountId?.Trim(), request.AccountId.Trim(), StringComparison.Ordinal)) return TypedResults.BadRequest("batch account mismatch");
            if (string.IsNullOrWhiteSpace(item.ConversationKey) || item.ConversationKey.Length > 512) return TypedResults.BadRequest("conversationKey is required and must be <= 512 characters");
            if (item.Body is { Length: > 12000 } || item.ExternalMessageId is { Length: > 512 } || item.Cursor is { Length: > 512 }) return TypedResults.BadRequest("message field exceeds the allowed length");
            if (!Directions.Contains(item.Direction ?? string.Empty)) return TypedResults.BadRequest("unsupported message direction");
        }
        var checkpointInputs = new List<WsCheckpointInput>(checkpoints.Count);
        foreach (var checkpoint in checkpoints)
        {
            if (checkpoint is null || !string.Equals(checkpoint.AccountId?.Trim(), request.AccountId.Trim(), StringComparison.Ordinal)) return TypedResults.BadRequest("checkpoint account mismatch");
            if (checkpoint.ConversationKey is null || checkpoint.ConversationKey.Length > 512 || checkpoint.Cursor is { Length: > 512 } || checkpoint.LastMessageFingerprint is { Length: > 256 }) return TypedResults.BadRequest("checkpoint field exceeds the allowed length");
            checkpointInputs.Add(new WsCheckpointInput(checkpoint.AccountId!, checkpoint.ConversationKey!, checkpoint.Cursor ?? string.Empty, checkpoint.LastMessageFingerprint ?? string.Empty, checkpoint.UpdatedAt));
        }
        var conversationInputs = new List<WsConversationInput>(conversations.Count);
        foreach (var conversation in conversations)
        {
            if (conversation is null || !string.Equals(conversation.AccountId?.Trim(), request.AccountId.Trim(), StringComparison.Ordinal)) return TypedResults.BadRequest("conversation account mismatch");
            if (string.IsNullOrWhiteSpace(conversation.ConversationKey) || conversation.ConversationKey.Length > 512) return TypedResults.BadRequest("conversationKey is required and must be <= 512 characters");
            if (conversation.DisplayName is { Length: > MaxDisplayNameLength } || conversation.LastMessagePreview is { Length: > 12000 }) return TypedResults.BadRequest("conversation field exceeds the allowed length");
            if (conversation.UnreadCount < 0) return TypedResults.BadRequest("unreadCount must be >= 0");
            if (!conversation.VisibleOnly) return TypedResults.BadRequest("only visible authorized conversation rows are accepted");
            conversationInputs.Add(new WsConversationInput(
                conversation.AccountId!,
                conversation.ConversationKey!,
                conversation.DisplayName ?? string.Empty,
                conversation.UnreadCount,
                conversation.LastMessagePreview ?? string.Empty,
                conversation.LastMessageAt,
                conversation.VisibleOnly,
                conversation.CapturedAt));
        }
        var result = await repository.IngestBatchAsync(
            request.AccountId.Trim(),
            messages.Select(item => new MessageEnvelope(
                item.AccountId!,
                item.ConversationKey!,
                item.ExternalMessageId ?? string.Empty,
                item.SentAt,
                item.Direction!,
                item.Body ?? string.Empty,
                item.PreviewOnly,
                item.ObservedAt == default ? DateTimeOffset.UtcNow : item.ObservedAt,
                item.Cursor ?? string.Empty)).ToArray(),
            checkpointInputs,
            cancellationToken,
            conversationInputs);
        return TypedResults.Ok(new WsIngestBatchResponse(result.Accepted, result.Deduplicated, result.MessageIds, DateTimeOffset.UtcNow, result.ConversationsAccepted, result.PreviewAccepted));
    }

    private static async Task<Results<Ok<object>, BadRequest<string>>> SaveCheckpointsAsync(
        HttpContext context,
        IReadOnlyList<WsCheckpoint> checkpoints,
        WsRepository repository,
        CancellationToken cancellationToken)
    {
        if (context.Request.ContentLength is > MaxRequestBytes) return TypedResults.BadRequest("WS 断点请求不能超过 8 MiB");
        if (checkpoints is { Count: > 5000 }) return TypedResults.BadRequest("最多保存 5000 个断点");
        var normalized = checkpoints ?? Array.Empty<WsCheckpoint>();
        var inputs = new List<WsCheckpointInput>(normalized.Count);
        foreach (var checkpoint in normalized)
        {
            var accountId = checkpoint?.AccountId?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(accountId) || accountId.Length > MaxAccountIdLength) return TypedResults.BadRequest("accountId and conversationKey are required");
            if (checkpoint is null || string.IsNullOrWhiteSpace(checkpoint.ConversationKey) || checkpoint.ConversationKey.Length > 512 || checkpoint.Cursor is { Length: > 512 } || checkpoint.LastMessageFingerprint is { Length: > 256 })
                return TypedResults.BadRequest("checkpoint field exceeds the allowed length");
            inputs.Add(new WsCheckpointInput(accountId, checkpoint.ConversationKey!, checkpoint.Cursor ?? string.Empty, checkpoint.LastMessageFingerprint ?? string.Empty, checkpoint.UpdatedAt));
        }
        // Validate every account and checkpoint before opening a write transaction.
        // The repository commits all accounts together, so a later invalid row or
        // failed write cannot leave earlier account groups persisted.
        if (inputs.Count > 0)
            await repository.SaveCheckpointsBatchAsync(inputs, cancellationToken);
        return TypedResults.Ok<object>(new { saved = checkpoints?.Count ?? 0 });
    }

    private static async Task<Ok<IReadOnlyList<FollowupRow>>> GetFollowupsAsync(
        string? state,
        WsRepository repository,
        CancellationToken cancellationToken)
        => TypedResults.Ok(await repository.GetFollowupsAsync(state, cancellationToken));
}

public sealed record WsAccountRequest(string Id, string DisplayName, string Status = "未连接");
public sealed record WsAccountStatusRequest(string Status);
public sealed record WsHeartbeatRequest(string AccountId, string Status);
