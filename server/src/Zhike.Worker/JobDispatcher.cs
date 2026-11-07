using System.Text.Json;
using Microsoft.Extensions.Logging;
using Zhike.Domain.Jobs;
using Zhike.Infrastructure.Repositories;

namespace Zhike.Worker;

public interface IAiAnalysisProvider
{
    Task<AiAnalysisResult> AnalyzeAsync(JsonElement payload, CancellationToken cancellationToken);
}

public sealed record AiAnalysisResult(
    string CustomerId,
    string SourceMessageId,
    double Confidence,
    IReadOnlyDictionary<string, string> Fields,
    FollowupSuggestion? Followup,
    string Summary = "",
    string Intent = "",
    double? IntentScore = null,
    string Emotion = "",
    string Urgency = "",
    string Language = "",
    IReadOnlyList<string>? ProductInterest = null,
    string Budget = "",
    JsonElement Contact = default,
    JsonElement Profile = default,
    JsonElement Raw = default);
public sealed record FollowupSuggestion(string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority);

public sealed class JobDispatcher(AiJobRepository jobs, AiAnalysisRepository sync, ILogger<JobDispatcher> logger)
{
    public async Task<int> DispatchOnceAsync(IAiAnalysisProvider provider, CancellationToken cancellationToken = default)
    {
        var claims = await jobs.ClaimAsync(10, TimeSpan.FromMinutes(2), cancellationToken);
        foreach (var claim in claims)
        {
            try
            {
                using var document = JsonDocument.Parse(claim.PayloadJson);
                var result = await provider.AnalyzeAsync(document.RootElement, cancellationToken);
                var accountId = document.RootElement.TryGetProperty("accountId", out var account) ? account.GetString() ?? string.Empty : string.Empty;
                var conversationId = document.RootElement.TryGetProperty("conversationId", out var conversation) ? conversation.GetString() ?? string.Empty : string.Empty;
                var sourceMessageId = document.RootElement.TryGetProperty("messageId", out var sourceMessage) ? sourceMessage.GetString() ?? result.SourceMessageId : result.SourceMessageId;
                var raw = result.Raw.ValueKind == JsonValueKind.Undefined ? document.RootElement.Clone() : result.Raw;
                var contact = result.Contact.ValueKind == JsonValueKind.Undefined ? JsonDocument.Parse("{}").RootElement.Clone() : result.Contact;
                var profile = result.Profile.ValueKind == JsonValueKind.Undefined ? JsonDocument.Parse("{}").RootElement.Clone() : result.Profile;
                // The job id is stable across retries. Reusing it for the
                // analysis id keeps evidence rows valid when a worker crashes
                // after the analysis insert but before customer sync.
                await sync.SaveAndSyncAsync(new AiAnalysisInput(
                    $"analysis-{claim.Id}", claim.Id, accountId, conversationId, sourceMessageId,
                    string.IsNullOrWhiteSpace(result.CustomerId) ? null : result.CustomerId,
                    result.Summary, result.Intent, result.IntentScore, result.Emotion, result.Urgency, result.Language,
                    result.ProductInterest ?? [], result.Budget, contact, profile, result.Confidence, raw,
                    result.Followup is null ? null : new AiFollowupInput(result.Followup.ReasonKey, result.Followup.Title, result.Followup.Detail, result.Followup.DueAt, result.Followup.Priority)), cancellationToken);
                await jobs.CompleteAsync(claim.Id, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "AI job {JobId} failed; it will be retried or dead-lettered", claim.Id);
                await jobs.FailAsync(claim.Id, error.Message, 5, cancellationToken);
            }
        }
        return claims.Count;
    }
}
