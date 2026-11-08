using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record CustomerInput(
    string? Id,
    string? Name,
    string? Phone,
    string? Country,
    string? Language,
    string? Source,
    string? Stage,
    string? Status,
    string? IntentLevel,
    string? Occupation,
    int? Age,
    string? Budget,
    string? ProductInterest,
    string? Notes,
    string? AiSummary,
    string? IdentityType = null,
    string? IdentityValue = null);

public sealed record CustomerRow(
    string Id,
    string Name,
    string Phone,
    string Country,
    string Language,
    string Source,
    string Stage,
    string Status,
    string IntentLevel,
    string Occupation,
    int? Age,
    string Budget,
    string ProductInterest,
    string Notes,
    string AiSummary,
    DateTimeOffset UpdatedAt,
    string StatusColor = "gray",
    IReadOnlyList<string>? Tags = null,
    string ProfileSummary = "",
    double CompletenessScore = 0,
    DateTimeOffset? NextFollowupAt = null);

public sealed class CustomerRepository(PostgresConnectionFactory connections)
{
    public async Task<IReadOnlyList<CustomerRow>> ListAsync(string? search, string? cursor, int limit = 100, CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 500);
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT c.id, c.name, c.phone, c.country, c.language, c.source, c.stage, c.status, c.intent_level, c.occupation, c.age, c.budget, c.product_interest, c.notes, c.ai_summary, c.updated_at,
                   COALESCE(h.status_color, 'gray'), COALESCE(h.tags::text, '[]'), COALESCE(h.profile_summary, ''), COALESCE(h.completeness_score, 0), h.next_followup_at
            FROM customers c
            LEFT JOIN LATERAL (SELECT status_color, tags, profile_summary, completeness_score, next_followup_at FROM hot_chat_profiles hp WHERE hp.customer_id = c.id ORDER BY hp.updated_at DESC LIMIT 1) h ON true
            WHERE c.deleted_at IS NULL
              AND ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%' OR c.source ILIKE '%' || $1 || '%' OR c.product_interest ILIKE '%' || $1 || '%')
              AND ($2 = '' OR c.id > $2)
            ORDER BY c.id
            LIMIT $3
            """, connection);
        command.Parameters.AddWithValue(search?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(cursor?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(safeLimit);
        return await ReadRowsAsync(command, cancellationToken);
    }

    public async Task<CustomerRow?> UpsertFillEmptyAsync(CustomerInput input, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var result = await UpsertFillEmptyAsync(connection, transaction, input, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    internal async Task<CustomerRow?> UpsertFillEmptyAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, CustomerInput input, CancellationToken cancellationToken = default)
    {
        var id = string.IsNullOrWhiteSpace(input.Id) ? $"cust-{Guid.NewGuid():N}" : input.Id.Trim();
        var identityType = string.IsNullOrWhiteSpace(input.IdentityType) ? "phone" : input.IdentityType.Trim().ToLowerInvariant();
        var identityValue = input.IdentityValue?.Trim() ?? input.Phone?.Trim() ?? string.Empty;
        if (identityType.Equals("phone", StringComparison.OrdinalIgnoreCase)) identityValue = NormalizePhone(identityValue);
        if (!string.IsNullOrWhiteSpace(identityValue))
        {
            await using (var lockCommand = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", connection, transaction))
            {
                lockCommand.Parameters.AddWithValue(identityType);
                lockCommand.Parameters.AddWithValue(identityValue);
                await lockCommand.ExecuteNonQueryAsync(cancellationToken);
            }
            await using var identity = new NpgsqlCommand("""
                SELECT i.customer_id FROM customer_identities i
                JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
                WHERE i.identity_type = $1 AND i.normalized_value = $2
                UNION ALL SELECT id FROM customers WHERE deleted_at IS NULL AND $1 = 'phone' AND regexp_replace(phone, '\D', '', 'g') = $2
                LIMIT 1
                """, connection, transaction);
            identity.Parameters.AddWithValue(identityType);
            identity.Parameters.AddWithValue(identityValue);
            id = Convert.ToString(await identity.ExecuteScalarAsync(cancellationToken)) ?? id;
        }
        await using var command = new NpgsqlCommand("""
            INSERT INTO customers(id, name, phone, country, language, source, stage, status, intent_level, occupation, age, budget, product_interest, notes, ai_summary)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO UPDATE SET
                -- CASE WHEN customers.name = '' THEN EXCLUDED.name (fill-empty contract; whitespace is blank too)
                name = CASE WHEN NULLIF(BTRIM(customers.name), '') IS NULL THEN EXCLUDED.name ELSE customers.name END,
                phone = CASE WHEN NULLIF(BTRIM(customers.phone), '') IS NULL THEN EXCLUDED.phone ELSE customers.phone END,
                country = CASE WHEN NULLIF(BTRIM(customers.country), '') IS NULL THEN EXCLUDED.country ELSE customers.country END,
                language = CASE WHEN NULLIF(BTRIM(customers.language), '') IS NULL THEN EXCLUDED.language ELSE customers.language END,
                source = CASE WHEN NULLIF(BTRIM(customers.source), '') IS NULL THEN EXCLUDED.source ELSE customers.source END,
                stage = CASE WHEN NULLIF(BTRIM(customers.stage), '') IS NULL THEN EXCLUDED.stage ELSE customers.stage END,
                status = CASE WHEN NULLIF(BTRIM(customers.status), '') IS NULL THEN EXCLUDED.status ELSE customers.status END,
                intent_level = CASE WHEN NULLIF(BTRIM(customers.intent_level), '') IS NULL THEN EXCLUDED.intent_level ELSE customers.intent_level END,
                occupation = CASE WHEN NULLIF(BTRIM(customers.occupation), '') IS NULL THEN EXCLUDED.occupation ELSE customers.occupation END,
                age = COALESCE(customers.age, EXCLUDED.age),
                budget = CASE WHEN NULLIF(BTRIM(customers.budget), '') IS NULL THEN EXCLUDED.budget ELSE customers.budget END,
                product_interest = CASE WHEN NULLIF(BTRIM(customers.product_interest), '') IS NULL THEN EXCLUDED.product_interest ELSE customers.product_interest END,
                notes = CASE WHEN NULLIF(BTRIM(customers.notes), '') IS NULL THEN EXCLUDED.notes ELSE customers.notes END,
                ai_summary = CASE WHEN NULLIF(BTRIM(customers.ai_summary), '') IS NULL THEN EXCLUDED.ai_summary ELSE customers.ai_summary END,
                updated_at = now()
            """, connection, transaction);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(input.Name?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(NormalizePhone(input.Phone?.Trim() ?? string.Empty));
        command.Parameters.AddWithValue(input.Country?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Language?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Source?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Stage?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Status?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.IntentLevel?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Occupation?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue((object?)input.Age ?? DBNull.Value);
        command.Parameters.AddWithValue(input.Budget?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.ProductInterest?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.Notes?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.AiSummary?.Trim() ?? string.Empty);
        await command.ExecuteNonQueryAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(identityValue))
        {
            // A soft-deleted customer may still own the unique identity row. Rebind
            // that identity only when its current owner is deleted; never steal an
            // identity from an active customer. This keeps re-imports idempotent and
            // prevents a new active profile from becoming unmatchable.
            await using (var rebind = new NpgsqlCommand("""
                UPDATE customer_identities AS i
                SET customer_id = $1, raw_value = $4, source = 'api', is_primary = true
                WHERE i.identity_type = $2
                  AND i.normalized_value = $3
                  AND EXISTS (SELECT 1 FROM customers c WHERE c.id = i.customer_id AND c.deleted_at IS NOT NULL)
                """, connection, transaction))
            {
                rebind.Parameters.AddWithValue(id);
                rebind.Parameters.AddWithValue(identityType);
                rebind.Parameters.AddWithValue(identityValue);
                rebind.Parameters.AddWithValue(identityValue);
                var rebound = await rebind.ExecuteNonQueryAsync(cancellationToken);
                if (rebound == 0)
                {
                    await using var identity = new NpgsqlCommand("""
                        INSERT INTO customer_identities(customer_id, identity_type, normalized_value, raw_value, source, is_primary)
                        VALUES ($1, $2, $3, $4, 'api', true)
                        ON CONFLICT (identity_type, normalized_value) DO NOTHING
                        """, connection, transaction);
                    identity.Parameters.AddWithValue(id);
                    identity.Parameters.AddWithValue(identityType);
                    identity.Parameters.AddWithValue(identityValue);
                    identity.Parameters.AddWithValue(identityValue);
                    await identity.ExecuteNonQueryAsync(cancellationToken);
                }
            }
        }
        await AuditWriter.AppendAsync(connection, transaction, "system", "api", "customer.upsert.fill-empty", "customer", id, new { identityType, identityValue }, cancellationToken);
        return await GetAsync(connection, transaction, id, cancellationToken);
    }

    public Task<int> RecycleAsync(string id, CancellationToken cancellationToken = default) => SetDeletedAsync(id, true, cancellationToken);
    public Task<int> RestoreAsync(string id, CancellationToken cancellationToken = default) => SetDeletedAsync(id, false, cancellationToken);

    public async Task<CustomerRow?> GetAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT c.id, c.name, c.phone, c.country, c.language, c.source, c.stage, c.status, c.intent_level, c.occupation, c.age, c.budget, c.product_interest, c.notes, c.ai_summary, c.updated_at,
                   COALESCE(h.status_color, 'gray'), COALESCE(h.tags::text, '[]'), COALESCE(h.profile_summary, ''), COALESCE(h.completeness_score, 0), h.next_followup_at
            FROM customers c
            LEFT JOIN LATERAL (SELECT status_color, tags, profile_summary, completeness_score, next_followup_at FROM hot_chat_profiles hp WHERE hp.customer_id = c.id ORDER BY hp.updated_at DESC LIMIT 1) h ON true
            WHERE c.id = $1
            """, connection);
        command.Parameters.AddWithValue(id);
        return (await ReadRowsAsync(command, cancellationToken)).FirstOrDefault();
    }

    private static async Task<CustomerRow?> GetAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string id, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            SELECT c.id, c.name, c.phone, c.country, c.language, c.source, c.stage, c.status, c.intent_level, c.occupation, c.age, c.budget, c.product_interest, c.notes, c.ai_summary, c.updated_at,
                   COALESCE(h.status_color, 'gray'), COALESCE(h.tags::text, '[]'), COALESCE(h.profile_summary, ''), COALESCE(h.completeness_score, 0), h.next_followup_at
            FROM customers c
            LEFT JOIN LATERAL (SELECT status_color, tags, profile_summary, completeness_score, next_followup_at FROM hot_chat_profiles hp WHERE hp.customer_id = c.id ORDER BY hp.updated_at DESC LIMIT 1) h ON true
            WHERE c.id = $1
            """, connection, transaction);
        command.Parameters.AddWithValue(id);
        return (await ReadRowsAsync(command, cancellationToken)).FirstOrDefault();
    }

    private async Task<int> SetDeletedAsync(string id, bool deleted, CancellationToken cancellationToken)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("UPDATE customers SET deleted_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1", connection);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(deleted);
        var changed = await command.ExecuteNonQueryAsync(cancellationToken);
        if (changed > 0) await AuditWriter.AppendAsync(connection, null, "system", "api", deleted ? "customer.recycle" : "customer.restore", "customer", id, new { deleted }, cancellationToken);
        return changed;
    }

    private static async Task<IReadOnlyList<CustomerRow>> ReadRowsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var rows = new List<CustomerRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new CustomerRow(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.GetString(6), reader.GetString(7), reader.GetString(8), reader.GetString(9), reader.IsDBNull(10) ? null : reader.GetInt32(10), reader.GetString(11), reader.GetString(12), reader.GetString(13), reader.GetString(14), reader.GetFieldValue<DateTimeOffset>(15),
                reader.GetString(16), ParseTags(reader.GetString(17)), reader.GetString(18), Convert.ToDouble(reader.GetValue(19)), reader.IsDBNull(20) ? null : reader.GetFieldValue<DateTimeOffset>(20)));
        }
        return rows;
    }

    private static IReadOnlyList<string> ParseTags(string json)
    {
        try { return JsonSerializer.Deserialize<string[]>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static string NormalizePhone(string value) => new(value.Where(char.IsDigit).ToArray());
}
