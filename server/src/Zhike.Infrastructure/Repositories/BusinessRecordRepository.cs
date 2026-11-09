using Npgsql;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record BusinessRecordInput(
    string? Id,
    string CustomerId,
    string RecordType,
    string? ProductCode,
    string? Direction,
    DateOnly? RegisteredAt,
    DateOnly? BusinessDate,
    DateOnly? NextFollowupAt,
    string? Channel,
    string? Status,
    string? VipCode,
    string? Note,
    string BusinessKey,
    string? SourceBatchId = null,
    string? TradeRef = null);

public sealed record BusinessRecordRow(
    string Id,
    string CustomerId,
    string RecordType,
    string ProductCode,
    string Direction,
    DateOnly? RegisteredAt,
    DateOnly? BusinessDate,
    DateOnly? NextFollowupAt,
    string Channel,
    string Status,
    string VipCode,
    string Note,
    string BusinessKey,
    DateTimeOffset UpdatedAt,
    string TradeRef = "");

public sealed class BusinessRecordRepository(PostgresConnectionFactory connections)
{
    public async Task<BusinessRecordRow?> UpsertAsync(BusinessRecordInput input, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var result = await UpsertAsync(connection, transaction, input, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    internal async Task<BusinessRecordRow?> UpsertAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, BusinessRecordInput input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input.CustomerId)) throw new ArgumentException("customerId is required", nameof(input));
        if (string.IsNullOrWhiteSpace(input.BusinessKey)) throw new ArgumentException("businessKey is required", nameof(input));
        var id = string.IsNullOrWhiteSpace(input.Id) ? $"record-{Guid.NewGuid():N}" : input.Id.Trim();
        await using var command = new NpgsqlCommand("""
            INSERT INTO business_records(id, customer_id, record_type, product_code, direction, registered_at, business_date, next_followup_at, channel, status, vip_code, note, business_key, source_batch_id, trade_ref)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (business_key) DO UPDATE SET
                product_code = CASE WHEN business_records.product_code = '' THEN EXCLUDED.product_code ELSE business_records.product_code END,
                direction = CASE WHEN business_records.direction = '' THEN EXCLUDED.direction ELSE business_records.direction END,
                registered_at = COALESCE(business_records.registered_at, EXCLUDED.registered_at),
                business_date = COALESCE(business_records.business_date, EXCLUDED.business_date),
                next_followup_at = COALESCE(business_records.next_followup_at, EXCLUDED.next_followup_at),
                channel = CASE WHEN business_records.channel = '' THEN EXCLUDED.channel ELSE business_records.channel END,
                status = CASE WHEN business_records.status = '' THEN EXCLUDED.status ELSE business_records.status END,
                vip_code = CASE WHEN business_records.vip_code = '' THEN EXCLUDED.vip_code ELSE business_records.vip_code END,
                note = CASE WHEN business_records.note = '' THEN EXCLUDED.note ELSE business_records.note END,
                trade_ref = CASE WHEN business_records.trade_ref = '' THEN EXCLUDED.trade_ref ELSE business_records.trade_ref END,
                updated_at = now()
            RETURNING id
            """, connection, transaction);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(input.CustomerId);
        command.Parameters.AddWithValue(input.RecordType?.Trim() ?? "ticket");
        command.Parameters.AddWithValue(input.ProductCode?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Direction?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue((object?)input.RegisteredAt ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)input.BusinessDate ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)input.NextFollowupAt ?? DBNull.Value);
        command.Parameters.AddWithValue(input.Channel?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Status?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.VipCode?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Note?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.BusinessKey.Trim());
        command.Parameters.AddWithValue(input.SourceBatchId?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.TradeRef?.Trim() ?? string.Empty);
        var actualId = Convert.ToString(await command.ExecuteScalarAsync(cancellationToken)) ?? id;
        await AuditWriter.AppendAsync(connection, transaction, "system", "api", "business-record.upsert", "business_record", actualId, new { input.RecordType, input.ProductCode, input.Direction, input.RegisteredAt, input.BusinessDate, input.NextFollowupAt, input.SourceBatchId }, cancellationToken);
        return await GetAsync(connection, transaction, actualId, cancellationToken);
    }

    public async Task<IReadOnlyList<BusinessRecordRow>> ListAsync(string? productCode, string? recordType, string? direction, string? cursor, int limit = 100, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT id, customer_id, record_type, product_code, direction, registered_at, business_date, next_followup_at, channel, status, vip_code, note, business_key, updated_at, trade_ref
            FROM business_records
            WHERE deleted_at IS NULL
              AND ($1 = '' OR product_code = $1)
              AND ($2 = '' OR record_type = $2)
              AND ($3 = '' OR direction = $3)
              AND ($4 = '' OR id > $4)
            ORDER BY id
            LIMIT $5
            """, connection);
        command.Parameters.AddWithValue(productCode?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(recordType?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(direction?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(cursor?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(Math.Clamp(limit, 1, 500));
        return await ReadRowsAsync(command, cancellationToken);
    }

    private async Task<BusinessRecordRow?> GetAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id, customer_id, record_type, product_code, direction, registered_at, business_date, next_followup_at, channel, status, vip_code, note, business_key, updated_at, trade_ref FROM business_records WHERE id = $1", connection);
        command.Parameters.AddWithValue(id);
        return (await ReadRowsAsync(command, cancellationToken)).FirstOrDefault();
    }

    private static async Task<BusinessRecordRow?> GetAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string id, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT id, customer_id, record_type, product_code, direction, registered_at, business_date, next_followup_at, channel, status, vip_code, note, business_key, updated_at, trade_ref FROM business_records WHERE id = $1", connection, transaction);
        command.Parameters.AddWithValue(id);
        return (await ReadRowsAsync(command, cancellationToken)).FirstOrDefault();
    }

    private static async Task<IReadOnlyList<BusinessRecordRow>> ReadRowsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var rows = new List<BusinessRecordRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new BusinessRecordRow(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.IsDBNull(5) ? null : DateOnly.FromDateTime(reader.GetDateTime(5)), reader.IsDBNull(6) ? null : DateOnly.FromDateTime(reader.GetDateTime(6)), reader.IsDBNull(7) ? null : DateOnly.FromDateTime(reader.GetDateTime(7)), reader.GetString(8), reader.GetString(9), reader.GetString(10), reader.GetString(11), reader.GetString(12), reader.GetFieldValue<DateTimeOffset>(13), reader.GetString(14)));
        }
        return rows;
    }
}
