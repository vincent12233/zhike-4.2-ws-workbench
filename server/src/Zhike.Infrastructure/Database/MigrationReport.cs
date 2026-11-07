namespace Zhike.Infrastructure.Database;

public sealed record MigrationReport(
    IReadOnlyList<int> Applied,
    IReadOnlyList<int> Skipped,
    IReadOnlyList<string> Failed);
