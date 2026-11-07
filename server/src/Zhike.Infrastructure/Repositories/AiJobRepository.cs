using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Domain.Jobs;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed class AiJobRepository(PostgresConnectionFactory connections)
{
    public async Task<string> EnqueueAsync(string jobType, string dedupeKey, object payload, CancellationToken cancellationToken = default)
    {
        var jobId = $"job-{Guid.NewGuid():N}";
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO ai_jobs(id, job_type, dedupe_key, payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (dedupe_key) DO UPDATE SET updated_at = ai_jobs.updated_at
            RETURNING id
            """, connection);
        command.Parameters.AddWithValue(jobId);
        command.Parameters.AddWithValue(dedupeKey);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(payload) });
        return Convert.ToString(await command.ExecuteScalarAsync(cancellationToken)) ?? jobId;
    }

    public async Task<IReadOnlyList<JobClaim>> ClaimAsync(int batchSize, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT id, job_type, dedupe_key, payload::text, attempts
            FROM ai_jobs
            WHERE state IN ('pending', 'retrying') AND available_at <= now()
            ORDER BY available_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT $1
            """, connection, transaction);
        command.Parameters.AddWithValue(batchSize);
        var claims = new List<JobClaim>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
                claims.Add(new JobClaim(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4) + 1, DateTimeOffset.UtcNow));
        }
        foreach (var claim in claims)
        {
            await using var mark = new NpgsqlCommand("UPDATE ai_jobs SET state = 'running', attempts = $2, locked_at = now(), updated_at = now() WHERE id = $1", connection, transaction);
            mark.Parameters.AddWithValue(claim.Id);
            mark.Parameters.AddWithValue(claim.Attempts);
            await mark.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return claims;
    }

    public async Task CompleteAsync(string jobId, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("UPDATE ai_jobs SET state = 'succeeded', locked_at = NULL, updated_at = now() WHERE id = $1", connection);
        command.Parameters.AddWithValue(jobId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task FailAsync(string jobId, string error, int maxAttempts, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            UPDATE ai_jobs
            SET state = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'retrying' END,
                available_at = CASE WHEN attempts >= $3 THEN now() ELSE now() + make_interval(secs => LEAST(300, power(2, GREATEST(attempts - 1, 0))::int)) END,
                locked_at = NULL,
                last_error = LEFT($2, 500),
                updated_at = now()
            WHERE id = $1
            """, connection);
        command.Parameters.AddWithValue(jobId);
        command.Parameters.AddWithValue(error ?? string.Empty);
        command.Parameters.AddWithValue(maxAttempts);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
