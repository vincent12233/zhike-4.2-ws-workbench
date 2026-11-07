using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Zhike.Infrastructure.Database;

public static class AuditWriter
{
    public static async Task AppendAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string actorType,
        string actorId,
        string eventType,
        string aggregateType,
        string aggregateId,
        object? payload,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("INSERT INTO audit_events(actor_type, actor_id, event_type, aggregate_type, aggregate_id, payload) VALUES ($1,$2,$3,$4,$5,$6)", connection, transaction);
        command.Parameters.AddWithValue(actorType ?? string.Empty);
        command.Parameters.AddWithValue(actorId ?? string.Empty);
        command.Parameters.AddWithValue(eventType ?? string.Empty);
        command.Parameters.AddWithValue(aggregateType ?? string.Empty);
        command.Parameters.AddWithValue(aggregateId ?? string.Empty);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(payload ?? new { }) });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
