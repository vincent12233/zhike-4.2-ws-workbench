-- 6.1 Stage 5 business-link correlation boundary.
-- Additive and backward compatible: historical rows receive an empty value
-- and remain readable. New isolated writes carry one correlation id across
-- group events, AI jobs, evidence, CRM suggestions and task audit records.

ALTER TABLE ws_group_membership_events ADD COLUMN correlation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_jobs ADD COLUMN correlation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_job_evidence ADD COLUMN correlation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_crm_suggestions ADD COLUMN correlation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_task_audit ADD COLUMN correlation_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ws_group_membership_events_correlation
  ON ws_group_membership_events(account_id, correlation_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_correlation
  ON ai_jobs(account_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_job_evidence_correlation
  ON ai_job_evidence(account_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_crm_suggestions_correlation
  ON ai_crm_suggestions(account_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_task_audit_correlation
  ON ai_task_audit(account_id, correlation_id, created_at);
