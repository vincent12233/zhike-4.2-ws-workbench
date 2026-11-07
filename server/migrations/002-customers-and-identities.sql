CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    intent_level TEXT NOT NULL DEFAULT '',
    occupation TEXT NOT NULL DEFAULT '',
    age INTEGER,
    budget TEXT NOT NULL DEFAULT '',
    product_interest TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    ai_summary TEXT NOT NULL DEFAULT '',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_identities (
    id BIGSERIAL PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    identity_type TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    raw_value TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (identity_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers (deleted_at);
CREATE INDEX IF NOT EXISTS idx_customer_identities_customer ON customer_identities (customer_id);

INSERT INTO schema_migrations(version, description)
VALUES (2, '客户主档和多身份匹配')
ON CONFLICT (version) DO NOTHING;

