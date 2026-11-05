ALTER TABLE ws_settings ADD COLUMN send_language TEXT NOT NULL DEFAULT '';

ALTER TABLE ws_conversations ADD COLUMN last_message_at TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_conversations ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ws_conversations ADD COLUMN language TEXT NOT NULL DEFAULT '';

ALTER TABLE ws_messages ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE ws_messages ADD COLUMN translation_error TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_messages ADD COLUMN translation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ws_messages ADD COLUMN last_attempt_at TEXT NOT NULL DEFAULT '';

UPDATE ws_messages
SET translation_status = CASE WHEN translated_text <> '' THEN 'translated' ELSE 'none' END;

ALTER TABLE ws_replies ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ws_ingest_batches (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, fingerprint)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_replies_idempotency
  ON ws_replies(conversation_id, idempotency_key)
  WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_ws_ingest_batches_conversation
  ON ws_ingest_batches(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_conversations_last_message
  ON ws_conversations(last_message_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_messages_translation_status
  ON ws_messages(translation_status, last_attempt_at);
