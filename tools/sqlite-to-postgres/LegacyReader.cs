namespace Zhike.SqliteToPostgres;

public sealed record LegacyReaderOptions(string SourcePath, bool ReadOnly = true);
