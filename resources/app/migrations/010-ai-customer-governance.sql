CREATE TABLE IF NOT EXISTS ai_customer_field_evidence (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  analysis_id TEXT NOT NULL DEFAULT '',
  field_name TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  confidence REAL NOT NULL DEFAULT 0,
  source_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','conflict','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(customer_id, analysis_id, field_name)
);
CREATE INDEX IF NOT EXISTS idx_ai_customer_evidence_customer ON ai_customer_field_evidence(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_customer_evidence_status ON ai_customer_field_evidence(status,updated_at);

CREATE TABLE IF NOT EXISTS customer_governance_actions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','restore','soft_delete','purge')),
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  analysis_id TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_governance_customer ON customer_governance_actions(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_customer_governance_action ON customer_governance_actions(action,created_at);

CREATE TABLE IF NOT EXISTS customer_delete_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('soft','purge')),
  confirmation_token_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','expired','cancelled')),
  requested_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_delete_token ON customer_delete_requests(confirmation_token_hash) WHERE confirmation_token_hash <> '';
CREATE INDEX IF NOT EXISTS idx_customer_delete_customer ON customer_delete_requests(customer_id,status,created_at);
