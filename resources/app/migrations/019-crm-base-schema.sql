-- 6.1 P0 base CRM schema. Existing installations already have these tables;
-- CREATE IF NOT EXISTS keeps the migration idempotent while moving the
-- schema authority into the versioned runner.
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS state_snapshots (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone_normalized TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  assistant TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_source_assistant ON customers(source, assistant);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted);
