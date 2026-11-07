CREATE TABLE IF NOT EXISTS ws_accounts (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '未连接',
    persisted_last_seen TIMESTAMPTZ,
    runtime_status TEXT NOT NULL DEFAULT '未连接',
    profile_ref TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
    external_key TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, external_key)
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    external_message_id TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'incoming',
    body TEXT NOT NULL DEFAULT '',
    translated_body TEXT NOT NULL DEFAULT '',
    preview_only BOOLEAN NOT NULL DEFAULT false,
    sent_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (account_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS ws_checkpoints (
    account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    cursor TEXT NOT NULL DEFAULT '',
    last_message_fingerprint TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_account_observed ON messages (account_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_account_last ON conversations (account_id, last_message_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (4, 'WS账号、会话、消息和断点')
ON CONFLICT (version) DO NOTHING;

