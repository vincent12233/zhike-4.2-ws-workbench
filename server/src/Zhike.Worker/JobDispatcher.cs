using System.Text.Json;
using Microsoft.Extensions.Logging;
using Zhike.Contracts;
using Zhike.Domain.Jobs;
using Zhike.Infrastructure.Repositories;
using Zhike.Worker.Providers;

namespace Zhike.Worker;

public interface IAiAnalysisProvider
{
    Task<AiAnalysisResult> AnalyzeAsync(JsonElement payload, CancellationToken cancellationToken);
}

public enum AiProviderFailureKind
{
    Unknown,
    Unavailable,
    Timeout,
    Quota,
    Transport,
    Schema,
    SensitiveOutput,
}

public class AiProviderException(string message, AiProviderFailureKind kind, bool retryable = true, Exception? inner = null)
    : InvalidOperationException(message, inner)
{
    public AiProviderFailureKind Kind { get; } = kind;
    public bool Retryable { get; } = retryable;
}

public sealed class AiAnalysisQuotaException(string message, Exception? inner = null)
    : AiProviderException(message, AiProviderFailureKind.Quota, true, inner);

public sealed class AiAnalysisTimeoutException(string message, Exception? inner = null)
    : AiProviderException(message, AiProviderFailureKind.Timeout, true, inner);

public sealed class AiAnalysisSchemaException(string message, Exception? inner = null)
    : AiProviderException(message, AiProviderFailureKind.Schema, true, inner);

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
    JsonElement Raw = default)
{
    public IReadOnlyDictionary<string, AiProfileFact> ProfileFacts { get; init; } = new Dictionary<string, AiProfileFact>(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<string> MissingFields { get; init; } = [];
    public IReadOnlyList<string> NaturalNextTopics { get; init; } = [];
    public AiNoReplyAssessment? NoReply { get; init; }
    public AiReplySuggestion? ReplySuggestion { get; init; }
    public string CustomerTemperature { get; init; } = "";
    public string StatusColor { get; init; } = "gray";
    public bool IsStructured { get; init; } = true;
}
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
                if (string.IsNullOrWhiteSpace(accountId) || string.IsNullOrWhiteSpace(conversationId))
                    throw new AiAnalysisSchemaException("AI 任务缺少账号或会话上下文。");
                // The repository's job-id idempotency check short-circuits
                // duplicate analyses before any CRM/profile side effects.
                var autoSyncAllowed = result.IsStructured
                    && result.Confidence >= 0.60
                    && HasMeaningfulSignal(result);
                // Never persist the raw job payload as a fallback: it may
                // contain provider metadata or user secrets. Providers return
                // an explicitly sanitized raw result when structured parsing
                // succeeds; otherwise keep an empty audit object.
                var emptyObject = JsonSerializer.SerializeToElement(new { });
                var raw = result.Raw.ValueKind == JsonValueKind.Undefined ? emptyObject : result.Raw;
                var contact = result.Contact.ValueKind == JsonValueKind.Undefined ? emptyObject : result.Contact;
                var profile = result.Profile.ValueKind == JsonValueKind.Undefined ? emptyObject : result.Profile;
                // The job id is stable across retries. Reusing it for the
                // analysis id keeps evidence rows valid when a worker crashes
                // after the analysis insert but before customer sync.
                await sync.SaveAndSyncAsync(new AiAnalysisInput(
                    $"analysis-{claim.Id}", claim.Id, accountId, conversationId, sourceMessageId,
                    string.IsNullOrWhiteSpace(result.CustomerId) ? null : result.CustomerId,
                    result.Summary, result.Intent, result.IntentScore, result.Emotion, result.Urgency, result.Language,
                    result.ProductInterest ?? [], result.Budget, contact, profile, result.Confidence, raw,
                    result.Followup is null ? null : new AiFollowupInput(result.Followup.ReasonKey, result.Followup.Title, result.Followup.Detail, result.Followup.DueAt, result.Followup.Priority),
                    result.ProfileFacts, result.MissingFields, result.NaturalNextTopics, result.NoReply, result.ReplySuggestion,
                    result.CustomerTemperature, result.StatusColor, autoSyncAllowed), cancellationToken);
                await jobs.CompleteAsync(claim.Id, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (AiAnalysisUnavailableException error)
            {
                await jobs.DeferAsync(claim.Id, error.Message, TimeSpan.FromMinutes(5), cancellationToken);
                logger.LogWarning("AI job {JobId} deferred because the provider is not configured", claim.Id);
            }
            catch (AiAnalysisSkippedException)
            {
                await jobs.CompleteAsync(claim.Id, cancellationToken);
            }
            catch (AiAnalysisQuotaException error)
            {
                await jobs.DeferAsync(claim.Id, error.Message, TimeSpan.FromMinutes(10), cancellationToken);
                logger.LogWarning("AI job {JobId} deferred because the provider quota is unavailable", claim.Id);
            }
            catch (AiAnalysisTimeoutException error)
            {
                await jobs.FailAsync(claim.Id, error.Message, 5, cancellationToken);
                logger.LogWarning("AI job {JobId} timed out; retry/dead-letter policy applied", claim.Id);
            }
            catch (AiProviderException error)
            {
                if (error.Retryable) await jobs.FailAsync(claim.Id, error.Message, 5, cancellationToken);
                else await jobs.FailAsync(claim.Id, "AI provider rejected the request", 1, cancellationToken);
                logger.LogWarning("AI job {JobId} provider failure kind {Kind}; retryable={Retryable}", claim.Id, error.Kind, error.Retryable);
            }
            catch (Exception error)
            {
                logger.LogWarning("AI job {JobId} failed; it will be retried or dead-lettered", claim.Id);
                await jobs.FailAsync(claim.Id, "AI analysis failed", 5, cancellationToken);
            }
        }
        return claims.Count;
    }

    private static bool HasMeaningfulSignal(AiAnalysisResult result)
        => result.ProfileFacts.Count > 0
            || result.Fields.Any(item => !string.IsNullOrWhiteSpace(item.Value))
            || !string.IsNullOrWhiteSpace(result.Summary)
            || !string.IsNullOrWhiteSpace(result.Intent)
            || result.Followup is not null;
}
