CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_records (
    id BIGSERIAL PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_json JSONB NOT NULL,
    source_hash TEXT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_table, source_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_aggregate ON audit_events (aggregate_type, aggregate_id, created_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (1, '基础迁移、旧记录快照和审计事件')
ON CONFLICT (version) DO NOTHING;

