CREATE TABLE IF NOT EXISTS ai_analysis_results (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '',
    intent TEXT NOT NULL DEFAULT '',
    intent_score NUMERIC(6,3),
    emotion TEXT NOT NULL DEFAULT '',
    urgency TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    product_interest JSONB NOT NULL DEFAULT '[]'::jsonb,
    budget TEXT NOT NULL DEFAULT '',
    contact JSONB NOT NULL DEFAULT '{}'::jsonb,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(6,5) NOT NULL DEFAULT 0,
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id)
);

CREATE TABLE IF NOT EXISTS ai_field_observations (
    id BIGSERIAL PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES ai_analysis_results(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    field_name TEXT NOT NULL,
    value_json JSONB NOT NULL,
    confidence NUMERIC(6,5) NOT NULL DEFAULT 0,
    source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_conversation ON ai_analysis_results (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_observations_customer ON ai_field_observations (customer_id, status, created_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (6, 'AI分析结果、字段证据和冲突记录')
ON CONFLICT (version) DO NOTHING;
