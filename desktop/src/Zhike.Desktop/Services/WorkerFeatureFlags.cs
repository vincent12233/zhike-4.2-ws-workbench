using System.Text.Json;

namespace Zhike.Desktop.Services;

/// <summary>
/// Persisted, auditable gates for the controlled Worker path. The absence of
/// a file, an unknown schema, malformed JSON, and missing properties all
/// resolve to a fully disabled snapshot. No flag is enabled implicitly.
/// </summary>
public sealed record WorkerFeatureFlagsSnapshot(
    bool WorkerRuntimeEnabled,
    bool WorkerQueueAdapterEnabled,
    bool WorkerFencingEnabled,
    string Source,
    string ConfigPath,
    long Revision)
{
    // Stage 3 group-manager gates are optional properties rather than new
    // positional parameters. This keeps the Stage 2 isolated harnesses and
    // any persisted six-field snapshots source-compatible while still making
    // every new path explicitly opt-in.
    public bool IndependentWsGroupManagerEnabled { get; init; }
    public bool GroupMemberSyncEnabled { get; init; }
    public bool GroupCrmAutoCreateEnabled { get; init; }
    public bool GroupMessageCollectionEnabled { get; init; }
    public bool GroupReadEvidenceEnabled { get; init; }

    // Stage 4 AI pipeline gates are optional init properties so the existing
    // six-field constructor remains source-compatible with Stage 2/3 tests
    // and older persisted snapshots. Missing or malformed values stay false.
    public bool AiJobPipelineEnabled { get; init; }
    public bool AiWorkerConsumerEnabled { get; init; }
    public bool AiCrmSuggestionEnabled { get; init; }
    public bool AiCrmAutoFillEnabled { get; init; }
    public bool AiReviewCenterEnabled { get; init; }

    public bool AllControlledPathsEnabled =>
        WorkerRuntimeEnabled && WorkerQueueAdapterEnabled && WorkerFencingEnabled;

    public bool GroupManagerPathsEnabled =>
        AllControlledPathsEnabled &&
        IndependentWsGroupManagerEnabled &&
        GroupMemberSyncEnabled &&
        GroupCrmAutoCreateEnabled &&
        GroupMessageCollectionEnabled &&
        GroupReadEvidenceEnabled;

    public bool AiPipelinePathsEnabled =>
        AllControlledPathsEnabled &&
        AiJobPipelineEnabled &&
        AiWorkerConsumerEnabled &&
        AiCrmSuggestionEnabled &&
        AiCrmAutoFillEnabled &&
        AiReviewCenterEnabled;

    public static WorkerFeatureFlagsSnapshot Disabled(string configPath, string source = "defaults")
        => new(false, false, false, source, configPath, 0);
}

public static class WorkerFeatureFlags
{
    private const int CurrentSchemaVersion = 1;

    public static WorkerFeatureFlagsSnapshot Load(string dataRoot)
    {
        var normalizedRoot = Path.GetFullPath(dataRoot ?? throw new ArgumentNullException(nameof(dataRoot)));
        var path = Path.Combine(normalizedRoot, "worker-feature-flags.json");
        if (!File.Exists(path)) return WorkerFeatureFlagsSnapshot.Disabled(path);

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("schemaVersion", out var schema) ||
                schema.ValueKind != JsonValueKind.Number ||
                schema.GetInt32() != CurrentSchemaVersion)
            {
                return WorkerFeatureFlagsSnapshot.Disabled(path, "invalid-schema");
            }

            return new WorkerFeatureFlagsSnapshot(
                ReadBoolean(root, "WorkerRuntimeEnabled"),
                ReadBoolean(root, "WorkerQueueAdapterEnabled"),
                ReadBoolean(root, "WorkerFencingEnabled"),
                "file",
                path,
                ReadRevision(root))
            {
                IndependentWsGroupManagerEnabled = ReadBoolean(root, "IndependentWsGroupManagerEnabled"),
                GroupMemberSyncEnabled = ReadBoolean(root, "GroupMemberSyncEnabled"),
                GroupCrmAutoCreateEnabled = ReadBoolean(root, "GroupCrmAutoCreateEnabled"),
                GroupMessageCollectionEnabled = ReadBoolean(root, "GroupMessageCollectionEnabled"),
                GroupReadEvidenceEnabled = ReadBoolean(root, "GroupReadEvidenceEnabled"),
                AiJobPipelineEnabled = ReadBoolean(root, "AiJobPipelineEnabled"),
                AiWorkerConsumerEnabled = ReadBoolean(root, "AiWorkerConsumerEnabled"),
                AiCrmSuggestionEnabled = ReadBoolean(root, "AiCrmSuggestionEnabled"),
                AiCrmAutoFillEnabled = ReadBoolean(root, "AiCrmAutoFillEnabled"),
                AiReviewCenterEnabled = ReadBoolean(root, "AiReviewCenterEnabled"),
            };
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or FormatException or InvalidOperationException)
        {
            return WorkerFeatureFlagsSnapshot.Disabled(path, "invalid");
        }
    }

    private static bool ReadBoolean(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static long ReadRevision(JsonElement root)
        => root.TryGetProperty("revision", out var value) && value.ValueKind == JsonValueKind.Number &&
           value.TryGetInt64(out var revision) && revision >= 0 ? revision : 0;
}
