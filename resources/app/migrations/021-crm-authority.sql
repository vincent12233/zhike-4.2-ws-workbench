-- 6.1 P0 CRM authority.
-- The partial unique index is deliberately active-record-only: recycle-bin
-- entries remain restorable and are checked by the application identity gate.
CREATE TABLE IF NOT EXISTS crm_identity_conflicts (
  id TEXT PRIMARY KEY,
  canonical_phone TEXT NOT NULL,
  customer_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_identity_conflicts_phone
  ON crm_identity_conflicts(canonical_phone,status,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_active
  ON customers(phone_normalized)
  WHERE deleted=0 AND phone_normalized<>'';
