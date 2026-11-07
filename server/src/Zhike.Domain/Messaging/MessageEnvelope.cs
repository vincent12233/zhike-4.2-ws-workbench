namespace Zhike.Domain.Messaging;

public sealed record MessageEnvelope(
    string AccountId,
    string ConversationKey,
    string ExternalMessageId,
    DateTimeOffset? SentAt,
    string Direction,
    string Body,
    bool PreviewOnly,
    DateTimeOffset ObservedAt,
    string Cursor = "");

public sealed record IngestResult(string MessageId, bool Deduplicated, string ConversationId);
