-- 6.0.3 account-scoped WS group catalog. The catalog is a durable inventory
-- of groups returned by the native collector, independent of the currently
-- rendered/virtualized conversation list.
ALTER TABLE ws_group_monitor_targets ADD COLUMN channel_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ws_group_catalog (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  participant_count INTEGER NOT NULL DEFAULT 0 CHECK(participant_count >= 0),
  last_message_at TEXT NOT NULL DEFAULT '',
  discovery_source TEXT NOT NULL DEFAULT 'ws-collector',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','unknown')),
  data_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_ws_group_catalog_account_status
  ON ws_group_catalog(account_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_group_catalog_channel
  ON ws_group_catalog(account_id, channel_id, group_jid);
CREATE INDEX IF NOT EXISTS idx_ws_group_targets_account_group
  ON ws_group_monitor_targets(account_id, group_jid);
