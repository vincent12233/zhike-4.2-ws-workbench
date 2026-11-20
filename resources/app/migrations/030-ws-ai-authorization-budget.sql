CREATE TABLE ws_ai_authorizations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  consent_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('active','paused','revoked')),
  budget_micros INTEGER NOT NULL CHECK(budget_micros > 0),
  reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros >= 0),
  runtime_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_ws_ai_authorizations_current ON ws_ai_authorizations(account_id) WHERE status <> 'revoked';
CREATE UNIQUE INDEX idx_ws_ai_authorizations_consent ON ws_ai_authorizations(account_id,consent_key);
CREATE TABLE ws_ai_budget_attempts (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES ws_ai_authorizations(id),
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  lease_hash TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL CHECK(reserved_micros > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved','dispatched','completed','unknown','failed')),
  usage_json TEXT NOT NULL DEFAULT '{}',
  result_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,lease_hash),
  UNIQUE(authorization_id,conversation_id,source_fingerprint)
);
CREATE INDEX idx_ws_ai_budget_attempts_account ON ws_ai_budget_attempts(account_id,created_at,id);
CREATE TABLE ws_ai_authorization_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ws_ai_authorization_audit_account ON ws_ai_authorization_audit(account_id,created_at,id);
CREATE TABLE ws_ai_price_verifications (
  id TEXT PRIMARY KEY CHECK(id='current'),
  quote_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
