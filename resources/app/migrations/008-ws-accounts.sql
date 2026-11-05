CREATE TABLE IF NOT EXISTS ws_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  partition_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '未连接',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_account_settings (
  account_id TEXT PRIMARY KEY,
  translation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(translation_enabled IN (0,1)),
  ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK(ai_enabled IN (0,1)),
  auto_collection_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_collection_enabled IN (0,1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO ws_accounts(id, display_name, partition_key, status, enabled, created_at, updated_at)
VALUES('default', '默认账号', 'persist:default', '未连接', 1, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO ws_account_settings(account_id, created_at, updated_at)
VALUES('default', datetime('now'), datetime('now'));

DROP INDEX IF EXISTS idx_ws_messages_external;
DROP INDEX IF EXISTS idx_ws_messages_conversation_order;
DROP INDEX IF EXISTS idx_ws_conversations_customer;
DROP INDEX IF EXISTS idx_ws_ai_analyses_conversation;
DROP INDEX IF EXISTS idx_ws_replies_conversation;
DROP INDEX IF EXISTS idx_ws_replies_idempotency;
DROP INDEX IF EXISTS idx_ws_ingest_batches_conversation;
DROP INDEX IF EXISTS idx_ws_conversations_last_message;
DROP INDEX IF EXISTS idx_ws_messages_translation_status;
DROP INDEX IF EXISTS idx_ws_collection_items_run_status;
DROP INDEX IF EXISTS idx_ws_collection_items_followup;

ALTER TABLE ws_settings RENAME TO ws_settings_legacy;
ALTER TABLE ws_messages RENAME TO ws_messages_legacy;
ALTER TABLE ws_ai_analyses RENAME TO ws_ai_analyses_legacy;
ALTER TABLE ws_replies RENAME TO ws_replies_legacy;
ALTER TABLE ws_ingest_batches RENAME TO ws_ingest_batches_legacy;
ALTER TABLE ws_collection_items RENAME TO ws_collection_items_legacy;
ALTER TABLE ws_collection_runs RENAME TO ws_collection_runs_legacy;
ALTER TABLE ws_conversations RENAME TO ws_conversations_legacy;

CREATE TABLE ws_conversations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  last_message_text TEXT NOT NULL DEFAULT '',
  intent_level TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, external_id)
);

CREATE TABLE ws_settings (
  conversation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 1,
  receive_enabled INTEGER NOT NULL DEFAULT 1,
  send_enabled INTEGER NOT NULL DEFAULT 1,
  target_language TEXT NOT NULL DEFAULT '中文',
  send_language TEXT NOT NULL DEFAULT '',
  show_original INTEGER NOT NULL DEFAULT 1,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT '未连接',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE ws_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK(direction IN ('receive','send')),
  original_text TEXT NOT NULL DEFAULT '',
  translated_text TEXT NOT NULL DEFAULT '',
  source_language TEXT NOT NULL DEFAULT '',
  target_language TEXT NOT NULL DEFAULT '',
  order_no INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  translation_status TEXT NOT NULL DEFAULT 'none',
  translation_error TEXT NOT NULL DEFAULT '',
  translation_attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE ws_ai_analyses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0,
  provider_name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE ws_replies (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  original_text TEXT NOT NULL DEFAULT '',
  translated_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','copied','confirmed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE ws_ingest_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE,
  UNIQUE(account_id, conversation_id, fingerprint)
);

CREATE TABLE ws_collection_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'created',
  total INTEGER NOT NULL DEFAULT 0,
  discovered INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  analyzing INTEGER NOT NULL DEFAULT 0,
  analyzed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  retryable INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);

CREATE TABLE ws_collection_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  followup_status TEXT NOT NULL DEFAULT 'none',
  next_followup_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, run_id, conversation_id),
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES ws_collection_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

INSERT INTO ws_conversations(id, account_id, external_id, title, customer_id, last_message_text, intent_level, data_json, created_at, updated_at, last_message_at, unread_count, language)
SELECT id, 'default', external_id, title, customer_id, last_message_text, intent_level, data_json, created_at, updated_at, last_message_at, unread_count, language FROM ws_conversations_legacy;
INSERT INTO ws_settings(conversation_id, account_id, enabled, receive_enabled, send_enabled, target_language, send_language, show_original, ai_enabled, status, created_at, updated_at)
SELECT conversation_id, 'default', enabled, receive_enabled, send_enabled, target_language, send_language, show_original, ai_enabled, status, created_at, updated_at FROM ws_settings_legacy;
INSERT INTO ws_messages(id, account_id, conversation_id, external_id, direction, original_text, translated_text, source_language, target_language, order_no, data_json, created_at, updated_at, translation_status, translation_error, translation_attempts, last_attempt_at)
SELECT id, 'default', conversation_id, external_id, direction, original_text, translated_text, source_language, target_language, order_no, data_json, created_at, updated_at, translation_status, translation_error, translation_attempts, last_attempt_at FROM ws_messages_legacy;
INSERT INTO ws_ai_analyses(id, account_id, conversation_id, result_json, confidence, provider_name, model, error_message, created_at, updated_at)
SELECT id, 'default', conversation_id, result_json, confidence, provider_name, model, error_message, created_at, updated_at FROM ws_ai_analyses_legacy;
INSERT INTO ws_replies(id, account_id, conversation_id, original_text, translated_text, status, created_at, updated_at, idempotency_key)
SELECT id, 'default', conversation_id, original_text, translated_text, status, created_at, updated_at, idempotency_key FROM ws_replies_legacy;
INSERT INTO ws_ingest_batches(id, account_id, conversation_id, fingerprint, message_count, inserted_count, message_ids_json, created_at, updated_at)
SELECT id, 'default', conversation_id, fingerprint, message_count, inserted_count, message_ids_json, created_at, updated_at FROM ws_ingest_batches_legacy;
INSERT INTO ws_collection_runs(id, account_id, status, total, discovered, completed, analyzing, analyzed, failed, skipped, retryable, last_error, checkpoint, created_at, updated_at)
SELECT id, 'default', status, total, discovered, completed, analyzing, analyzed, failed, skipped, retryable, last_error, checkpoint, created_at, updated_at FROM ws_collection_runs_legacy;
INSERT INTO ws_collection_items(id, account_id, run_id, conversation_id, status, attempts, analysis_status, followup_status, next_followup_at, last_error, checkpoint, created_at, updated_at)
SELECT id, 'default', run_id, conversation_id, status, attempts, analysis_status, followup_status, next_followup_at, last_error, checkpoint, created_at, updated_at FROM ws_collection_items_legacy;

DROP TABLE ws_collection_items_legacy;
DROP TABLE ws_collection_runs_legacy;
DROP TABLE ws_ingest_batches_legacy;
DROP TABLE ws_replies_legacy;
DROP TABLE ws_ai_analyses_legacy;
DROP TABLE ws_messages_legacy;
DROP TABLE ws_settings_legacy;
DROP TABLE ws_conversations_legacy;

CREATE INDEX IF NOT EXISTS idx_ws_messages_external ON ws_messages(account_id, conversation_id, external_id) WHERE external_id <> '';
CREATE INDEX IF NOT EXISTS idx_ws_messages_conversation_order ON ws_messages(account_id, conversation_id, order_no, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_conversations_customer ON ws_conversations(account_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_ws_ai_analyses_conversation ON ws_ai_analyses(account_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_replies_conversation ON ws_replies(account_id, conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_replies_idempotency ON ws_replies(account_id, conversation_id, idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_ws_ingest_batches_conversation ON ws_ingest_batches(account_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_conversations_last_message ON ws_conversations(account_id, last_message_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_messages_translation_status ON ws_messages(account_id, translation_status, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ws_collection_items_run_status ON ws_collection_items(account_id, run_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_collection_items_followup ON ws_collection_items(account_id, followup_status, next_followup_at);
