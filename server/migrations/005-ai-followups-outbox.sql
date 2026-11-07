CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS followup_tasks (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reason_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'normal',
    state TEXT NOT NULL DEFAULT 'pending',
    source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_outbox (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_claim ON ai_jobs (state, available_at);
CREATE INDEX IF NOT EXISTS idx_followup_due ON followup_tasks (state, due_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_claim ON sync_outbox (state, available_at);

INSERT INTO schema_migrations(version, description)
VALUES (5, 'AI任务、跟进提醒和事务消息外盒')
ON CONFLICT (version) DO NOTHING;

