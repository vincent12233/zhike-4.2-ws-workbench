using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Zhike.Desktop.Services;

/// <summary>
/// Versioned, line-delimited envelope shared by the WinUI supervisor and an
/// isolated Worker process. The production Worker is still feature-flagged off;
/// this contract is nevertheless the same path used by the isolation harness.
/// </summary>
public sealed record WorkerIpcEnvelope(
    int SchemaVersion,
    string Kind,
    string RequestId,
    string SessionId,
    string TraceId,
    string? Proof = null,
    string? Error = null,
    JsonElement? Payload = null,
    long? DeadlineUnixMs = null);

public static class WorkerIpcProtocol
{
    public const int CurrentSchemaVersion = 1;
    public const int MaxFrameBytes = 1024 * 1024;

    public static string ComputeProof(string token, string requestId, string sessionId, int schemaVersion = CurrentSchemaVersion)
    {
        var input = $"{schemaVersion}:{sessionId}:{requestId}";
        return Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(token ?? string.Empty),
            Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
    }

    public static bool VerifyProof(string token, WorkerIpcEnvelope envelope)
    {
        if (string.IsNullOrWhiteSpace(envelope.Proof)) return false;
        var expected = ComputeProof(token, envelope.RequestId, envelope.SessionId, envelope.SchemaVersion);
        try
        {
            var provided = Convert.FromHexString(envelope.Proof);
            var actual = Convert.FromHexString(expected);
            return CryptographicOperations.FixedTimeEquals(provided, actual);
        }
        catch (FormatException) { return false; }
    }

    public static string Serialize(WorkerIpcEnvelope envelope)
        => JsonSerializer.Serialize(envelope);

    public static WorkerIpcEnvelope Deserialize(string line)
    {
        if (string.IsNullOrWhiteSpace(line) || Encoding.UTF8.GetByteCount(line) > MaxFrameBytes)
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "IPC frame is empty or exceeds the size limit.");
        try
        {
            var value = JsonSerializer.Deserialize<WorkerIpcEnvelope>(line);
            return value ?? throw new WorkerIpcProtocolException("INVALID_REQUEST", "IPC frame is null.");
        }
        catch (JsonException error)
        {
            throw new WorkerIpcProtocolException("INVALID_REQUEST", "IPC frame is not valid JSON.", error);
        }
    }

    public static WorkerIpcEnvelope Error(string requestId, string sessionId, string code, string traceId = "")
        => new(CurrentSchemaVersion, "error", requestId, sessionId, traceId, Error: code);
}

public sealed class WorkerIpcProtocolException : Exception
{
    public WorkerIpcProtocolException(string code, string message, Exception? inner = null) : base(message, inner)
        => Code = code;

    public string Code { get; }
}
