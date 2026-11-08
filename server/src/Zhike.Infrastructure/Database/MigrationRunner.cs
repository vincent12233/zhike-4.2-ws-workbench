using System.Diagnostics;
using System.Text.RegularExpressions;
using Npgsql;

namespace Zhike.Infrastructure.Database;

public sealed class MigrationRunner(PostgresConnectionFactory connections, string migrationsDirectory)
{
    private static readonly Regex VersionPattern = new("^(?<version>\\d+)-", RegexOptions.Compiled);
    public int LatestVersion => Directory.Exists(migrationsDirectory)
        ? Directory.EnumerateFiles(migrationsDirectory, "*.sql")
            .Select(path => VersionPattern.Match(Path.GetFileName(path)))
            .Where(match => match.Success && int.TryParse(match.Groups["version"].Value, out _))
            .Select(match => int.Parse(match.Groups["version"].Value))
            .DefaultIfEmpty(0)
            .Max()
        : 0;

    public MigrationDiagnostics LastDiagnostics { get; private set; } = MigrationDiagnostics.Empty;

    /// <summary>
    /// Returns the highest migration that is actually recorded in the
    /// database.  The file-system maximum is useful as a deployment target,
    /// but health reporting must not claim a schema is current when a
    /// migration was only copied to the image and never committed.
    /// </summary>
    public async Task<int> GetAppliedVersionAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken) ?? 0);
    }

    public async Task<MigrationReport> ApplyAsync(CancellationToken cancellationToken = default)
    {
        var applied = new List<int>();
        var skipped = new List<int>();
        var failed = new List<string>();
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using (var bootstrap = new NpgsqlCommand("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), description TEXT NOT NULL);", connection))
            await bootstrap.ExecuteNonQueryAsync(cancellationToken);

        // Compose normally runs one API instance, but the lock keeps a
        // rolling deployment or an accidental second instance from applying
        // the same migration concurrently.
        await using var migrationLock = new NpgsqlCommand("SELECT pg_advisory_lock(hashtextextended('zhike:migrations', 0))", connection);
        var lockTimeoutSeconds = Math.Clamp(ParseInt(Environment.GetEnvironmentVariable("ZHike__MigrationLockTimeoutSeconds") ?? Environment.GetEnvironmentVariable("ZHike_MIGRATION_LOCK_TIMEOUT_SECONDS"), 30), 5, 300);
        using var lockTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        lockTimeout.CancelAfter(TimeSpan.FromSeconds(lockTimeoutSeconds));
        var lockTimer = Stopwatch.StartNew();
        try
        {
            await migrationLock.ExecuteNonQueryAsync(lockTimeout.Token);
        }
        catch (OperationCanceledException) when (lockTimeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            lockTimer.Stop();
            LastDiagnostics = CollectDiagnostics(lockTimer.ElapsedMilliseconds, true);
            throw new TimeoutException($"等待数据库迁移锁超过 {lockTimeoutSeconds} 秒，请检查是否有另一个 API 实例正在执行迁移。");
        }
        lockTimer.Stop();
        LastDiagnostics = CollectDiagnostics(lockTimer.ElapsedMilliseconds, false);
        try
        {
            return await ApplyLockedAsync(connection, applied, skipped, failed, cancellationToken);
        }
        finally
        {
            await using var unlock = new NpgsqlCommand("SELECT pg_advisory_unlock(hashtextextended('zhike:migrations', 0))", connection);
            await unlock.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    private async Task<MigrationReport> ApplyLockedAsync(
        NpgsqlConnection connection,
        List<int> applied,
        List<int> skipped,
        List<string> failed,
        CancellationToken cancellationToken)
    {

        foreach (var file in Directory.EnumerateFiles(migrationsDirectory, "*.sql").OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            var match = VersionPattern.Match(Path.GetFileName(file));
            if (!match.Success || !int.TryParse(match.Groups["version"].Value, out var version))
            {
                failed.Add($"invalid migration filename: {Path.GetFileName(file)}");
                continue;
            }

            await using var check = new NpgsqlCommand("SELECT 1 FROM schema_migrations WHERE version = $1", connection);
            check.Parameters.AddWithValue(version);
            if (await check.ExecuteScalarAsync(cancellationToken) is not null)
            {
                skipped.Add(version);
                continue;
            }

            var sql = await File.ReadAllTextAsync(file, cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                await using var command = new NpgsqlCommand(sql, connection, transaction);
                await command.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                applied.Add(version);
            }
            catch (Exception error)
            {
                await transaction.RollbackAsync(cancellationToken);
                failed.Add($"{Path.GetFileName(file)}: {error.Message}");
                throw;
            }
        }

        return new MigrationReport(applied, skipped, failed);
    }

    private static int ParseInt(string? value, int fallback)
        => int.TryParse(value, out var parsed) ? parsed : fallback;

    private MigrationDiagnostics CollectDiagnostics(long lockWaitMs, bool lockTimedOut)
    {
        var memory = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        var storagePath = Environment.GetEnvironmentVariable("ZHike_STORAGE_PATH") ?? migrationsDirectory;
        long freeDisk = -1;
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(storagePath));
            if (!string.IsNullOrWhiteSpace(root)) freeDisk = new DriveInfo(root).AvailableFreeSpace;
        }
        catch { /* diagnostics must never block migrations */ }
        return new MigrationDiagnostics(lockWaitMs, lockTimedOut, memory, freeDisk, DateTimeOffset.UtcNow);
    }
}

public sealed record MigrationDiagnostics(
    long LockWaitMs,
    bool LockTimedOut,
    long AvailableMemoryBytes,
    long AvailableDiskBytes,
    DateTimeOffset At)
{
    public static MigrationDiagnostics Empty { get; } = new(0, false, -1, -1, DateTimeOffset.MinValue);
}
