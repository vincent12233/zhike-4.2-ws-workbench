CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE business_records
    ADD COLUMN IF NOT EXISTS trade_ref TEXT NOT NULL DEFAULT '';

ALTER TABLE import_batches
    ADD COLUMN IF NOT EXISTS duplicate_of TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
    ON customers USING GIN (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
    ON customers USING GIN (phone gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_source_trgm
    ON customers USING GIN (source gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_product_interest_trgm
    ON customers USING GIN (product_interest gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_trade_ref
    ON business_records (customer_id, trade_ref) WHERE trade_ref <> '' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_import_batches_source_hash
    ON import_batches (source_hash, created_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (13, '客户模糊搜索、重复导入提示和跟票交易流水')
ON CONFLICT (version) DO NOTHING;
