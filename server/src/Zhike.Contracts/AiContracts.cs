using System.Text.Json;

namespace Zhike.Contracts;

/// <summary>Evidence-backed facts inferred from a chat message.</summary>
public sealed record AiProfileFact(
    string Field,
    JsonElement Value,
    string State,
    double Confidence,
    string Evidence,
    string? SourceMessageId = null,
    string? AnalysisId = null);

public sealed record AiNoReplyAssessment(
    bool NoReply,
    string Reason,
    int CooldownDays = 3,
    DateTimeOffset? SuggestedAt = null);

public sealed record AiReplySuggestion(
    string Text,
    bool RequiresConfirmation,
    bool Sensitive,
    string SafetyReason = "");
