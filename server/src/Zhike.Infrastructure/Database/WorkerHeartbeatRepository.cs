using Npgsql;

namespace Zhike.Infrastructure.Database;

/// <summary>
/// Small liveness record shared by the API health endpoint and background
/// workers. It contains no payload or customer data and is safe to update
/// frequently under the existing PostgreSQL connection pool.
/// </summary>
public sealed class WorkerHeartbeatRepository(PostgresConnectionFactory connections)
{
    public async Task MarkAliveAsync(string workerName, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(workerName)) throw new ArgumentException("workerName is required", nameof(workerName));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO worker_heartbeats(worker_name, last_seen_at, status, updated_at)
            VALUES ($1, now(), 'running', now())
            ON CONFLICT (worker_name) DO UPDATE SET
                last_seen_at = EXCLUDED.last_seen_at,
                status = 'running',
                updated_at = now()
            """, connection);
        command.Parameters.AddWithValue(workerName.Trim());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<string> GetStatusAsync(string workerName, TimeSpan staleAfter, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(workerName)) return "unknown";
        var seconds = Math.Clamp((int)Math.Round(staleAfter.TotalSeconds), 5, 86_400);
        try
        {
            await using var connection = connections.Create();
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand("""
                SELECT CASE
                    WHEN last_seen_at >= now() - ($2 * interval '1 second') THEN 'running'
                    ELSE 'stale'
                END
                FROM worker_heartbeats
                WHERE worker_name = $1
                """, connection);
            command.Parameters.AddWithValue(workerName.Trim());
            command.Parameters.AddWithValue(seconds);
            return (await command.ExecuteScalarAsync(cancellationToken))?.ToString() ?? "unknown";
        }
        catch (Exception error) when (error is NpgsqlException or TimeoutException)
        {
            // Health should remain useful during an upgrade where the new
            // heartbeat table is not available yet.
            return "unknown";
        }
    }
}
