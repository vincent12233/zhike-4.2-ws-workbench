namespace Zhike.SqliteToPostgres;

public sealed record ReconciliationReport(
    string Mode,
    string SourceHash,
    int CustomerCount,
    int BusinessRecordCount,
    int WsAccountCount,
    bool RollbackAvailable);
