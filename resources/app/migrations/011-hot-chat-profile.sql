CREATE TABLE IF NOT EXISTS hot_chat_profiles (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL DEFAULT '',
  status_color TEXT NOT NULL DEFAULT 'gray',
  manual_color TEXT NOT NULL DEFAULT '',
  manual_locked INTEGER NOT NULL DEFAULT 0 CHECK(manual_locked IN (0,1)),
  completeness INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(customer_id, account_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS hot_chat_profile_fields (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  state TEXT NOT NULL DEFAULT 'missing' CHECK(state IN ('known','missing','pending','declined')),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  manual_locked INTEGER NOT NULL DEFAULT 0 CHECK(manual_locked IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
  UNIQUE(profile_id, field_key)
);
CREATE TABLE IF NOT EXISTS hot_chat_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'AI',
  analysis_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hot_chat_sync_outbox (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT 'default',
  operation TEXT NOT NULL DEFAULT 'upsert_profile',
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES hot_chat_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES hot_chat_events(id) ON DELETE SET NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_chat_profile_identity ON hot_chat_profiles(customer_id,account_id,conversation_id);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profiles_account_conversation ON hot_chat_profiles(account_id,conversation_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profiles_customer ON hot_chat_profiles(account_id,customer_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profile_fields_profile ON hot_chat_profile_fields(profile_id,field_key,updated_at);
CREATE INDEX IF NOT EXISTS idx_hot_chat_profile_fields_state ON hot_chat_profile_fields(state,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_chat_events_idempotency ON hot_chat_events(profile_id,idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_hot_chat_events_profile ON hot_chat_events(profile_id,created_at);
CREATE INDEX IF NOT EXISTS idx_hot_chat_sync_outbox_queue ON hot_chat_sync_outbox(account_id,status,next_attempt_at,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_chat_sync_outbox_event ON hot_chat_sync_outbox(event_id) WHERE event_id <> '';
