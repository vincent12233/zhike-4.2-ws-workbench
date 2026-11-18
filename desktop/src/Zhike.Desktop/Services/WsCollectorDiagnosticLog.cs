using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

/// <summary>
/// Bounded, privacy-safe collector lifecycle diagnostics. This deliberately
/// accepts only fixed lifecycle fields: never account/customer identifiers,
/// message bodies, page HTML, cookies, tokens or WebView payloads.
/// </summary>
public static class WsCollectorDiagnosticLog
{
    private const int MaxBytes = 256 * 1024;
    private const int RetainedBytes = 128 * 1024;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> AllowedEvents = new(StringComparer.Ordinal)
    {
        "collection-run-start", "collection-window", "collection-attempt", "collection-run-finish",
        "collection-paused", "history-retryable", "collection-retry-scheduled", "collection-complete",
        "background-heartbeat",
    };
    private static readonly HashSet<string> AllowedCoverage = new(StringComparer.Ordinal)
    {
        "read-history-start", "read-history-window", "read-history-attempt", "read-history-complete",
        "read-history-interrupted", "read-history-paused", "read-history-retryable",
        "background-active",
    };
    private static readonly HashSet<string> AllowedReasons = new(StringComparer.Ordinal)
    {
        "user-interaction", "attempt-deadline", "retryable-pending", "completed", "conversation-limit",
        "list-ready", "list-unavailable",
    };
    private static readonly HashSet<string> AllowedTags = new(StringComparer.Ordinal) { "div", "span", "li", "article", "section", "main", "other" };
    private static readonly HashSet<string> AllowedRoles = new(StringComparer.Ordinal) { "row", "gridcell", "listitem", "presentation", "application", "button", "group", "none" };
    private static readonly HashSet<string> AllowedClassDirections = new(StringComparer.Ordinal) { "in", "out", "both", "none" };
    private static readonly HashSet<string> AllowedDataPrefixes = new(StringComparer.Ordinal) { "true", "false", "other", "none" };
    private static readonly HashSet<string> AllowedAlignments = new(StringComparer.Ordinal) { "left", "right", "start", "end", "center", "normal", "auto", "stretch", "self-start", "self-end", "flex-start", "flex-end", "other", "none" };

    public static async Task WriteAsync(
        string eventName,
        string coverage,
        string reason,
        long discovered,
        long processed,
        long attempted,
        long retryable,
        long skippedUnread,
        long rowCount,
        long readCount,
        long skipCount,
        long pendingCount,
        long domNodeKnownCount,
        DateTimeOffset observedAt,
        CancellationToken cancellationToken = default)
    {
        var record = new
        {
            time = observedAt.ToUniversalTime(),
            eventName = ClosedValue(eventName, AllowedEvents, "unknown"),
            coverage = ClosedValue(coverage, AllowedCoverage, string.Empty),
            reason = ClosedValue(reason, AllowedReasons, string.Empty),
            discovered = SafeCount(discovered),
            processed = SafeCount(processed),
            attempted = SafeCount(attempted),
            retryable = SafeCount(retryable),
            skippedUnread = SafeCount(skippedUnread),
            rowCount = SafeCount(rowCount),
            readCount = SafeCount(readCount),
            skipCount = SafeCount(skipCount),
            pendingCount = SafeCount(pendingCount),
            domNodeKnownCount = SafeCount(domNodeKnownCount),
        };
        await AppendRecordAsync(record, cancellationToken);
    }

    public static Task WriteBackgroundHeartbeatAsync(
        bool listReady,
        bool scanning,
        bool allScanning,
        bool retryScheduled,
        bool highPriorityRetryPending,
        long advanced,
        long queuedTasks,
        long allRounds,
        long allSeen,
        long allScrollTop,
        long allMax,
        long allAgeMs,
        long allNoProgressMs,
        DateTimeOffset observedAt,
        CancellationToken cancellationToken = default)
        => AppendRecordAsync(new
        {
            time = observedAt.ToUniversalTime(),
            eventName = "background-heartbeat",
            coverage = "background-active",
            reason = listReady ? "list-ready" : "list-unavailable",
            listReady,
            scanning,
            allScanning,
            retryScheduled,
            highPriorityRetryPending,
            advanced = SafeCount(advanced),
            queuedTasks = SafeCount(queuedTasks),
            allRounds = SafeCount(allRounds),
            allSeen = SafeCount(allSeen),
            allScrollTop = SafeCount(allScrollTop),
            allMax = SafeCount(allMax),
            allAgeMs = SafeCount(allAgeMs),
            allNoProgressMs = SafeCount(allNoProgressMs),
        }, cancellationToken);

    public static async Task WriteDirectionStructureAsync(
        JsonElement source,
        DateTimeOffset observedAt,
        CancellationToken cancellationToken = default)
    {
        var signals = new List<object>();
        if (source.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in source.EnumerateArray().Take(12))
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                signals.Add(new
                {
                    depth = SafeSmallNumber(item, "depth", 11),
                    tag = ClosedValue(JsonString(item, "tag"), AllowedTags, "other"),
                    role = ClosedValue(JsonString(item, "role"), AllowedRoles, "none"),
                    classDirection = ClosedValue(JsonString(item, "classDirection"), AllowedClassDirections, "none"),
                    dataPrefix = ClosedValue(JsonString(item, "dataPrefix"), AllowedDataPrefixes, "none"),
                    align = ClosedValue(JsonString(item, "align"), AllowedAlignments, "none"),
                    hasMsgCheck = JsonBool(item, "hasMsgCheck"),
                    hasMsgDblcheck = JsonBool(item, "hasMsgDblcheck"),
                    hasMsgTime = JsonBool(item, "hasMsgTime"),
                    hasTailOut = JsonBool(item, "hasTailOut"),
                    hasTailIn = JsonBool(item, "hasTailIn"),
                    bg = Color(item, "bg"),
                    outgoingBackground = Color(item, "outBg"),
                    incomingBackground = Color(item, "inBg"),
                });
            }
        }

        await AppendRecordAsync(new
        {
            time = observedAt.ToUniversalTime(),
            eventName = "direction-unresolved-structure",
            signals,
        }, cancellationToken);
    }

    private static async Task AppendRecordAsync<T>(T record, CancellationToken cancellationToken)
    {
        var line = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(record, JsonOptions) + Environment.NewLine);

        await Gate.WaitAsync(cancellationToken);
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zhike6", "diagnostics");
#if STAGE51_ISOLATED_UI
            directory = Stage51Isolation.MapDataPath(directory);
#endif
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "ws-collector.jsonl");
            var currentLength = File.Exists(path) ? new FileInfo(path).Length : 0;
            if (currentLength + line.Length <= MaxBytes)
            {
                await using var append = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 16 * 1024, useAsync: true);
                await append.WriteAsync(line, cancellationToken);
                await append.FlushAsync(cancellationToken);
                return;
            }

            var tail = await ReadTailAsync(path, RetainedBytes, cancellationToken);
            var firstLineEnd = Array.IndexOf(tail, (byte)'\n');
            if (firstLineEnd >= 0 && firstLineEnd + 1 < tail.Length) tail = tail[(firstLineEnd + 1)..];
            var combined = new byte[Math.Min(MaxBytes, tail.Length + line.Length)];
            var tailToKeep = Math.Min(tail.Length, Math.Max(0, combined.Length - line.Length));
            if (tailToKeep > 0) Buffer.BlockCopy(tail, tail.Length - tailToKeep, combined, 0, tailToKeep);
            Buffer.BlockCopy(line, 0, combined, tailToKeep, Math.Min(line.Length, combined.Length - tailToKeep));

            var temp = $"{path}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllBytesAsync(temp, combined, cancellationToken);
            File.Move(temp, path, true);
        }
        catch
        {
            // Diagnostics must never interrupt collection or expose payloads in
            // an exception path. Operational state remains available in-app.
        }
        finally { Gate.Release(); }
    }

    private static string JsonString(JsonElement item, string property)
        => item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : string.Empty;

    private static bool JsonBool(JsonElement item, string property)
        => item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;

    private static int SafeSmallNumber(JsonElement item, string property, int maximum)
        => item.TryGetProperty(property, out var value) && value.TryGetInt32(out var parsed) ? Math.Clamp(parsed, 0, maximum) : 0;

    private static int[] Color(JsonElement item, string prefix)
        =>
        [
            SafeColor(item, $"{prefix}R"),
            SafeColor(item, $"{prefix}G"),
            SafeColor(item, $"{prefix}B"),
            SafeColor(item, $"{prefix}A"),
        ];

    private static int SafeColor(JsonElement item, string property)
        => item.TryGetProperty(property, out var value) && value.TryGetInt32(out var parsed) ? Math.Clamp(parsed, 0, 255) : 0;

    private static async Task<byte[]> ReadTailAsync(string path, int maximumBytes, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return [];
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 16 * 1024, useAsync: true);
        var count = (int)Math.Min(maximumBytes, stream.Length);
        if (count <= 0) return [];
        stream.Seek(-count, SeekOrigin.End);
        var result = new byte[count];
        await stream.ReadExactlyAsync(result, cancellationToken);
        return result;
    }

    private static string ClosedValue(string? value, IReadOnlySet<string> allowed, string fallback)
        => value is not null && allowed.Contains(value) ? value : fallback;

    private static long SafeCount(long value) => Math.Clamp(value, 0, 1_000_000);
}
