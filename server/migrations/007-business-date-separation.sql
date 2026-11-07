ALTER TABLE business_records ADD COLUMN IF NOT EXISTS business_date DATE;
CREATE INDEX IF NOT EXISTS idx_business_business_date ON business_records (business_date, record_type, direction);

INSERT INTO schema_migrations(version, description)
VALUES (7, '登记日期、业务日期和下次跟进日期完全分离')
ON CONFLICT (version) DO NOTHING;
