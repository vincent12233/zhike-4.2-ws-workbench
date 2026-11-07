namespace Zhike.Contracts;

public sealed record HealthResponse(
    string AppVersion,
    int SchemaVersion,
    string DatabaseStatus,
    string WorkerStatus);
