CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_name TEXT PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_worker_heartbeats_last_seen
    ON worker_heartbeats(last_seen_at);

INSERT INTO schema_migrations(version, description)
VALUES (9, 'Worker liveness heartbeats')
ON CONFLICT (version) DO NOTHING;
