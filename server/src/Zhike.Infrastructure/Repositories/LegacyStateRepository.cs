using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record LegacyStateResult(string? Json, long Revision);
public sealed record LegacySnapshotRow(long Id, DateTimeOffset CreatedAt, string Reason, string Json);
public sealed record LegacySaveResult(bool Saved, bool Conflict, long Revision);

public sealed class LegacyStateRepository(PostgresConnectionFactory connections)
{
    public async Task<LegacyStateResult?> GetAsync(string ownerId, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT state::text, revision FROM legacy_workspace_state WHERE owner_id = $1", connection);
        command.Parameters.AddWithValue(NormalizeOwner(ownerId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new LegacyStateResult(reader.GetString(0), reader.GetInt64(1));
    }

    public async Task<LegacySaveResult> SaveAsync(string ownerId, JsonElement state, long? expectedRevision, CancellationToken cancellationToken = default)
    {
        var owner = NormalizeOwner(ownerId);
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        long currentRevision = 0;
        await using (var read = new NpgsqlCommand("SELECT revision FROM legacy_workspace_state WHERE owner_id = $1 FOR UPDATE", connection, transaction))
        {
            read.Parameters.AddWithValue(owner);
            currentRevision = Convert.ToInt64(await read.ExecuteScalarAsync(cancellationToken) ?? 0L);
        }
        if (expectedRevision.HasValue && expectedRevision.Value != currentRevision)
        {
            await transaction.RollbackAsync(cancellationToken);
            return new LegacySaveResult(false, true, currentRevision);
        }

        var nextRevision = currentRevision + 1;
        await using (var write = new NpgsqlCommand("""
            INSERT INTO legacy_workspace_state(owner_id, state, revision, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT(owner_id) DO UPDATE SET state = EXCLUDED.state, revision = EXCLUDED.revision, updated_at = now()
            """, connection, transaction))
        {
            write.Parameters.AddWithValue(owner);
            var stateParameter = write.Parameters.Add("$2", NpgsqlDbType.Jsonb);
            stateParameter.Value = state.GetRawText();
            write.Parameters.AddWithValue(nextRevision);
            await write.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return new LegacySaveResult(true, false, nextRevision);
    }

    public async Task<long> CreateSnapshotAsync(string ownerId, string reason, int retention = 20, CancellationToken cancellationToken = default)
    {
        var owner = NormalizeOwner(ownerId);
        var current = await GetAsync(owner, cancellationToken);
        if (current is null) return 0;
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var insert = new NpgsqlCommand("INSERT INTO legacy_workspace_snapshots(owner_id, reason, state) VALUES ($1, $2, $3) RETURNING id", connection, transaction))
        {
            insert.Parameters.AddWithValue(owner);
            insert.Parameters.AddWithValue((reason ?? string.Empty).Trim()[..Math.Min(200, (reason ?? string.Empty).Trim().Length)]);
            var stateParameter = insert.Parameters.Add("$3", NpgsqlDbType.Jsonb);
            stateParameter.Value = current.Json ?? "{}";
            var id = Convert.ToInt64(await insert.ExecuteScalarAsync(cancellationToken));
            await using var purge = new NpgsqlCommand("DELETE FROM legacy_workspace_snapshots WHERE owner_id = $1 AND id NOT IN (SELECT id FROM legacy_workspace_snapshots WHERE owner_id = $1 ORDER BY id DESC LIMIT $2)", connection, transaction);
            purge.Parameters.AddWithValue(owner);
            purge.Parameters.AddWithValue(Math.Clamp(retention, 1, 100));
            await purge.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return id;
        }
    }

    public async Task<IReadOnlyList<LegacySnapshotRow>> ListSnapshotsAsync(string ownerId, int retention = 20, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id, created_at, reason, state::text FROM legacy_workspace_snapshots WHERE owner_id = $1 ORDER BY id DESC LIMIT $2", connection);
        command.Parameters.AddWithValue(NormalizeOwner(ownerId));
        command.Parameters.AddWithValue(Math.Clamp(retention, 1, 100));
        var rows = new List<LegacySnapshotRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new LegacySnapshotRow(reader.GetInt64(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetString(2), reader.GetString(3)));
        return rows;
    }

    public async Task<LegacySnapshotRow?> GetSnapshotAsync(string ownerId, long id, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id, created_at, reason, state::text FROM legacy_workspace_snapshots WHERE owner_id = $1 AND id = $2", connection);
        command.Parameters.AddWithValue(NormalizeOwner(ownerId));
        command.Parameters.AddWithValue(id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new LegacySnapshotRow(reader.GetInt64(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetString(2), reader.GetString(3));
    }

    private static string NormalizeOwner(string? ownerId) => string.IsNullOrWhiteSpace(ownerId) ? "default" : ownerId.Trim()[..Math.Min(200, ownerId.Trim().Length)];
}
