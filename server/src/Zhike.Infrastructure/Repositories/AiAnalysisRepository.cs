using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Npgsql;
using NpgsqlTypes;
using Zhike.Contracts;
using Zhike.Infrastructure.Database;

namespace Zhike.Infrastructure.Repositories;

public sealed record AiFollowupInput(string ReasonKey, string Title, string Detail, DateTimeOffset? DueAt, string Priority);
public sealed record AiAnalysisInput(
    string Id,
    string JobId,
    string AccountId,
    string ConversationId,
    string? SourceMessageId,
    string? CustomerId,
    string Summary,
    string Intent,
    double? IntentScore,
    string Emotion,
    string Urgency,
    string Language,
    IReadOnlyList<string> ProductInterest,
    string Budget,
    JsonElement Contact,
    JsonElement Profile,
    double Confidence,
    JsonElement Raw,
    AiFollowupInput? Followup,
    IReadOnlyDictionary<string, AiProfileFact>? ProfileFacts = null,
    IReadOnlyList<string>? MissingFields = null,
    IReadOnlyList<string>? NaturalNextTopics = null,
    AiNoReplyAssessment? NoReply = null,
    AiReplySuggestion? ReplySuggestion = null,
    string CustomerTemperature = "",
    string StatusColor = "gray",
    bool AutoSyncAllowed = true);

public sealed record AiSyncResult(string? CustomerId, bool CustomerCreated, IReadOnlyList<string> AppliedFields, IReadOnlyList<string> Conflicts, bool FollowupCreated);

public sealed class AiAnalysisRepository(PostgresConnectionFactory connections)
{
    private static readonly string[] HotProfileFields =
    [
        "preferred_name", "age", "gender", "occupation", "work_context",
        "is_investor", "investment_years", "holdings", "investment_habits",
        "investment_preferences", "family_context", "life_interests", "future_plans",
    ];
    private const double MinimumConfidence = 0.60;

    public async Task<AiSyncResult> SaveAndSyncAsync(AiAnalysisInput input, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(input.JobId)) throw new ArgumentException("jobId is required", nameof(input));
        if (string.IsNullOrWhiteSpace(input.ConversationId)) throw new ArgumentException("conversationId is required", nameof(input));
        if (string.IsNullOrWhiteSpace(input.AccountId)) throw new ArgumentException("accountId is required", nameof(input));
        await using var connection = connections.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await ValidateConversationScopeAsync(connection, transaction, input.AccountId, input.ConversationId, cancellationToken);
        await using (var prior = new NpgsqlCommand("SELECT id FROM ai_analysis_results WHERE job_id = $1 LIMIT 1", connection, transaction))
        {
            prior.Parameters.AddWithValue(input.JobId);
            var existingId = await prior.ExecuteScalarAsync(cancellationToken);
            if (existingId is not null && existingId is not DBNull)
            {
                await transaction.CommitAsync(cancellationToken);
                return new AiSyncResult(null, false, [], [], false);
            }
        }
        var sourceMessageId = await ExistingMessageIdAsync(connection, transaction, input.AccountId, input.SourceMessageId, cancellationToken);
        var analysisId = input.Id;
        await using (var analysis = new NpgsqlCommand("""
            INSERT INTO ai_analysis_results(id, job_id, account_id, conversation_id, source_message_id, summary, intent, intent_score, emotion, urgency, language, product_interest, budget, contact, profile, confidence, raw_json)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (job_id) DO NOTHING
            RETURNING id
            """, connection, transaction))
        {
            analysis.Parameters.AddWithValue(input.Id);
            analysis.Parameters.AddWithValue(input.JobId);
            analysis.Parameters.AddWithValue(input.AccountId);
            analysis.Parameters.AddWithValue(input.ConversationId);
            analysis.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
            analysis.Parameters.AddWithValue(input.Summary ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Intent ?? string.Empty);
            analysis.Parameters.AddWithValue((object?)input.IntentScore ?? DBNull.Value);
            analysis.Parameters.AddWithValue(input.Emotion ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Urgency ?? string.Empty);
            analysis.Parameters.AddWithValue(input.Language ?? string.Empty);
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(input.ProductInterest ?? []) });
            analysis.Parameters.AddWithValue(input.Budget ?? string.Empty);
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Contact.ValueKind == JsonValueKind.Undefined ? "{}" : input.Contact.GetRawText() });
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Profile.ValueKind == JsonValueKind.Undefined ? "{}" : input.Profile.GetRawText() });
            analysis.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            analysis.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = input.Raw.ValueKind == JsonValueKind.Undefined ? "{}" : input.Raw.GetRawText() });
            var insertedId = await analysis.ExecuteScalarAsync(cancellationToken);
            if (insertedId is null || insertedId is DBNull)
            {
                await transaction.CommitAsync(cancellationToken);
                return new AiSyncResult(null, false, [], [], false);
            }
            analysisId = Convert.ToString(insertedId) ?? input.Id;
        }

        // A malformed/low-confidence response is retained as evidence only.
        // It must never create a customer, overwrite CRM values, or schedule a
        // follow-up reminder. The analysis row itself remains auditable.
        if (!input.AutoSyncAllowed || input.Confidence < MinimumConfidence)
        {
            await PersistPendingObservationsAsync(connection, transaction, analysisId, input, null, sourceMessageId, cancellationToken);
            await AuditWriter.AppendAsync(connection, transaction, "ai", input.AccountId, "ai.analysis.pending", "conversation", input.ConversationId, new { analysisId, confidence = input.Confidence }, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new AiSyncResult(null, false, [], [], false);
        }

        var contact = ObjectMap(input.Contact);
        var profile = ObjectMap(input.Profile);
        var phone = Digits(Value(contact, "phone", "number", "account"));
        var customerId = await ResolveCustomerAsync(input.CustomerId, input.ConversationId, phone, connection, transaction, cancellationToken);
        var created = false;
        if (string.IsNullOrWhiteSpace(customerId))
        {
            // A conversation is the stable fallback identity when AI cannot
            // extract a phone number. This prevents concurrent retries from
            // creating a new customer for every analysis of the same chat.
            customerId = $"cust-ws-{ShortHash($"{input.AccountId}\u001f{input.ConversationId}")}";
            await using var create = new NpgsqlCommand("INSERT INTO customers(id, name, phone, country, language, source, stage, intent_level, occupation, age, budget, product_interest, ai_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING", connection, transaction);
            create.Parameters.AddWithValue(customerId);
            create.Parameters.AddWithValue(Value(contact, "name", "customerName"));
            create.Parameters.AddWithValue(phone);
            create.Parameters.AddWithValue(Value(contact, "country", "countryCode"));
            create.Parameters.AddWithValue(input.Language ?? string.Empty);
            create.Parameters.AddWithValue(Value(profile, "origin", "source"));
            create.Parameters.AddWithValue(Value(profile, "customerStage", "stage"));
            create.Parameters.AddWithValue(input.Intent ?? string.Empty);
            create.Parameters.AddWithValue(Value(profile, "occupation", "job"));
            create.Parameters.AddWithValue(ParseAge(Value(profile, "age")) is int age ? age : DBNull.Value);
            create.Parameters.AddWithValue(input.Budget ?? string.Empty);
            create.Parameters.AddWithValue(string.Join(", ", input.ProductInterest ?? []));
            create.Parameters.AddWithValue(input.Summary ?? string.Empty);
            created = await create.ExecuteNonQueryAsync(cancellationToken) > 0;
        }

        if (!string.IsNullOrWhiteSpace(phone))
        {
            await using var identity = new NpgsqlCommand("""
                INSERT INTO customer_identities(customer_id, identity_type, normalized_value, raw_value, source, is_primary)
                VALUES ($1, 'phone', $2, $2, 'ai', true)
                ON CONFLICT (identity_type, normalized_value) DO NOTHING
                """, connection, transaction);
            identity.Parameters.AddWithValue(customerId);
            identity.Parameters.AddWithValue(phone);
            await identity.ExecuteNonQueryAsync(cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(input.ConversationId) && !string.IsNullOrWhiteSpace(customerId))
        {
            await using var link = new NpgsqlCommand("UPDATE conversations SET customer_id = COALESCE(customer_id, $2), updated_at = now() WHERE id = $1", connection, transaction);
            link.Parameters.AddWithValue(input.ConversationId);
            link.Parameters.AddWithValue(customerId);
            await link.ExecuteNonQueryAsync(cancellationToken);
        }

        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["name"] = Value(contact, "name", "customerName"),
            ["phone"] = phone,
            ["country"] = Value(contact, "country", "countryCode"),
            ["language"] = input.Language ?? string.Empty,
            ["source"] = Value(profile, "origin", "source"),
            ["stage"] = Value(profile, "customerStage", "stage"),
            ["intent_level"] = input.Intent ?? string.Empty,
            ["occupation"] = Value(profile, "occupation", "job"),
            ["age"] = ParseAge(Value(profile, "age"))?.ToString() ?? string.Empty,
            ["budget"] = input.Budget ?? string.Empty,
            ["product_interest"] = string.Join(", ", input.ProductInterest ?? []),
            ["ai_summary"] = input.Summary ?? string.Empty,
        };
        var applied = new List<string>();
        var conflicts = new List<string>();
        foreach (var field in fields.Where(item => !string.IsNullOrWhiteSpace(item.Value)))
        {
            var sql = field.Key.Equals("age", StringComparison.OrdinalIgnoreCase)
                ? "UPDATE customers SET age = CASE WHEN age IS NULL THEN NULLIF($2, '')::integer ELSE age END, updated_at = now() WHERE id = $1 RETURNING age"
                : $"UPDATE customers SET {field.Key} = CASE WHEN NULLIF(BTRIM({field.Key}), '') IS NULL THEN $2 ELSE {field.Key} END, updated_at = now() WHERE id = $1 RETURNING {field.Key}";
            await using var update = new NpgsqlCommand(sql, connection, transaction);
            update.Parameters.AddWithValue(customerId);
            update.Parameters.AddWithValue(field.Value);
            var existing = Convert.ToString(await update.ExecuteScalarAsync(cancellationToken)) ?? string.Empty;
            var status = string.Equals(existing, field.Value, StringComparison.Ordinal) ? "applied" : "conflict";
            if (status == "applied") applied.Add(field.Key);
            else conflicts.Add(field.Key);
            await using var evidence = new NpgsqlCommand("INSERT INTO ai_field_observations(analysis_id, customer_id, field_name, value_json, confidence, source_message_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (analysis_id, field_name) DO UPDATE SET value_json = EXCLUDED.value_json, confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = now()", connection, transaction);
            evidence.Parameters.AddWithValue(analysisId);
            evidence.Parameters.AddWithValue(customerId);
            evidence.Parameters.AddWithValue(field.Key);
            evidence.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(field.Value) });
            evidence.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            evidence.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
            evidence.Parameters.AddWithValue(status);
            await evidence.ExecuteNonQueryAsync(cancellationToken);
        }

        await UpsertHotChatProfileAsync(connection, transaction, input, analysisId, customerId, sourceMessageId, cancellationToken);

        var followupCreated = false;
        if (input.Followup is not null && !string.IsNullOrWhiteSpace(input.Followup.ReasonKey))
        {
            var reasonKey = input.Followup.ReasonKey.Trim();
            // Cooldown applies only to still-open/recent reminders. A completed
            // or old reminder must not suppress a later natural follow-up.
            await using var recent = new NpgsqlCommand("SELECT 1 FROM followup_tasks WHERE customer_id=$1 AND reason_key=$2 AND state IN ('pending','notified') AND (due_at IS NULL OR due_at >= now() - interval '3 days') LIMIT 1", connection, transaction);
            recent.Parameters.AddWithValue(customerId);
            recent.Parameters.AddWithValue(reasonKey);
            var inCooldown = await recent.ExecuteScalarAsync(cancellationToken) is not null;
            if (!inCooldown)
            {
                var dedupe = $"{customerId}:{reasonKey}:{DateTimeOffset.UtcNow:yyyyMMdd}:{analysisId}";
                await using var followup = new NpgsqlCommand("""
                    INSERT INTO followup_tasks(id, customer_id, reason_key, title, detail, due_at, priority, source_message_id, dedupe_key)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    ON CONFLICT (dedupe_key) DO NOTHING
                    """, connection, transaction);
                followup.Parameters.AddWithValue($"followup-{Guid.NewGuid():N}");
                followup.Parameters.AddWithValue(customerId);
                followup.Parameters.AddWithValue(SafeText(reasonKey));
                followup.Parameters.AddWithValue(SafeText(input.Followup.Title));
                followup.Parameters.AddWithValue(SafeText(input.Followup.Detail));
                followup.Parameters.AddWithValue((object?)input.Followup.DueAt ?? DBNull.Value);
                followup.Parameters.AddWithValue(input.Followup.Priority ?? "normal");
                followup.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
                followup.Parameters.AddWithValue(dedupe);
                followupCreated = await followup.ExecuteNonQueryAsync(cancellationToken) > 0;
            }
        }
        await AuditWriter.AppendAsync(connection, transaction, "ai", input.AccountId, "ai.analysis.synced", "customer", customerId, new { analysisId, input.JobId, applied, conflicts, followupCreated }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AiSyncResult(customerId, created, applied, conflicts, followupCreated);
    }

    private static async Task UpsertHotChatProfileAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        AiAnalysisInput input,
        string analysisId,
        string customerId,
        string? sourceMessageId,
        CancellationToken cancellationToken)
    {
        var profileId = $"hcpf-{ShortHash($"{customerId}\u001f{input.AccountId}\u001f{input.ConversationId}")}";
        var existingColor = "gray";
        var existingColorLocked = false;
        await using (var scope = new NpgsqlCommand("SELECT customer_id, status_color, manual_color_locked FROM hot_chat_profiles WHERE account_id = $1 AND conversation_id = $2 LIMIT 1", connection, transaction))
        {
            scope.Parameters.AddWithValue(input.AccountId);
            scope.Parameters.AddWithValue(input.ConversationId);
            await using var scopeReader = await scope.ExecuteReaderAsync(cancellationToken);
            if (await scopeReader.ReadAsync(cancellationToken))
            {
                var linked = scopeReader.IsDBNull(0) ? string.Empty : scopeReader.GetString(0);
                if (!string.IsNullOrWhiteSpace(linked) && !string.Equals(linked, customerId, StringComparison.Ordinal))
                    throw new InvalidOperationException("WS 会话已绑定其他客户，拒绝跨客户写入。");
                existingColor = scopeReader.IsDBNull(1) ? "gray" : scopeReader.GetString(1);
                existingColorLocked = !scopeReader.IsDBNull(2) && scopeReader.GetBoolean(2);
            }
        }
        await using (var profile = new NpgsqlCommand("""
            INSERT INTO hot_chat_profiles(id, customer_id, account_id, conversation_id, completeness_score, status_color, conversation_stage, last_progress_at, next_topic, no_reply_reason, next_followup_at, profile_summary, tags, version)
            VALUES ($1,$2,$3,$4,0,$5,$6,now(),$7,$8,$9,$10,'[]'::jsonb,1)
            ON CONFLICT (account_id, conversation_id) DO UPDATE SET updated_at = now()
            RETURNING id
            """, connection, transaction))
        {
            profile.Parameters.AddWithValue(profileId);
            profile.Parameters.AddWithValue(customerId);
            profile.Parameters.AddWithValue(input.AccountId);
            profile.Parameters.AddWithValue(input.ConversationId);
            profile.Parameters.AddWithValue(existingColorLocked ? existingColor : NormalizeColor(input.StatusColor));
            profile.Parameters.AddWithValue(Value(ObjectMap(input.Profile), "customerStage", "stage"));
            profile.Parameters.AddWithValue((input.NaturalNextTopics ?? []).FirstOrDefault() ?? string.Empty);
            profile.Parameters.AddWithValue(input.NoReply?.Reason ?? string.Empty);
            profile.Parameters.AddWithValue((object?)input.Followup?.DueAt ?? (object?)input.NoReply?.SuggestedAt ?? DBNull.Value);
            profile.Parameters.AddWithValue(SafeText(input.Summary));
            profileId = Convert.ToString(await profile.ExecuteScalarAsync(cancellationToken)) ?? profileId;
        }

        foreach (var field in (input.ProfileFacts ?? new Dictionary<string, AiProfileFact>()).Values.Where(item => HotProfileFields.Contains(item.Field, StringComparer.OrdinalIgnoreCase)))
        {
            var state = field.State is "known" or "missing" or "pending" or "declined" ? field.State : "pending";
            var confidence = Math.Clamp(field.Confidence, 0, 1);
            if (state == "known" && (confidence < MinimumConfidence || string.IsNullOrWhiteSpace(field.Evidence))) state = "pending";
            await using var current = new NpgsqlCommand("SELECT value_json, state, manual_locked FROM hot_chat_profile_fields WHERE profile_id = $1 AND field_name = $2", connection, transaction);
            current.Parameters.AddWithValue(profileId);
            current.Parameters.AddWithValue(field.Field);
            string? currentJson = null;
            var currentState = "missing";
            var manualLocked = false;
            await using (var reader = await current.ExecuteReaderAsync(cancellationToken))
            {
                if (await reader.ReadAsync(cancellationToken))
                {
                    currentJson = reader.IsDBNull(0) ? null : reader.GetString(0);
                    currentState = reader.IsDBNull(1) ? "missing" : reader.GetString(1);
                    manualLocked = !reader.IsDBNull(2) && reader.GetBoolean(2);
                }
            }
            var incomingJson = field.Value.ValueKind == JsonValueKind.Undefined ? "null" : field.Value.GetRawText();
            var hasCurrent = !string.IsNullOrWhiteSpace(currentJson) && currentJson != "null" && currentJson != "\"\"";
            var conflict = hasCurrent && !string.Equals(currentJson, incomingJson, StringComparison.Ordinal);
            var nextJson = manualLocked || conflict ? (currentJson ?? "null") : incomingJson;
            var nextState = manualLocked ? currentState : conflict ? "pending" : state;
            var sourceQuote = SafeText(field.Evidence);
            await using var upsert = new NpgsqlCommand("""
                INSERT INTO hot_chat_profile_fields(profile_id, field_name, value_json, state, confidence, source_message_id, source_quote, analysis_id, manual_locked)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
                ON CONFLICT (profile_id, field_name) DO UPDATE SET
                    value_json = CASE WHEN hot_chat_profile_fields.manual_locked THEN hot_chat_profile_fields.value_json ELSE EXCLUDED.value_json END,
                    state = CASE WHEN hot_chat_profile_fields.manual_locked THEN hot_chat_profile_fields.state ELSE EXCLUDED.state END,
                    confidence = CASE WHEN hot_chat_profile_fields.manual_locked THEN hot_chat_profile_fields.confidence ELSE EXCLUDED.confidence END,
                    source_message_id = EXCLUDED.source_message_id,
                    source_quote = EXCLUDED.source_quote,
                    analysis_id = EXCLUDED.analysis_id,
                    updated_at = now()
                """, connection, transaction);
            upsert.Parameters.AddWithValue(profileId);
            upsert.Parameters.AddWithValue(field.Field);
            upsert.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = nextJson });
            upsert.Parameters.AddWithValue(nextState);
            upsert.Parameters.AddWithValue(confidence);
            upsert.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
            upsert.Parameters.AddWithValue(sourceQuote);
            upsert.Parameters.AddWithValue(analysisId);
            await upsert.ExecuteNonQueryAsync(cancellationToken);

            await using var observation = new NpgsqlCommand("""
                INSERT INTO ai_field_observations(analysis_id, customer_id, field_name, value_json, confidence, source_message_id, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (analysis_id, field_name) DO UPDATE SET value_json=EXCLUDED.value_json, confidence=EXCLUDED.confidence, source_message_id=EXCLUDED.source_message_id, status=EXCLUDED.status, updated_at=now()
                """, connection, transaction);
            observation.Parameters.AddWithValue(analysisId);
            observation.Parameters.AddWithValue(customerId);
            observation.Parameters.AddWithValue(field.Field);
            observation.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = incomingJson });
            observation.Parameters.AddWithValue(confidence);
            observation.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
            observation.Parameters.AddWithValue(nextState);
            await observation.ExecuteNonQueryAsync(cancellationToken);
        }

        var completeness = await ReadCompletenessAsync(connection, transaction, profileId, cancellationToken);
        await using (var update = new NpgsqlCommand("UPDATE hot_chat_profiles SET completeness_score=$2, status_color=CASE WHEN manual_color_locked THEN status_color ELSE $3 END, conversation_stage=$4, last_progress_at=now(), next_topic=$5, no_reply_reason=$6, next_followup_at=$7, profile_summary=$8, version=version+1, updated_at=now() WHERE id=$1", connection, transaction))
        {
            update.Parameters.AddWithValue(profileId);
            update.Parameters.AddWithValue(completeness);
            update.Parameters.AddWithValue(NormalizeColor(input.StatusColor));
            update.Parameters.AddWithValue(Value(ObjectMap(input.Profile), "customerStage", "stage"));
            update.Parameters.AddWithValue((input.NaturalNextTopics ?? []).FirstOrDefault() ?? string.Empty);
            update.Parameters.AddWithValue(input.NoReply?.Reason ?? string.Empty);
            update.Parameters.AddWithValue((object?)input.Followup?.DueAt ?? (object?)input.NoReply?.SuggestedAt ?? DBNull.Value);
            update.Parameters.AddWithValue(SafeText(input.Summary));
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        var eventKey = $"analysis:{analysisId}";
        var eventId = $"hce-{ShortHash($"{profileId}\u001f{eventKey}")}";
        var replySuggestion = input.ReplySuggestion is null
            ? null
            : input.ReplySuggestion with { Text = SafeText(input.ReplySuggestion.Text), RequiresConfirmation = true };
        await using (var eventCommand = new NpgsqlCommand("""
            INSERT INTO hot_chat_events(id, profile_id, account_id, conversation_id, event_type, actor_type, idempotency_key, payload)
            VALUES ($1,$2,$3,$4,'analysis_profile','ai',$5,$6)
            ON CONFLICT (profile_id, idempotency_key) DO NOTHING
            """, connection, transaction))
        {
            eventCommand.Parameters.AddWithValue(eventId);
            eventCommand.Parameters.AddWithValue(profileId);
            eventCommand.Parameters.AddWithValue(input.AccountId);
            eventCommand.Parameters.AddWithValue(input.ConversationId);
            eventCommand.Parameters.AddWithValue(eventKey);
            eventCommand.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { analysisId, missingFields = input.MissingFields ?? [], nextTopics = input.NaturalNextTopics ?? [], noReply = input.NoReply, replySuggestion }) });
            var inserted = await eventCommand.ExecuteNonQueryAsync(cancellationToken);
            if (inserted > 0)
            {
                await using var outbox = new NpgsqlCommand("""
                    INSERT INTO hot_chat_sync_outbox(profile_id, aggregate_id, event_type, idempotency_key, payload)
                    VALUES ($1,$2,'hot_chat.profile.updated',$3,$4)
                    ON CONFLICT (aggregate_type, aggregate_id, event_type, idempotency_key) DO NOTHING
                    """, connection, transaction);
                outbox.Parameters.AddWithValue(profileId);
                outbox.Parameters.AddWithValue(customerId);
                outbox.Parameters.AddWithValue(eventKey);
                outbox.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = JsonSerializer.Serialize(new { profileId, customerId, accountId = input.AccountId, conversationId = input.ConversationId, analysisId }) });
                await outbox.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    private static async Task<string?> ExistingMessageIdAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string accountId, string? sourceMessageId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sourceMessageId)) return null;
        await using var command = new NpgsqlCommand("SELECT id FROM messages WHERE id = $1 AND account_id = $2 LIMIT 1", connection, transaction);
        command.Parameters.AddWithValue(sourceMessageId);
        command.Parameters.AddWithValue(accountId);
        return Convert.ToString(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task<double> ReadCompletenessAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string profileId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT COALESCE(SUM(CASE WHEN state = 'known' THEN 1 ELSE 0 END)::numeric / NULLIF($2,0),0) FROM hot_chat_profile_fields WHERE profile_id = $1", connection, transaction);
        command.Parameters.AddWithValue(profileId);
        command.Parameters.AddWithValue(HotProfileFields.Length);
        return Convert.ToDouble(await command.ExecuteScalarAsync(cancellationToken) ?? 0d);
    }

    private static async Task PersistPendingObservationsAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string analysisId, AiAnalysisInput input, string? customerId, string? sourceMessageId, CancellationToken cancellationToken)
    {
        var observations = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var contact = ObjectMap(input.Contact);
        var profile = ObjectMap(input.Profile);
        foreach (var field in new[]
        {
            ("name", Value(contact, "name", "customerName")),
            ("phone", Digits(Value(contact, "phone", "number", "account"))),
            ("country", Value(contact, "country", "countryCode")),
            ("language", input.Language),
            ("source", Value(profile, "origin", "source")),
            ("stage", Value(profile, "customerStage", "stage")),
            ("intent_level", input.Intent),
            ("occupation", Value(profile, "occupation", "job")),
            ("age", ParseAge(Value(profile, "age"))?.ToString() ?? string.Empty),
            ("budget", input.Budget),
            ("product_interest", string.Join(", ", input.ProductInterest ?? [])),
            ("ai_summary", input.Summary),
        }) if (!string.IsNullOrWhiteSpace(field.Item2)) observations[field.Item1] = SafeText(field.Item2);
        foreach (var fact in (input.ProfileFacts ?? new Dictionary<string, AiProfileFact>()).Values)
        {
            if (fact.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
            observations[fact.Field] = JsonSerializer.Serialize(SafeText(fact.Value.ToString()));
        }
        foreach (var observation in observations)
        {
            await using var command = new NpgsqlCommand("""
                INSERT INTO ai_field_observations(analysis_id, customer_id, field_name, value_json, confidence, source_message_id, status)
                VALUES ($1,$2,$3,$4,$5,$6,'pending')
                ON CONFLICT (analysis_id, field_name) DO UPDATE SET value_json=EXCLUDED.value_json, confidence=EXCLUDED.confidence, status='pending', updated_at=now()
                """, connection, transaction);
            command.Parameters.AddWithValue(analysisId);
            command.Parameters.AddWithValue((object?)customerId ?? DBNull.Value);
            command.Parameters.AddWithValue(observation.Key);
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = observation.Value });
            command.Parameters.AddWithValue(Math.Clamp(input.Confidence, 0, 1));
            command.Parameters.AddWithValue((object?)sourceMessageId ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<string?> ResolveCustomerAsync(string? explicitId, string conversationId, string phone, NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using (var conversationLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('conversation:' || $1, 0))", connection, transaction))
        {
            conversationLock.Parameters.AddWithValue(conversationId);
            await conversationLock.ExecuteNonQueryAsync(cancellationToken);
        }
        if (!string.IsNullOrWhiteSpace(phone))
        {
            await using var lockCommand = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended('phone:' || $1, 0))", connection, transaction);
            lockCommand.Parameters.AddWithValue(phone);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        // Stable precedence: conversation link → explicit customer id → phone.
        // Every lookup is active-customer scoped; no UNION/LIMIT race can leak a
        // different account's customer into this conversation.
        await using (var linked = new NpgsqlCommand("SELECT customer_id FROM conversations WHERE id=$1 AND customer_id IS NOT NULL LIMIT 1", connection, transaction))
        {
            linked.Parameters.AddWithValue(conversationId);
            var id = Convert.ToString(await linked.ExecuteScalarAsync(cancellationToken));
            if (!string.IsNullOrWhiteSpace(id))
            {
                var active = await ActiveCustomerIdAsync(id, connection, transaction, cancellationToken);
                if (string.IsNullOrWhiteSpace(active)) throw new InvalidOperationException("WS 会话已绑定回收客户，拒绝自动改绑。");
                return active;
            }
        }
        if (!string.IsNullOrWhiteSpace(explicitId))
        {
            var explicitCustomer = await ActiveCustomerIdAsync(explicitId.Trim(), connection, transaction, cancellationToken);
            if (!string.IsNullOrWhiteSpace(explicitCustomer)) return explicitCustomer;
            throw new InvalidOperationException("AI 提供的客户编号不存在或已回收，拒绝创建替代客户。");
        }
        if (!string.IsNullOrWhiteSpace(phone))
        {
            await using var identity = new NpgsqlCommand("SELECT customer_id FROM customer_identities i JOIN customers c ON c.id=i.customer_id AND c.deleted_at IS NULL WHERE i.identity_type='phone' AND i.normalized_value=$1 ORDER BY i.is_primary DESC, i.customer_id LIMIT 2", connection, transaction);
            identity.Parameters.AddWithValue(phone);
            var candidates = new List<string>();
            await using var reader = await identity.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) candidates.Add(reader.GetString(0));
            await reader.DisposeAsync();
            if (candidates.Count > 1) throw new InvalidOperationException("电话号码匹配到多个客户，未自动合并。");
            if (candidates.Count == 1) return candidates[0];
            await using var byPhone = new NpgsqlCommand("SELECT id FROM customers WHERE deleted_at IS NULL AND regexp_replace(phone, '\\D', '', 'g')=$1 ORDER BY id LIMIT 2", connection, transaction);
            byPhone.Parameters.AddWithValue(phone);
            var phoneCandidates = new List<string>();
            await using var phoneReader = await byPhone.ExecuteReaderAsync(cancellationToken);
            while (await phoneReader.ReadAsync(cancellationToken)) phoneCandidates.Add(phoneReader.GetString(0));
            await phoneReader.DisposeAsync();
            if (phoneCandidates.Count > 1) throw new InvalidOperationException("电话号码匹配到多个客户，未自动合并。");
            return phoneCandidates.FirstOrDefault();
        }
        return null;
    }

    private static async Task<string?> ActiveCustomerIdAsync(string id, NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL LIMIT 1", connection, transaction);
        command.Parameters.AddWithValue(id);
        return Convert.ToString(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task ValidateConversationScopeAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string accountId, string conversationId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT 1 FROM conversations WHERE id=$1 AND account_id=$2 LIMIT 1", connection, transaction);
        command.Parameters.AddWithValue(conversationId);
        command.Parameters.AddWithValue(accountId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
            throw new InvalidOperationException("WS 会话不属于当前账号或不存在，拒绝 AI 同步。");
    }

    private static Dictionary<string, string> ObjectMap(JsonElement element)
        => element.ValueKind == JsonValueKind.Object ? element.EnumerateObject().ToDictionary(item => item.Name, item => item.Value.ToString(), StringComparer.OrdinalIgnoreCase) : new(StringComparer.OrdinalIgnoreCase);

    private static string Value(IReadOnlyDictionary<string, string> map, params string[] keys)
        => keys.Select(key => map.TryGetValue(key, out var value) ? value : string.Empty).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty;

    private static string Digits(string value) => new(value.Where(char.IsDigit).ToArray());
    private static int? ParseAge(string value) => int.TryParse(value, out var age) && age is >= 0 and <= 120 ? age : null;
    private static string SafeText(string? value)
    {
        var text = value?.Trim() ?? string.Empty;
        if (text.Length == 0) return text;
        text = System.Text.RegularExpressions.Regex.Replace(text, "(?i)(password|passcode|token|cookie|secret|验证码|校验码|密码|银行卡(?:号)?|收款码|二维码|身份证(?:号)?|护照(?:号)?)\\s*[:：]?\\s*[^\\s，。；;]+", "[已脱敏]");
        return text.Length > 4000 ? text[..4000] : text;
    }
    private static string NormalizeColor(string? value) => value is "green" or "blue" or "amber" or "red" or "gray" ? value! : "gray";
    private static string ShortHash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty))).ToLowerInvariant()[..24];
}
