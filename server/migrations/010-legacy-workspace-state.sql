CREATE TABLE IF NOT EXISTS legacy_workspace_state (
    owner_id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy_workspace_snapshots (
    id BIGSERIAL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL DEFAULT '',
    state JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_legacy_workspace_snapshots_owner_created
    ON legacy_workspace_snapshots(owner_id, created_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (10, 'WebView2 原版页面 Postgres 兼容状态与快照')
ON CONFLICT (version) DO NOTHING;
