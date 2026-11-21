-- V9.1/V9.2: locally managed groups.
-- A group record is identified by the operator-maintained alias, not by a
-- guessed WhatsApp JID. The JID column stays nullable and is only filled after
-- an explicit, verified binding. The assistant concept is deliberately absent.
CREATE TABLE IF NOT EXISTS ws_managed_groups (
  id TEXT PRIMARY KEY,
  workspace_mode TEXT NOT NULL DEFAULT 'dedicated',
  channel TEXT NOT NULL,
  group_name TEXT NOT NULL,
  group_alias TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  jid TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_collected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_managed_groups_alias
  ON ws_managed_groups(workspace_mode, alias_key);

CREATE INDEX IF NOT EXISTS idx_ws_managed_groups_channel
  ON ws_managed_groups(workspace_mode, channel);

CREATE TABLE IF NOT EXISTS ws_managed_group_audit (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ws_managed_group_audit_group
  ON ws_managed_group_audit(group_id, created_at);
