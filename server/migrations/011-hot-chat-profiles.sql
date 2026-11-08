-- Hot-chat profile projection for the PostgreSQL companion store.
-- SQLite remains the offline source of truth; this schema is append-safe and
-- can be replayed by the sync worker without changing legacy customer fields.

CREATE TABLE IF NOT EXISTS hot_chat_profiles (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    completeness_score NUMERIC(6,5) NOT NULL DEFAULT 0 CHECK (completeness_score >= 0 AND completeness_score <= 1),
    status_color TEXT NOT NULL DEFAULT 'gray' CHECK (status_color IN ('green', 'blue', 'amber', 'red', 'gray')),
    conversation_stage TEXT NOT NULL DEFAULT '',
    last_progress_at TIMESTAMPTZ,
    next_topic TEXT NOT NULL DEFAULT '',
    no_reply_reason TEXT NOT NULL DEFAULT '',
    next_followup_at TIMESTAMPTZ,
    profile_summary TEXT NOT NULL DEFAULT '',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    manual_color_locked BOOLEAN NOT NULL DEFAULT false,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, account_id, conversation_id),
    UNIQUE (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_hot_chat_profiles_customer
    ON hot_chat_profiles(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profiles_account_color
    ON hot_chat_profiles(account_id, status_color, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profiles_followup
    ON hot_chat_profiles(next_followup_at) WHERE next_followup_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS hot_chat_profile_fields (
    id BIGSERIAL PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    value_json JSONB NOT NULL DEFAULT 'null'::jsonb,
    state TEXT NOT NULL DEFAULT 'missing' CHECK (state IN ('known', 'missing', 'pending', 'declined')),
    confidence NUMERIC(6,5) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
    -- References are intentionally soft: SQLite outbox may deliver the
    -- evidence before the message/analysis row reaches PostgreSQL.  The
    -- account/conversation scope still prevents cross-account attachment.
    source_message_id TEXT,
    source_quote TEXT NOT NULL DEFAULT '',
    analysis_id TEXT,
    last_asked_at TIMESTAMPTZ,
    manual_locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_hot_chat_profile_fields_state
    ON hot_chat_profile_fields(profile_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profile_fields_source
    ON hot_chat_profile_fields(source_message_id) WHERE source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hot_chat_events (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hot_chat_events_profile_time
    ON hot_chat_events(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hot_chat_events_conversation_time
    ON hot_chat_events(account_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hot_chat_sync_outbox (
    id BIGSERIAL PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
    aggregate_type TEXT NOT NULL DEFAULT 'hot_chat_profile',
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'succeeded', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (aggregate_type, aggregate_id, event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hot_chat_sync_outbox_claim
    ON hot_chat_sync_outbox(state, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_hot_chat_sync_outbox_profile
    ON hot_chat_sync_outbox(profile_id, created_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (11, '热聊客户档案、字段证据、事件和同步外盒')
ON CONFLICT (version) DO NOTHING;
