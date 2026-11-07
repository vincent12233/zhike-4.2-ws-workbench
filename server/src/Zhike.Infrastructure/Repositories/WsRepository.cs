using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Zhike.Domain.Messaging;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed class WsRepository(PostgresConnectionFactory connections)
{
    public async Task<IReadOnlyList<WsAccountRow>> ListAccountsAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT id, display_name, status, persisted_last_seen, runtime_status, updated_at FROM ws_accounts ORDER BY updated_at DESC, id", connection);
        var rows = new List<WsAccountRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new WsAccountRow(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3), reader.GetString(4), reader.GetFieldValue<DateTimeOffset>(5)));
        return rows;
    }

    public async Task<WsAccountRow?> UpsertAccountAsync(string id, string displayName, string status = "未连接", CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO ws_accounts(id, display_name, status, runtime_status, updated_at)
            VALUES ($1, $2, $3, $3, now())
            ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status, runtime_status = EXCLUDED.runtime_status, updated_at = now()
            """, connection);
        command.Parameters.AddWithValue(id.Trim());
        command.Parameters.AddWithValue(displayName?.Trim() ?? id.Trim());
        command.Parameters.AddWithValue(status?.Trim() ?? "未连接");
        await command.ExecuteNonQueryAsync(cancellationToken);
        return (await ListAccountsAsync(cancellationToken)).FirstOrDefault(item => item.Id == id.Trim());
    }

    public async Task<int> UpdateAccountStatusAsync(string id, string status, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("UPDATE ws_accounts SET status = $2, runtime_status = $2, persisted_last_seen = CASE WHEN $2 = '已连接' THEN now() ELSE persisted_last_seen END, updated_at = now() WHERE id = $1", connection);
        command.Parameters.AddWithValue(id.Trim());
        command.Parameters.AddWithValue(status.Trim());
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IngestResult> IngestAsync(MessageEnvelope envelope, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        var result = await IngestBatchAsync(
            envelope.AccountId,
            new[] { envelope },
            Array.Empty<WsCheckpointInput>(),
            cancellationToken);
        return new IngestResult(result.MessageIds[0], result.Deduplicated == 1, result.ConversationIds[0]);
    }

    public async Task<WsBatchIngestResult> IngestBatchAsync(
        string accountId,
        IReadOnlyList<MessageEnvelope> envelopes,
        IReadOnlyList<WsCheckpointInput> checkpoints,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(accountId)) throw new ArgumentException("accountId is required", nameof(accountId));
        var normalizedAccountId = accountId.Trim();
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var messageIds = new List<string>();
        var conversationIds = new List<string>();
        var deduplicated = 0;
        foreach (var envelope in envelopes ?? Array.Empty<MessageEnvelope>())
        {
            ArgumentNullException.ThrowIfNull(envelope);
            if (!string.Equals(envelope.AccountId?.Trim(), normalizedAccountId, StringComparison.Ordinal))
                throw new ArgumentException("batch account mismatch", nameof(envelopes));
            var result = await IngestCoreAsync(envelope, connection, transaction, cancellationToken);
            messageIds.Add(result.MessageId);
            conversationIds.Add(result.ConversationId);
            if (result.Deduplicated) deduplicated++;
        }
        foreach (var checkpoint in checkpoints ?? Array.Empty<WsCheckpointInput>())
        {
            if (!string.Equals(checkpoint.AccountId?.Trim(), normalizedAccountId, StringComparison.Ordinal))
                throw new ArgumentException("checkpoint account mismatch", nameof(checkpoints));
            await SaveCheckpointCoreAsync(checkpoint, connection, transaction, cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return new WsBatchIngestResult(messageIds.Count - deduplicated, deduplicated, messageIds, conversationIds);
    }

    private static async Task<IngestResult> IngestCoreAsync(
        MessageEnvelope envelope,
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(envelope.AccountId) || string.IsNullOrWhiteSpace(envelope.ConversationKey))
            throw new ArgumentException("WS account and conversation are required", nameof(envelope));

        var accountId = envelope.AccountId.Trim();
        var conversationKey = envelope.ConversationKey.Trim();
        var sentAt = envelope.SentAt?.ToUniversalTime() ?? envelope.ObservedAt.ToUniversalTime();
        var fingerprint = MessageFingerprint.Create(new MessageFingerprintInput(
            accountId, conversationKey, envelope.ExternalMessageId, envelope.Body, sentAt, envelope.Direction));
        var conversationId = $"conv-{ShortHash($"{accountId}\u001f{conversationKey}")}";
        var messageId = $"msg-{ShortHash(fingerprint)}";
        var observedAt = envelope.ObservedAt.ToUniversalTime();

        await EnsureAccountAndConversationAsync(connection, transaction, accountId, conversationKey, sentAt, cancellationToken);
        var inserted = false;
        await using (var message = new NpgsqlCommand("""
            INSERT INTO messages(id, account_id, conversation_id, external_message_id, fingerprint, direction, body, preview_only, sent_at, observed_at, raw_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (account_id, fingerprint) DO NOTHING
            RETURNING id
            """, connection, transaction))
        {
            message.Parameters.AddWithValue(messageId);
            message.Parameters.AddWithValue(accountId);
            message.Parameters.AddWithValue(conversationId);
            message.Parameters.AddWithValue(envelope.ExternalMessageId ?? string.Empty);
            message.Parameters.AddWithValue(fingerprint);
            message.Parameters.AddWithValue(envelope.Direction.Equals("outgoing", StringComparison.OrdinalIgnoreCase) ? "outgoing" : "incoming");
            message.Parameters.AddWithValue(envelope.Body ?? string.Empty);
            message.Parameters.AddWithValue(envelope.PreviewOnly);
            message.Parameters.AddWithValue(sentAt);
            message.Parameters.AddWithValue(observedAt);
            message.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { envelope.Cursor }) });
            inserted = await message.ExecuteScalarAsync(cancellationToken) is not null;
        }

        var actualMessageId = messageId;
        if (!inserted)
        {
            await using var existing = new NpgsqlCommand("SELECT id FROM messages WHERE account_id = $1 AND fingerprint = $2", connection, transaction);
            existing.Parameters.AddWithValue(accountId);
            existing.Parameters.AddWithValue(fingerprint);
            actualMessageId = Convert.ToString(await existing.ExecuteScalarAsync(cancellationToken)) ?? messageId;
        }
        else
        {
            var dedupeKey = $"ai.analysis:{accountId}:{fingerprint}";
            await using var ai = new NpgsqlCommand("""
                INSERT INTO ai_jobs(id, job_type, dedupe_key, payload)
                VALUES ($1, 'ai.analysis', $2, $3)
                ON CONFLICT (dedupe_key) DO NOTHING
                """, connection, transaction);
            ai.Parameters.AddWithValue($"job-{ShortHash(dedupeKey)}");
            ai.Parameters.AddWithValue(dedupeKey);
            ai.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { messageId = actualMessageId, conversationId, accountId, conversationKey, body = envelope.Body, sentAt }) });
            await ai.ExecuteNonQueryAsync(cancellationToken);

            await using var outbox = new NpgsqlCommand("""
                INSERT INTO sync_outbox(aggregate_type, aggregate_id, event_type, payload)
                VALUES ('message', $1, 'ai.analysis.requested', $2)
                ON CONFLICT DO NOTHING
                """, connection, transaction);
            outbox.Parameters.AddWithValue(actualMessageId);
            outbox.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { messageId = actualMessageId, conversationId, accountId }) });
            await outbox.ExecuteNonQueryAsync(cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(envelope.Cursor))
            await SaveCheckpointCoreAsync(new WsCheckpointInput(accountId, conversationKey, envelope.Cursor, fingerprint, observedAt), connection, transaction, cancellationToken);

        if (inserted) await AuditWriter.AppendAsync(connection, transaction, "ws", accountId, "ws.message.ingested", "message", actualMessageId, new { conversationId, fingerprint, direction = envelope.Direction }, cancellationToken);
        return new IngestResult(actualMessageId, !inserted, conversationId);
    }

    public async Task SaveCheckpointAsync(string accountId, string conversationKey, string cursor, string fingerprint, DateTimeOffset updatedAt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(accountId) || string.IsNullOrWhiteSpace(conversationKey))
            throw new ArgumentException("WS account and conversation are required");
        accountId = accountId.Trim();
        conversationKey = conversationKey.Trim();
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await SaveCheckpointCoreAsync(new WsCheckpointInput(accountId, conversationKey, cursor ?? string.Empty, fingerprint ?? string.Empty, updatedAt), connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task SaveCheckpointsBatchAsync(
        IReadOnlyList<WsCheckpointInput> checkpoints,
        CancellationToken cancellationToken = default)
    {
        var inputs = checkpoints ?? Array.Empty<WsCheckpointInput>();
        // Validate the complete batch before opening the transaction. This keeps
        // malformed rows from allowing any earlier account to be persisted.
        foreach (var checkpoint in inputs)
        {
            if (checkpoint is null || string.IsNullOrWhiteSpace(checkpoint.AccountId) || string.IsNullOrWhiteSpace(checkpoint.ConversationKey))
                throw new ArgumentException("WS account and conversation are required", nameof(checkpoints));
        }
        if (inputs.Count == 0) return;

        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        foreach (var checkpoint in inputs)
            await SaveCheckpointCoreAsync(checkpoint, connection, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task SaveCheckpointCoreAsync(
        WsCheckpointInput input,
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input.AccountId) || string.IsNullOrWhiteSpace(input.ConversationKey))
            throw new ArgumentException("WS account and conversation are required");
        var accountId = input.AccountId.Trim();
        var conversationKey = input.ConversationKey.Trim();
        var conversationId = $"conv-{ShortHash($"{accountId}\u001f{conversationKey}")}";
        await EnsureAccountAndConversationAsync(connection, transaction, accountId, conversationKey, null, cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO ws_checkpoints(account_id, conversation_id, cursor, last_message_fingerprint, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, conversation_id) DO UPDATE
            SET cursor = CASE
                WHEN EXCLUDED.updated_at < ws_checkpoints.updated_at THEN ws_checkpoints.cursor
                WHEN EXCLUDED.cursor ~ '^\d+$' AND ws_checkpoints.cursor ~ '^\d+$' AND EXCLUDED.cursor::numeric < ws_checkpoints.cursor::numeric THEN ws_checkpoints.cursor
                ELSE EXCLUDED.cursor END,
                last_message_fingerprint = CASE
                WHEN EXCLUDED.updated_at < ws_checkpoints.updated_at THEN ws_checkpoints.last_message_fingerprint
                WHEN EXCLUDED.cursor ~ '^\d+$' AND ws_checkpoints.cursor ~ '^\d+$' AND EXCLUDED.cursor::numeric < ws_checkpoints.cursor::numeric THEN ws_checkpoints.last_message_fingerprint
                ELSE EXCLUDED.last_message_fingerprint END,
                updated_at = GREATEST(ws_checkpoints.updated_at, EXCLUDED.updated_at)
            """, connection, transaction);
        command.Parameters.AddWithValue(accountId);
        command.Parameters.AddWithValue(conversationId);
        command.Parameters.AddWithValue(input.Cursor ?? string.Empty);
        command.Parameters.AddWithValue(input.LastMessageFingerprint ?? string.Empty);
        command.Parameters.AddWithValue((input.UpdatedAt == default ? DateTimeOffset.UtcNow : input.UpdatedAt).ToUniversalTime());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<FollowupRow>> GetFollowupsAsync(string? state, CancellationToken cancellationToken = default)
    {
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT id, customer_id, reason_key, title, detail, due_at, priority, state, source_message_id
            FROM followup_tasks
            WHERE ($1 IS NULL OR state = $1)
            ORDER BY due_at NULLS LAST, created_at DESC
            LIMIT 500
            """, connection);
        command.Parameters.AddWithValue((object?)state ?? DBNull.Value);
        var rows = new List<FollowupRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new FollowupRow(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5), reader.GetString(6), reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetString(8)));
        }
        return rows;
    }

    private static string ShortHash(string value) => MessageFingerprint.Create(new MessageFingerprintInput(value, string.Empty, string.Empty, string.Empty, DateTimeOffset.UnixEpoch, string.Empty))[..24];

    private static async Task EnsureAccountAndConversationAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string accountId, string conversationKey, DateTimeOffset? lastMessageAt, CancellationToken cancellationToken)
    {
        await using (var account = new NpgsqlCommand("INSERT INTO ws_accounts(id, display_name, status, runtime_status) VALUES ($1, $1, '未连接', '未连接') ON CONFLICT (id) DO NOTHING", connection, transaction))
        {
            account.Parameters.AddWithValue(accountId);
            await account.ExecuteNonQueryAsync(cancellationToken);
        }

        var conversationId = $"conv-{ShortHash($"{accountId}\u001f{conversationKey}")}";
        await using var conversation = new NpgsqlCommand("""
            INSERT INTO conversations(id, account_id, external_key, customer_id, last_message_at, updated_at)
            VALUES ($1, $2, $3,
                (SELECT i.customer_id FROM customer_identities i
                 JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
                 WHERE i.identity_type = 'phone' AND $3 LIKE 'phone:%' AND i.normalized_value = regexp_replace($3, '\D', '', 'g')
                 UNION ALL SELECT id FROM customers WHERE deleted_at IS NULL AND $3 LIKE 'phone:%' AND phone = regexp_replace($3, '\D', '', 'g') LIMIT 1),
                $4, now())
            ON CONFLICT (account_id, external_key) DO UPDATE
            SET customer_id = COALESCE(conversations.customer_id, EXCLUDED.customer_id),
                last_message_at = CASE WHEN EXCLUDED.last_message_at IS NULL THEN conversations.last_message_at ELSE GREATEST(COALESCE(conversations.last_message_at, EXCLUDED.last_message_at), EXCLUDED.last_message_at) END,
                updated_at = now()
            """, connection, transaction);
        conversation.Parameters.AddWithValue(conversationId);
        conversation.Parameters.AddWithValue(accountId);
        conversation.Parameters.AddWithValue(conversationKey);
        conversation.Parameters.AddWithValue((object?)lastMessageAt ?? DBNull.Value);
        await conversation.ExecuteNonQueryAsync(cancellationToken);
    }
}

public sealed record FollowupRow(
    string Id,
    string CustomerId,
    string ReasonKey,
    string Title,
    string Detail,
    DateTimeOffset? DueAt,
    string Priority,
    string State,
    string? SourceMessageId);

public sealed record WsAccountRow(string Id, string DisplayName, string Status, DateTimeOffset? LastSeen, string RuntimeStatus, DateTimeOffset UpdatedAt);
public sealed record WsCheckpointInput(string AccountId, string ConversationKey, string Cursor, string LastMessageFingerprint, DateTimeOffset UpdatedAt);
public sealed record WsBatchIngestResult(int Accepted, int Deduplicated, IReadOnlyList<string> MessageIds, IReadOnlyList<string> ConversationIds);
