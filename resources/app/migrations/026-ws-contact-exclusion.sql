-- 6.1 P3 WS contact exclusion platform.
-- The WS directory is NOT a second CRM: it only holds rules that keep listed
-- WhatsApp identities (staff, assistants, admins, manual picks) out of automatic
-- customer creation. Exclusion runs BEFORE any auto-create decision and never
-- deletes existing customers.

CREATE TABLE IF NOT EXISTS ws_contact_exclusions (
  id TEXT PRIMARY KEY,
  identity_value TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK(identity_kind IN ('phone','jid','opaque')),
  identity_phone TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','hit-log')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(identity_kind, identity_value)
);
CREATE INDEX IF NOT EXISTS idx_ws_contact_exclusions_phone ON ws_contact_exclusions(identity_phone) WHERE identity_phone <> '' AND enabled = 1;

CREATE TABLE IF NOT EXISTS ws_contact_exclusion_hits (
  id TEXT PRIMARY KEY,
  exclusion_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  member_jid TEXT NOT NULL DEFAULT '',
  member_phone TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK(action IN ('auto-create-blocked','auto-fill-blocked','lookup')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(exclusion_id) REFERENCES ws_contact_exclusions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_contact_exclusion_hits_time ON ws_contact_exclusion_hits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_contact_exclusion_hits_member ON ws_contact_exclusion_hits(account_id, member_jid, created_at DESC);
