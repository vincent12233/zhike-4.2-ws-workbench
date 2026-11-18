-- 6.1 Stage 3 isolated WS group manager data boundaries.
-- Existing catalog, membership-event and relationship-ledger tables remain
-- authoritative; these tables fill only the missing member/message/evidence
-- and audit boundaries.

CREATE TABLE IF NOT EXISTS ws_group_members (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  member_jid TEXT NOT NULL,
  member_phone TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','owner','unknown')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('active','left','removed','unknown')),
  first_seen_at TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'mock',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  manual_locked INTEGER NOT NULL DEFAULT 0 CHECK(manual_locked IN (0,1)),
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, group_jid, member_jid)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_members_account_group_status ON ws_group_members(account_id, group_jid, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_group_members_phone ON ws_group_members(account_id, member_phone, updated_at) WHERE member_phone <> '';

CREATE TABLE IF NOT EXISTS ws_group_sync_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('catalog','members','messages','full')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  checkpoint TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK(item_count >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, id)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_sync_runs_scope ON ws_group_sync_runs(account_id, group_jid, kind, status, updated_at);

CREATE TABLE IF NOT EXISTS ws_group_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_jid TEXT NOT NULL DEFAULT '',
  sender_phone TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  processing_status TEXT NOT NULL DEFAULT 'captured' CHECK(processing_status IN ('captured','queued','analysed','failed','skipped')),
  source_evidence TEXT NOT NULL DEFAULT '',
  body_hash TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, group_jid, message_id)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_messages_scope ON ws_group_messages(account_id, group_jid, sent_at, id);
CREATE INDEX IF NOT EXISTS idx_ws_group_messages_status ON ws_group_messages(account_id, processing_status, updated_at);

CREATE TABLE IF NOT EXISTS ws_group_read_evidence (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  member_jid TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('unknown','delivered','read')),
  evidence_source TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, group_jid, message_id, member_jid)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_read_evidence_scope ON ws_group_read_evidence(account_id, group_jid, message_id, status);

CREATE TABLE IF NOT EXISTS ws_group_sync_errors (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT 'UNKNOWN',
  error_message TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  next_retry_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','retrying','resolved','ignored')),
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, run_id, operation, error_code)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_sync_errors_retry ON ws_group_sync_errors(account_id, status, next_retry_at, updated_at);

CREATE TABLE IF NOT EXISTS ws_group_audit (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'group',
  entity_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'accepted' CHECK(outcome IN ('accepted','rejected','review','error')),
  reason TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_group_audit_scope ON ws_group_audit(account_id, group_jid, created_at, id);
