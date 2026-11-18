-- 6.1 P0 AI queue authority.
-- The legacy table is retained by name and all historical columns are
-- preserved. The runner adds lease_token for an older table that predates it.
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL,
  locked_at TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  analysis_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_claim ON ai_jobs(account_id,status,next_attempt_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_conversation ON ai_jobs(account_id,conversation_id,created_at);
