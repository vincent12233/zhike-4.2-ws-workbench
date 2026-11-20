-- Dedicated WS group channel configuration centre.
--
-- The authoritative business configuration of a WhatsApp group is keyed by
-- the real group JID, never by the group name, so renaming a group keeps its
-- channel, assistant, page category and tags. A group's channel is only ever
-- set by an explicit user edit or by a user-confirmed group-code rule; the
-- collector-reported ws_group_catalog.channel_id is kept as an unconfirmed
-- hint and is not used as the effective channel.

CREATE TABLE IF NOT EXISTS ws_group_channel_configs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  group_code TEXT NOT NULL DEFAULT '',
  group_code_origin TEXT NOT NULL DEFAULT '' CHECK(group_code_origin IN ('','detected','manual','import')),
  channel TEXT NOT NULL DEFAULT '',
  channel_origin TEXT NOT NULL DEFAULT '' CHECK(channel_origin IN ('','manual','import','rule')),
  page_category TEXT NOT NULL DEFAULT '',
  assistant TEXT NOT NULL DEFAULT '',
  default_tags_json TEXT NOT NULL DEFAULT '[]',
  auto_create_customers INTEGER NOT NULL DEFAULT 0 CHECK(auto_create_customers IN (0,1)),
  monitor_membership INTEGER NOT NULL DEFAULT 0 CHECK(monitor_membership IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, group_jid)
);
CREATE INDEX IF NOT EXISTS idx_ws_group_channel_configs_channel
  ON ws_group_channel_configs(account_id, channel, group_code);
CREATE INDEX IF NOT EXISTS idx_ws_group_channel_configs_code
  ON ws_group_channel_configs(group_code)
  WHERE group_code <> '';

-- Every effective change is appended here; rows are never rewritten.
CREATE TABLE IF NOT EXISTS ws_group_channel_config_history (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user',
  origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','batch','import','rule')),
  changes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_group_channel_config_history_group
  ON ws_group_channel_config_history(account_id, group_jid, created_at DESC);

-- User-confirmed mapping from an exact group code (for example A-501) to a
-- channel. There is no prefix or range inference: each code is confirmed.
CREATE TABLE IF NOT EXISTS ws_group_code_channel_rules (
  id TEXT PRIMARY KEY,
  group_code TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
