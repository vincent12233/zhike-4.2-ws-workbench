namespace Zhike.Contracts;

public sealed record WsMessageEnvelope(
    string ConnectorId,
    string AccountId,
    string ConversationKey,
    string ExternalMessageId,
    DateTimeOffset? SentAt,
    string Direction,
    string Body,
    bool PreviewOnly,
    DateTimeOffset ObservedAt,
    string Cursor = "");

public sealed record WsCheckpoint(
    string AccountId,
    string ConversationKey,
    string Cursor,
    string LastMessageFingerprint,
    DateTimeOffset UpdatedAt);

public sealed record WsIngestBatchRequest(
    string ConnectorId,
    string AccountId,
    IReadOnlyList<WsMessageEnvelope> Messages,
    IReadOnlyList<WsCheckpoint>? Checkpoints = null,
    string Protocol = "zhike.ws.ingest.batch.v1",
    DateTimeOffset? CapturedAt = null,
    string Scope = "visible-authorized-content");

public sealed record WsIngestBatchResponse(
    int Accepted,
    int Deduplicated,
    IReadOnlyList<string> MessageIds,
    DateTimeOffset ProcessedAt);
