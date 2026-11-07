using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed class OutboxRepository(PostgresConnectionFactory connections)
{
    public async Task<long> EnqueueAsync(string aggregateType, string aggregateId, string eventType, object payload, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO sync_outbox(aggregate_type, aggregate_id, event_type, payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
            RETURNING id
            """, connection);
        command.Parameters.AddWithValue(aggregateType);
        command.Parameters.AddWithValue(aggregateId);
        command.Parameters.AddWithValue(eventType);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(payload) });
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is null || value is DBNull ? 0 : Convert.ToInt64(value);
    }

    public async Task<int> MarkDeliveredAsync(long id, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("UPDATE sync_outbox SET state = 'succeeded', updated_at = now() WHERE id = $1 AND state <> 'succeeded'", connection);
        command.Parameters.AddWithValue(id);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
