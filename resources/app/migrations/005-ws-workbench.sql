CREATE TABLE IF NOT EXISTS ws_settings (
  conversation_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  receive_enabled INTEGER NOT NULL DEFAULT 1,
  send_enabled INTEGER NOT NULL DEFAULT 1,
  target_language TEXT NOT NULL DEFAULT '中文',
  show_original INTEGER NOT NULL DEFAULT 1,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT '未连接',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_conversations (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  last_message_text TEXT NOT NULL DEFAULT '',
  intent_level TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_messages (
  id TEXT PRIMARY KEY,
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
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ws_ai_analyses (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0,
  provider_name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ws_replies (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  original_text TEXT NOT NULL DEFAULT '',
  translated_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','copied','confirmed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_messages_external ON ws_messages(conversation_id, external_id) WHERE external_id <> '';
CREATE INDEX IF NOT EXISTS idx_ws_messages_conversation_order ON ws_messages(conversation_id, order_no, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_conversations_customer ON ws_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_ws_ai_analyses_conversation ON ws_ai_analyses(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_replies_conversation ON ws_replies(conversation_id, created_at);
