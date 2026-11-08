using System.Text.Json;

namespace Zhike.Contracts;

/// <summary>
/// PostgreSQL projection for one customer × WS account × conversation.
/// The DTO intentionally keeps the legacy customer fields out of this payload;
/// callers can opt into the compatible projection returned by CustomerRoutes.
/// </summary>
public sealed record HotChatProfileDto(
    string Id,
    string CustomerId,
    string AccountId,
    string ConversationId,
    double CompletenessScore,
    string StatusColor,
    string ConversationStage,
    DateTimeOffset? LastProgressAt,
    string NextTopic,
    string NoReplyReason,
    DateTimeOffset? NextFollowupAt,
    string ProfileSummary,
    IReadOnlyList<string> Tags,
    bool ManualColorLocked,
    long Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<HotChatProfileFieldDto> Fields);

public sealed record HotChatProfileFieldDto(
    string FieldName,
    JsonElement Value,
    string State,
    double Confidence,
    string? SourceMessageId,
    string SourceQuote,
    string? AnalysisId,
    DateTimeOffset? LastAskedAt,
    bool ManualLocked,
    DateTimeOffset UpdatedAt);

public sealed record HotChatProfileUpsertRequest(
    string Id,
    string CustomerId,
    string AccountId,
    string ConversationId,
    double? CompletenessScore = null,
    string? StatusColor = null,
    string? ConversationStage = null,
    DateTimeOffset? LastProgressAt = null,
    string? NextTopic = null,
    string? NoReplyReason = null,
    DateTimeOffset? NextFollowupAt = null,
    string? ProfileSummary = null,
    IReadOnlyList<string>? Tags = null,
    bool? ManualColorLocked = null,
    long? ExpectedVersion = null);

public sealed record HotChatProfileFieldUpsertRequest(
    string FieldName,
    JsonElement Value,
    string State = "pending",
    double Confidence = 0,
    string? SourceMessageId = null,
    string? SourceQuote = null,
    string? AnalysisId = null,
    DateTimeOffset? LastAskedAt = null,
    bool? ManualLocked = null,
    long? ExpectedVersion = null);

public sealed record HotChatEventRequest(
    string EventType,
    string? ActorType = null,
    string? ActorId = null,
    string? IdempotencyKey = null,
    JsonElement? Payload = null);

public sealed record HotChatDiagnosticsDto(
    string ProfileId,
    long Version,
    int PendingFields,
    int PendingEvents,
    int PendingOutbox,
    DateTimeOffset? LastProgressAt,
    DateTimeOffset? NextFollowupAt);

public sealed record CustomerHotProjection(
    string StatusColor,
    IReadOnlyList<string> Tags,
    string ProfileSummary,
    double CompletenessScore,
    DateTimeOffset? NextFollowupAt);

/// <summary>
/// Backward-compatible v2 customer DTO.  The original customer/business
/// fields remain unchanged; hot-chat values are additive projection fields.
/// </summary>
public sealed record CustomerDto(
    string Id,
    string Name,
    string Phone,
    string Country,
    string Language,
    string Source,
    string Stage,
    string Status,
    string IntentLevel,
    string Occupation,
    int? Age,
    string Budget,
    string ProductInterest,
    string Notes,
    string AiSummary,
    DateTimeOffset UpdatedAt,
    string StatusColor = "gray",
    IReadOnlyList<string>? Tags = null,
    string ProfileSummary = "",
    double CompletenessScore = 0,
    DateTimeOffset? NextFollowupAt = null);
