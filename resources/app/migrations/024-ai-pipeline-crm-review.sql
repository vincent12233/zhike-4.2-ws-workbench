-- 6.1 Stage 4 isolated AI pipeline and CRM review boundary.
-- This migration is additive. The legacy ai_jobs and ws_ai_analyses tables
-- remain authoritative for historical data and compatibility reads.

ALTER TABLE ai_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'ws.ai.analysis';
ALTER TABLE ai_jobs ADD COLUMN customer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN group_jid TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN source_message_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN source_event_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'conversation';
ALTER TABLE ai_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 50;
ALTER TABLE ai_jobs ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_jobs ADD COLUMN result_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_jobs ADD COLUMN worker_owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ai_jobs_pipeline_claim
  ON ai_jobs(account_id,status,priority,next_attempt_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pipeline_customer
  ON ai_jobs(account_id,customer_id,created_at);

CREATE TABLE IF NOT EXISTS ai_crm_suggestions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  customer_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  group_jid TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL DEFAULT '',
  analysis_id TEXT NOT NULL DEFAULT '',
  field_name TEXT NOT NULL,
  candidate_value_json TEXT NOT NULL DEFAULT 'null',
  existing_value_json TEXT NOT NULL DEFAULT 'null',
  applied_value_json TEXT NOT NULL DEFAULT 'null',
  source_evidence TEXT NOT NULL DEFAULT '',
  source_message_id TEXT NOT NULL DEFAULT '',
  source_at TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','approved','rejected','conflict','applied')),
  conflict_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_crm_suggestions_review
  ON ai_crm_suggestions(account_id,verification_status,updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_crm_suggestions_customer
  ON ai_crm_suggestions(account_id,customer_id,updated_at);

CREATE TABLE IF NOT EXISTS ai_job_evidence (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  job_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'message',
  source_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  group_jid TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(account_id,job_id,source_type,source_id,quote)
);
CREATE INDEX IF NOT EXISTS idx_ai_job_evidence_job
  ON ai_job_evidence(account_id,job_id,created_at);

CREATE TABLE IF NOT EXISTS ai_task_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  job_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_task_audit_job
  ON ai_task_audit(account_id,job_id,created_at);
