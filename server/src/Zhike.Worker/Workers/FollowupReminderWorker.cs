using Zhike.Infrastructure.Database;

namespace Zhike.Worker.Workers;

public sealed class FollowupReminderWorker(PostgresConnectionFactory connections, ILogger<FollowupReminderWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await PublishDueRemindersAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogError(error, "follow-up reminder cycle failed");
            }
        }
    }

    private async Task PublishDueRemindersAsync(CancellationToken cancellationToken)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new Npgsql.NpgsqlCommand("""
            SELECT id, customer_id, reason_key, title, detail, due_at, priority, source_message_id
            FROM followup_tasks
            WHERE state = 'pending' AND due_at IS NOT NULL AND due_at <= now()
            ORDER BY due_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 100
            """, connection, transaction);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var dueRows = new List<(string Id, string CustomerId, string ReasonKey, string Title, string Detail, DateTimeOffset DueAt, string Priority, string? SourceMessageId)>();
        while (await reader.ReadAsync(cancellationToken))
            dueRows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetFieldValue<DateTimeOffset>(5), reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7)));
        await reader.DisposeAsync();
        foreach (var row in dueRows)
        {
            await using var mark = new Npgsql.NpgsqlCommand("UPDATE followup_tasks SET state = 'notified', updated_at = now() WHERE id = $1 AND state = 'pending'", connection, transaction);
            mark.Parameters.AddWithValue(row.Id);
            await mark.ExecuteNonQueryAsync(cancellationToken);

            await using var outbox = new Npgsql.NpgsqlCommand("""
                INSERT INTO sync_outbox(aggregate_type, aggregate_id, event_type, payload)
                VALUES ('followup', $1, 'followup.reminder.due', $2)
                ON CONFLICT DO NOTHING
                """, connection, transaction);
            outbox.Parameters.AddWithValue(row.Id);
            outbox.Parameters.Add(new Npgsql.NpgsqlParameter { NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Jsonb, Value = System.Text.Json.JsonSerializer.Serialize(new { followupId = row.Id, customerId = row.CustomerId, reasonKey = row.ReasonKey, title = row.Title, detail = row.Detail, dueAt = row.DueAt, priority = row.Priority, sourceMessageId = row.SourceMessageId }) });
            await outbox.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }
}
