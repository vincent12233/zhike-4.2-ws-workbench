ALTER TABLE ws_collection_runs ADD COLUMN cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_collection_runs ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ws_collection_runs ADD COLUMN last_success_at TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_collection_items ADD COLUMN coverage_status TEXT NOT NULL DEFAULT 'unknown';

CREATE TABLE IF NOT EXISTS ws_followup_alerts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  analysis_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'today',
  reason TEXT NOT NULL DEFAULT '',
  followup_time TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  snoozed_until TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE,
  UNIQUE(account_id, alert_key)
);
CREATE INDEX IF NOT EXISTS idx_ws_followup_alerts_queue ON ws_followup_alerts(account_id,status,followup_time,updated_at);
