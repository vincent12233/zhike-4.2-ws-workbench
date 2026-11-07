CREATE TABLE IF NOT EXISTS business_records (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    record_type TEXT NOT NULL,
    product_code TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT '',
    registered_at DATE,
    next_followup_at DATE,
    channel TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    vip_code TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    business_key TEXT NOT NULL UNIQUE,
    source_batch_id TEXT NOT NULL DEFAULT '',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'preview',
    row_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_rows (
    id BIGSERIAL PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    raw_json JSONB NOT NULL,
    classified_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(6,5),
    state TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NOT NULL DEFAULT '',
    UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_business_customer ON business_records (customer_id, record_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_business_product_direction_date ON business_records (product_code, direction, registered_at);
CREATE INDEX IF NOT EXISTS idx_business_followup ON business_records (next_followup_at, status);

INSERT INTO schema_migrations(version, description)
VALUES (3, '业务记录、导入批次和日期字段分离')
ON CONFLICT (version) DO NOTHING;

