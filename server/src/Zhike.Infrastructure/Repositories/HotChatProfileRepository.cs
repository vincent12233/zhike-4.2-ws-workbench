using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Contracts;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record HotChatMutationResult(
    HotChatProfileDto? Profile,
    bool Conflict,
    long CurrentVersion,
    bool Created,
    IReadOnlyList<string> AppliedFields,
    IReadOnlyList<string> Conflicts);

public sealed class HotChatScopeException(string message) : Exception(message);

public sealed class HotChatVersionConflictException(long currentVersion) : Exception("热聊档案版本已变化，请刷新后重试。")
{
    public long CurrentVersion { get; } = currentVersion;
}

/// <summary>
/// Transactional PostgreSQL projection for hot-chat profiles.  The repository
/// deliberately validates the account/conversation/customer tuple before every
/// mutation so a valid session cannot write another WS account's profile.
/// </summary>
public sealed class HotChatProfileRepository(PostgresConnectionFactory connections)
{
    private static readonly HashSet<string> Colors = new(StringComparer.OrdinalIgnoreCase) { "green", "blue", "amber", "red", "gray" };
    private static readonly HashSet<string> States = new(StringComparer.OrdinalIgnoreCase) { "known", "missing", "pending", "declined" };
    private static readonly HashSet<string> ProfileFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "preferred_name", "age", "gender", "occupation", "work_context", "is_investor",
        "investment_years", "holdings", "investment_habits", "investment_preferences",
        "family_context", "life_interests", "future_plans",
    };
    private static readonly IReadOnlyDictionary<string, string> CustomerColumns = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["preferred_name"] = "name",
        ["age"] = "age",
        ["occupation"] = "occupation",
        ["work_context"] = "notes",
        ["is_investor"] = "status",
        ["investment_years"] = "notes",
        ["holdings"] = "product_interest",
        ["investment_habits"] = "notes",
        ["investment_preferences"] = "product_interest",
        ["family_context"] = "notes",
        ["life_interests"] = "notes",
        ["future_plans"] = "notes",
    };

    public async Task<HotChatProfileDto?> GetAsync(string profileId, string accountId, string conversationId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(profileId)) return null;
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await ValidateScopeAsync(connection, null, accountId, conversationId, null, cancellationToken);
        return await ReadProfileAsync(connection, null, profileId.Trim(), accountId.Trim(), conversationId.Trim(), cancellationToken);
    }

    public async Task<HotChatProfileDto?> GetByScopeAsync(string customerId, string accountId, string conversationId, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await ValidateScopeAsync(connection, null, accountId, conversationId, customerId, cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id FROM hot_chat_profiles WHERE customer_id = $1 AND account_id = $2 AND conversation_id = $3", connection);
        command.Parameters.AddWithValue(customerId.Trim());
        command.Parameters.AddWithValue(accountId.Trim());
        command.Parameters.AddWithValue(conversationId.Trim());
        var id = Convert.ToString(await command.ExecuteScalarAsync(cancellationToken));
        return string.IsNullOrWhiteSpace(id) ? null : await ReadProfileAsync(connection, null, id, accountId.Trim(), conversationId.Trim(), cancellationToken);
    }

    public async Task<HotChatMutationResult> UpsertAsync(HotChatProfileUpsertRequest input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var accountId = Require(input.AccountId, nameof(input.AccountId));
        var conversationId = Require(input.ConversationId, nameof(input.ConversationId));
        var customerId = Require(input.CustomerId, nameof(input.CustomerId));
        var id = string.IsNullOrWhiteSpace(input.Id) ? $"hot-{Guid.NewGuid():N}" : input.Id.Trim();
        var requestedColor = input.StatusColor is null ? string.Empty : NormalizeColor(input.StatusColor);
        var tags = NormalizeTags(input.Tags);
        var score = Math.Clamp(input.CompletenessScore ?? 0, 0, 1);

        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await ValidateScopeAsync(connection, transaction, accountId, conversationId, customerId, cancellationToken);
        await using (var scopeLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('hot-profile:' || $1 || ':' || $2, 0))", connection, transaction))
        {
            scopeLock.Parameters.AddWithValue(accountId);
            scopeLock.Parameters.AddWithValue(conversationId);
            await scopeLock.ExecuteNonQueryAsync(cancellationToken);
        }
        var existing = await ReadProfileVersionAsync(connection, transaction, accountId, conversationId, cancellationToken);
        if (existing is not null && !string.Equals(existing.Value.CustomerId, customerId, StringComparison.Ordinal))
            throw new HotChatScopeException("热聊档案客户与当前会话不一致。");
        if (existing is not null && input.ExpectedVersion.HasValue && input.ExpectedVersion.Value != existing.Value.Version)
            return new(null, true, existing.Value.Version, false, [], ["version"]);

        var actualId = existing?.Id ?? id;
        if (existing is null)
        {
            await using var insert = new NpgsqlCommand("""
                INSERT INTO hot_chat_profiles(id, customer_id, account_id, conversation_id, completeness_score, status_color, conversation_stage, last_progress_at, next_topic, no_reply_reason, next_followup_at, profile_summary, tags, manual_color_locked, version)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)
                ON CONFLICT (account_id, conversation_id) DO UPDATE SET updated_at = now()
                RETURNING id
                """, connection, transaction);
            AddProfileParameters(insert, actualId, customerId, accountId, conversationId, score, string.IsNullOrWhiteSpace(requestedColor) ? "gray" : requestedColor, input, tags);
            actualId = Convert.ToString(await insert.ExecuteScalarAsync(cancellationToken)) ?? actualId;
        }
        else
        {
            await using var update = new NpgsqlCommand("""
                UPDATE hot_chat_profiles
                SET completeness_score = COALESCE($5, completeness_score),
                    status_color = COALESCE(NULLIF($6, ''), status_color),
                    conversation_stage = COALESCE($7, conversation_stage),
                    last_progress_at = COALESCE($8, last_progress_at),
                    next_topic = COALESCE($9, next_topic),
                    no_reply_reason = COALESCE($10, no_reply_reason),
                    next_followup_at = COALESCE($11, next_followup_at),
                    profile_summary = COALESCE($12, profile_summary),
                    tags = CASE WHEN $13::jsonb IS NULL THEN tags ELSE $13::jsonb END,
                    manual_color_locked = COALESCE($14, manual_color_locked),
                    version = version + 1,
                    updated_at = now()
                WHERE id = $1 AND account_id = $2 AND conversation_id = $3 AND customer_id = $4
                """, connection, transaction);
            update.Parameters.AddWithValue(actualId);
            update.Parameters.AddWithValue(accountId);
            update.Parameters.AddWithValue(conversationId);
            update.Parameters.AddWithValue(customerId);
            update.Parameters.AddWithValue((object?)input.CompletenessScore ?? DBNull.Value);
            update.Parameters.AddWithValue(requestedColor);
            update.Parameters.AddWithValue((object?)input.ConversationStage?.Trim() ?? DBNull.Value);
            update.Parameters.AddWithValue((object?)input.LastProgressAt ?? DBNull.Value);
            update.Parameters.AddWithValue((object?)input.NextTopic?.Trim() ?? DBNull.Value);
            update.Parameters.AddWithValue((object?)input.NoReplyReason?.Trim() ?? DBNull.Value);
            update.Parameters.AddWithValue((object?)input.NextFollowupAt ?? DBNull.Value);
            update.Parameters.AddWithValue((object?)input.ProfileSummary?.Trim() ?? DBNull.Value);
            update.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Tags is null ? DBNull.Value : tags });
            update.Parameters.AddWithValue((object?)input.ManualColorLocked ?? DBNull.Value);
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        var nextVersion = existing?.Version + 1 ?? 1;
        await EnqueueAsync(connection, transaction, actualId, "profile.upsert", new { id = actualId, accountId, conversationId, version = nextVersion }, $"profile:{actualId}:version:{nextVersion}", cancellationToken);
        await AuditWriter.AppendAsync(connection, transaction, "system", accountId, "hot-chat.profile.upsert", "hot_chat_profile", actualId, new { customerId, conversationId }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var profile = await GetAsync(actualId, accountId, conversationId, cancellationToken);
        return new(profile, false, profile?.Version ?? nextVersion, existing is null, [], []);
    }

    public async Task<HotChatMutationResult> UpsertFieldAsync(string profileId, string accountId, string conversationId, HotChatProfileFieldUpsertRequest input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var id = Require(profileId, nameof(profileId));
        var fieldName = Require(input.FieldName, nameof(input.FieldName));
        if (!ProfileFields.Contains(fieldName)) throw new ArgumentException("unsupported hot-chat profile field", nameof(input.FieldName));
        if (!States.Contains(input.State)) throw new ArgumentException("unsupported hot-chat field state", nameof(input.State));
        if (input.Confidence is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(input.Confidence));

        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var profile = await ReadProfileVersionAsync(connection, transaction, accountId, conversationId, cancellationToken, id);
        if (profile is null) throw new HotChatScopeException("热聊档案不存在或不属于当前 WS 会话。");
        if (input.ExpectedVersion.HasValue && input.ExpectedVersion.Value != profile.Value.Version)
            return new(null, true, profile.Value.Version, false, [], ["version"]);

        var existing = await ReadFieldAsync(connection, transaction, id, fieldName, cancellationToken);
        var incomingValue = input.Value.ValueKind == JsonValueKind.Undefined ? "null" : input.Value.GetRawText();
        var normalizedState = input.State.Trim().ToLowerInvariant();
        var conflicts = new List<string>();
        var applied = new List<string>();
        var blockedByManual = existing is not null && existing.Value.ManualLocked && input.ManualLocked != true;
        var differs = existing is not null && !JsonEquals(existing.Value.ValueJson, incomingValue);
        if (blockedByManual || (input.ManualLocked != true && differs && string.Equals(existing?.State, "known", StringComparison.OrdinalIgnoreCase) && normalizedState == "known"))
        {
            normalizedState = "pending";
            conflicts.Add(fieldName);
        }
        else if (!blockedByManual)
        {
            applied.Add(fieldName);
        }

        if (!blockedByManual)
        {
            await using var field = new NpgsqlCommand("""
                INSERT INTO hot_chat_profile_fields(profile_id, field_name, value_json, state, confidence, source_message_id, source_quote, analysis_id, last_asked_at, manual_locked)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (profile_id, field_name) DO UPDATE SET
                    value_json = EXCLUDED.value_json, state = EXCLUDED.state, confidence = EXCLUDED.confidence,
                    source_message_id = EXCLUDED.source_message_id, source_quote = EXCLUDED.source_quote,
                    analysis_id = EXCLUDED.analysis_id, last_asked_at = EXCLUDED.last_asked_at,
                    manual_locked = EXCLUDED.manual_locked, updated_at = now()
                """, connection, transaction);
            field.Parameters.AddWithValue(id);
            field.Parameters.AddWithValue(fieldName);
            field.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = incomingValue });
            field.Parameters.AddWithValue(normalizedState);
            field.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            field.Parameters.AddWithValue((object?)input.SourceMessageId ?? DBNull.Value);
            field.Parameters.AddWithValue(input.SourceQuote?.Trim() ?? string.Empty);
            field.Parameters.AddWithValue((object?)input.AnalysisId ?? DBNull.Value);
            field.Parameters.AddWithValue((object?)input.LastAskedAt ?? DBNull.Value);
            field.Parameters.AddWithValue(input.ManualLocked ?? existing?.ManualLocked ?? false);
            await field.ExecuteNonQueryAsync(cancellationToken);

            if (normalizedState == "known" && input.Confidence >= 0.6 && !string.IsNullOrWhiteSpace(input.SourceQuote) && TryGetCustomerValue(fieldName, input.Value, out var customerValue))
            {
                var filled = await FillCustomerFieldAsync(connection, transaction, profile.Value.CustomerId, fieldName, customerValue, cancellationToken);
                if (!filled) conflicts.Add(fieldName);
            }
        }

        var nextVersion = profile.Value.Version + 1;
        await using (var bump = new NpgsqlCommand("UPDATE hot_chat_profiles SET version = $2, updated_at = now() WHERE id = $1", connection, transaction))
        {
            bump.Parameters.AddWithValue(id);
            bump.Parameters.AddWithValue(nextVersion);
            await bump.ExecuteNonQueryAsync(cancellationToken);
        }
        var eventType = conflicts.Count > 0 ? "profile.field.conflict" : "profile.field.upsert";
        await AppendEventCoreAsync(connection, transaction, id, accountId, conversationId, eventType, "system", string.Empty, $"field:{id}:{fieldName}:{input.AnalysisId ?? input.SourceMessageId ?? nextVersion.ToString()}", new { fieldName, state = normalizedState, conflicts }, cancellationToken);
        await EnqueueAsync(connection, transaction, id, eventType, new { id, fieldName, state = normalizedState, conflicts, accountId, conversationId }, $"field:{id}:{fieldName}:{input.AnalysisId ?? input.SourceMessageId ?? nextVersion.ToString()}", cancellationToken);
        await AuditWriter.AppendAsync(connection, transaction, "system", accountId, "hot-chat.profile-field.upsert", "hot_chat_profile", id, new { fieldName, state = normalizedState, conflicts }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var result = await GetAsync(id, accountId, conversationId, cancellationToken);
        return new(result, false, result?.Version ?? nextVersion, false, applied, conflicts);
    }

    public async Task<HotChatMutationResult> AppendEventAsync(string profileId, string accountId, string conversationId, HotChatEventRequest input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var id = Require(profileId, nameof(profileId));
        var eventType = Require(input.EventType, nameof(input.EventType));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var profile = await ReadProfileVersionAsync(connection, transaction, accountId, conversationId, cancellationToken, id);
        if (profile is null) throw new HotChatScopeException("热聊档案不存在或不属于当前 WS 会话。");
        var key = string.IsNullOrWhiteSpace(input.IdempotencyKey) ? $"event:{id}:{eventType}:{DateTimeOffset.UtcNow:O}" : input.IdempotencyKey.Trim();
        var inserted = await AppendEventCoreAsync(connection, transaction, id, accountId, conversationId, eventType, input.ActorType ?? "user", input.ActorId ?? string.Empty, key, input.Payload, cancellationToken);
        if (inserted)
        {
            await using var bump = new NpgsqlCommand("UPDATE hot_chat_profiles SET version = version + 1, updated_at = now() WHERE id = $1", connection, transaction);
            bump.Parameters.AddWithValue(id);
            await bump.ExecuteNonQueryAsync(cancellationToken);
            await EnqueueAsync(connection, transaction, id, eventType, input.Payload ?? JsonSerializer.SerializeToElement(new { }), key, cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        var result = await GetAsync(id, accountId, conversationId, cancellationToken);
        return new(result, false, result?.Version ?? profile.Value.Version, false, [], inserted ? [] : ["duplicate"]);
    }

    public async Task<HotChatDiagnosticsDto?> GetDiagnosticsAsync(string profileId, string accountId, string conversationId, CancellationToken cancellationToken = default)
    {
        var id = Require(profileId, nameof(profileId));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await ValidateScopeAsync(connection, null, accountId, conversationId, null, cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT p.version,
                   (SELECT count(*) FROM hot_chat_profile_fields f WHERE f.profile_id = p.id AND f.state IN ('pending','missing')),
                   (SELECT count(*) FROM hot_chat_events e WHERE e.profile_id = p.id),
                   (SELECT count(*) FROM hot_chat_sync_outbox o WHERE o.profile_id = p.id AND o.state IN ('pending','processing')),
                   p.last_progress_at, p.next_followup_at
            FROM hot_chat_profiles p WHERE p.id = $1 AND p.account_id = $2 AND p.conversation_id = $3
            """, connection);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(accountId.Trim());
        command.Parameters.AddWithValue(conversationId.Trim());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new(id, reader.GetInt64(0), Convert.ToInt32(reader.GetInt64(1)), Convert.ToInt32(reader.GetInt64(2)), Convert.ToInt32(reader.GetInt64(3)), reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4), reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5));
    }

    private static async Task ValidateScopeAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, string accountId, string conversationId, string? customerId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(accountId) || string.IsNullOrWhiteSpace(conversationId)) throw new HotChatScopeException("WS 账号和会话不能为空。");
        await using var command = new NpgsqlCommand("SELECT c.account_id, c.customer_id FROM conversations c WHERE c.id = $1", connection, transaction);
        command.Parameters.AddWithValue(conversationId.Trim());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new HotChatScopeException("会话不存在。");
        var owner = reader.GetString(0);
        var linkedCustomer = reader.IsDBNull(1) ? null : reader.GetString(1);
        await reader.CloseAsync();
        if (!string.Equals(owner, accountId.Trim(), StringComparison.Ordinal)) throw new HotChatScopeException("会话不属于当前 WS 账号。");
        if (!string.IsNullOrWhiteSpace(customerId) && linkedCustomer is not null && !string.Equals(linkedCustomer, customerId.Trim(), StringComparison.Ordinal)) throw new HotChatScopeException("会话客户与档案客户不一致。");
        if (!string.IsNullOrWhiteSpace(customerId))
        {
            await using var customer = new NpgsqlCommand("SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL", connection, transaction);
            customer.Parameters.AddWithValue(customerId.Trim());
            if (await customer.ExecuteScalarAsync(cancellationToken) is null) throw new HotChatScopeException("客户不存在或已移入回收站。");
        }
    }

    private static async Task<(string Id, string CustomerId, long Version)?> ReadProfileVersionAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, string accountId, string conversationId, CancellationToken cancellationToken, string? profileId = null)
    {
        var sql = profileId is null
            ? "SELECT id, customer_id, version FROM hot_chat_profiles WHERE account_id = $1 AND conversation_id = $2 FOR UPDATE"
            : "SELECT id, customer_id, version FROM hot_chat_profiles WHERE id = $1 AND account_id = $2 AND conversation_id = $3 FOR UPDATE";
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        if (profileId is null)
        {
            command.Parameters.AddWithValue(accountId.Trim());
            command.Parameters.AddWithValue(conversationId.Trim());
        }
        else
        {
            command.Parameters.AddWithValue(profileId.Trim());
            command.Parameters.AddWithValue(accountId.Trim());
            command.Parameters.AddWithValue(conversationId.Trim());
        }
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return (reader.GetString(0), reader.GetString(1), reader.GetInt64(2));
    }

    private static async Task<HotChatProfileDto?> ReadProfileAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, string profileId, string accountId, string conversationId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            SELECT id, customer_id, account_id, conversation_id, completeness_score, status_color, conversation_stage, last_progress_at, next_topic, no_reply_reason, next_followup_at, profile_summary, tags::text, manual_color_locked, version, created_at, updated_at
            FROM hot_chat_profiles WHERE id = $1 AND account_id = $2 AND conversation_id = $3
            """, connection, transaction);
        command.Parameters.AddWithValue(profileId.Trim());
        command.Parameters.AddWithValue(accountId.Trim());
        command.Parameters.AddWithValue(conversationId.Trim());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var profile = new HotChatProfileDto(
            reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), Convert.ToDouble(reader.GetValue(4)), reader.GetString(5), reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7), reader.GetString(8), reader.GetString(9), reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10), reader.GetString(11), ParseTags(reader.GetString(12)), reader.GetBoolean(13), reader.GetInt64(14), reader.GetFieldValue<DateTimeOffset>(15), reader.GetFieldValue<DateTimeOffset>(16), []);
        await reader.CloseAsync();
        await using var fields = new NpgsqlCommand("SELECT field_name, value_json::text, state, confidence, source_message_id, source_quote, analysis_id, last_asked_at, manual_locked, updated_at FROM hot_chat_profile_fields WHERE profile_id = $1 ORDER BY field_name", connection, transaction);
        fields.Parameters.AddWithValue(profile.Id);
        var list = new List<HotChatProfileFieldDto>();
        await using var fieldReader = await fields.ExecuteReaderAsync(cancellationToken);
        while (await fieldReader.ReadAsync(cancellationToken))
        {
            using var document = JsonDocument.Parse(fieldReader.GetString(1));
            list.Add(new HotChatProfileFieldDto(fieldReader.GetString(0), document.RootElement.Clone(), fieldReader.GetString(2), Convert.ToDouble(fieldReader.GetValue(3)), fieldReader.IsDBNull(4) ? null : fieldReader.GetString(4), fieldReader.GetString(5), fieldReader.IsDBNull(6) ? null : fieldReader.GetString(6), fieldReader.IsDBNull(7) ? null : fieldReader.GetFieldValue<DateTimeOffset>(7), fieldReader.GetBoolean(8), fieldReader.GetFieldValue<DateTimeOffset>(9)));
        }
        return profile with { Fields = list };
    }

    private static async Task<(string ValueJson, string State, bool ManualLocked)?> ReadFieldAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string profileId, string fieldName, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT value_json::text, state, manual_locked FROM hot_chat_profile_fields WHERE profile_id = $1 AND field_name = $2 FOR UPDATE", connection, transaction);
        command.Parameters.AddWithValue(profileId);
        command.Parameters.AddWithValue(fieldName);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? (reader.GetString(0), reader.GetString(1), reader.GetBoolean(2)) : null;
    }

    private static async Task<bool> FillCustomerFieldAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string customerId, string fieldName, string value, CancellationToken cancellationToken)
    {
        if (!CustomerColumns.TryGetValue(fieldName, out var column) || string.IsNullOrWhiteSpace(value)) return false;
        await using (var read = new NpgsqlCommand($"SELECT {column}::text FROM customers WHERE id = $1 FOR UPDATE", connection, transaction))
        {
            read.Parameters.AddWithValue(customerId);
            var existing = Convert.ToString(await read.ExecuteScalarAsync(cancellationToken)) ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(existing)) return false;
        }
        // fill-empty: preserve an existing manual value and only populate a blank field.
        if (column.Equals("age", StringComparison.Ordinal) && (!int.TryParse(value, out var parsedAge) || parsedAge is < 0 or > 120)) return false;
        var sql = column.Equals("age", StringComparison.Ordinal)
            ? "UPDATE customers SET age = CASE WHEN age IS NULL THEN NULLIF($2, '')::integer ELSE age END, updated_at = now() WHERE id = $1"
            : $"UPDATE customers SET {column} = CASE WHEN NULLIF(BTRIM({column}), '') IS NULL THEN $2 ELSE {column} END, updated_at = now() WHERE id = $1";
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue(customerId);
        command.Parameters.AddWithValue(value);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static async Task<bool> AppendEventCoreAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string profileId, string accountId, string conversationId, string eventType, string actorType, string actorId, string idempotencyKey, object? payload, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO hot_chat_events(id, profile_id, account_id, conversation_id, event_type, actor_type, actor_id, idempotency_key, payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (profile_id, idempotency_key) DO NOTHING
            """, connection, transaction);
        command.Parameters.AddWithValue($"event-{Guid.NewGuid():N}");
        command.Parameters.AddWithValue(profileId);
        command.Parameters.AddWithValue(accountId.Trim());
        command.Parameters.AddWithValue(conversationId.Trim());
        command.Parameters.AddWithValue(eventType.Trim());
        command.Parameters.AddWithValue(actorType?.Trim() ?? "system");
        command.Parameters.AddWithValue(actorId?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(idempotencyKey.Trim());
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonText(payload) });
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static async Task EnqueueAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string profileId, string eventType, object payload, string idempotencyKey, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO hot_chat_sync_outbox(profile_id, aggregate_id, event_type, idempotency_key, payload)
            VALUES ($1,$1,$2,$3,$4)
            ON CONFLICT (aggregate_type, aggregate_id, event_type, idempotency_key) DO NOTHING
            """, connection, transaction);
        command.Parameters.AddWithValue(profileId);
        command.Parameters.AddWithValue(eventType);
        command.Parameters.AddWithValue(idempotencyKey);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonText(payload) });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddProfileParameters(NpgsqlCommand command, string id, string customerId, string accountId, string conversationId, double score, string color, HotChatProfileUpsertRequest input, string tags)
    {
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(customerId);
        command.Parameters.AddWithValue(accountId);
        command.Parameters.AddWithValue(conversationId);
        command.Parameters.AddWithValue(score);
        command.Parameters.AddWithValue(color);
        command.Parameters.AddWithValue(input.ConversationStage?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue((object?)input.LastProgressAt ?? DBNull.Value);
        command.Parameters.AddWithValue(input.NextTopic?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue(input.NoReplyReason?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue((object?)input.NextFollowupAt ?? DBNull.Value);
        command.Parameters.AddWithValue(input.ProfileSummary?.Trim() ?? string.Empty);
        command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = tags });
        command.Parameters.AddWithValue(input.ManualColorLocked ?? false);
    }

    private static bool TryGetCustomerValue(string fieldName, JsonElement value, out string result)
    {
        result = string.Empty;
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return false;
        if (value.ValueKind == JsonValueKind.Array)
        {
            result = string.Join(", ", value.EnumerateArray().Select(item => item.ToString()).Where(item => !string.IsNullOrWhiteSpace(item)));
            return result.Length > 0;
        }
        result = value.ToString().Trim();
        return result.Length > 0;
    }

    private static string NormalizeColor(string? color)
    {
        var normalized = color?.Trim().ToLowerInvariant() ?? "gray";
        return Colors.Contains(normalized) ? normalized : "gray";
    }

    private static string NormalizeTags(IReadOnlyList<string>? tags)
        => JsonSerializer.Serialize((tags ?? []).Select(item => item?.Trim() ?? string.Empty).Where(item => item.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(100).ToArray());

    private static IReadOnlyList<string> ParseTags(string json)
    {
        try { return JsonSerializer.Deserialize<string[]>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static string JsonText(object? value)
        => value is JsonElement element ? element.GetRawText() : JsonSerializer.Serialize(value ?? new { });

    private static bool JsonEquals(string left, string right)
    {
        try { return JsonDocument.Parse(left).RootElement.ToString() == JsonDocument.Parse(right).RootElement.ToString(); }
        catch (JsonException) { return string.Equals(left, right, StringComparison.Ordinal); }
    }

    private static string Require(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} is required", name);
        return value.Trim();
    }
}
