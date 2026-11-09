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

/// <summary>
/// A conversation row observed in the connector's visible conversation list.
/// Rows are intentionally metadata-only: no password, cookie, QR code or
/// hidden-message content is accepted by this contract.  Keeping the list in
/// the ingest batch lets the worker persist chats that the user has not opened.
/// </summary>
public sealed record WsConversationEnvelope(
    string AccountId,
    string ConversationKey,
    string DisplayName,
    int UnreadCount,
    string LastMessagePreview,
    DateTimeOffset? LastMessageAt,
    bool VisibleOnly = true);

public sealed record WsIngestBatchRequest(
    string ConnectorId,
    string AccountId,
    IReadOnlyList<WsMessageEnvelope> Messages,
    IReadOnlyList<WsCheckpoint>? Checkpoints = null,
    string Protocol = "zhike.ws.ingest.batch.v1",
    DateTimeOffset? CapturedAt = null,
    string Scope = "visible-authorized-content",
    IReadOnlyList<WsConversationEnvelope>? Conversations = null);

public sealed record WsIngestBatchResponse(
    int Accepted,
    int Deduplicated,
    IReadOnlyList<string> MessageIds,
    DateTimeOffset ProcessedAt,
    int ConversationsAccepted = 0);
