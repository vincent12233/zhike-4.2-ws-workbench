-- Conversation replacement must not cascade into durable delivery evidence.
-- The migration transaction also preserves attachment rows during the table swap.
CREATE TABLE ws_send_audit_v31 (
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
  payload_kind TEXT NOT NULL DEFAULT 'text',
  caption TEXT NOT NULL DEFAULT '',
  attachment_ids_json TEXT NOT NULL DEFAULT '[]',
  history_only INTEGER NOT NULL DEFAULT 0 CHECK(history_only IN (0,1)),
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);

INSERT INTO ws_send_audit_v31
SELECT id,account_id,conversation_id,batch_id,operation,idempotency_key,original_text,translated_text,
       target_language,status,error_message,native_result_json,created_at,updated_at,
       payload_kind,caption,attachment_ids_json,0 FROM ws_send_audit;
CREATE TEMP TABLE ws_restore_attachments_v31 AS SELECT * FROM ws_send_attachments;
DELETE FROM ws_send_attachments;
DROP TABLE ws_send_audit;
ALTER TABLE ws_send_audit_v31 RENAME TO ws_send_audit;
INSERT INTO ws_send_attachments SELECT * FROM ws_restore_attachments_v31;
DROP TABLE ws_restore_attachments_v31;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_send_audit_idempotency
  ON ws_send_audit(account_id, idempotency_key)
  WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_ws_send_audit_batch
  ON ws_send_audit(account_id, batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_send_audit_status
  ON ws_send_audit(account_id, status, updated_at);

-- A lost response to a committed workspace restore must not reapply the import.
CREATE TABLE workspace_restore_receipts (
  operation_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  state_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
