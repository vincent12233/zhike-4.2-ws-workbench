-- Durable, account-scoped audit records for explicit WS sends/broadcasts.
-- The table stores message text and native execution outcome, never cookies,
-- passwords, QR payloads or provider credentials.
CREATE TABLE IF NOT EXISTS ws_send_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  batch_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL DEFAULT 'single' CHECK(operation IN ('single','broadcast')),
  idempotency_key TEXT NOT NULL DEFAULT '',
  original_text TEXT NOT NULL DEFAULT '',
  translated_text TEXT NOT NULL DEFAULT '',
  target_language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','rate_limited','cancelled')),
  error_message TEXT NOT NULL DEFAULT '',
  native_result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_send_audit_idempotency
  ON ws_send_audit(account_id, idempotency_key)
  WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_ws_send_audit_batch
  ON ws_send_audit(account_id, batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_send_audit_status
  ON ws_send_audit(account_id, status, updated_at);

