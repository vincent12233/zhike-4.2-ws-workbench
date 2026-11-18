-- 6.1 P0 group identity authority.
-- Group membership is a separate durable relationship ledger. The JSON
-- groupMemberships field remains a compatibility projection only.
CREATE TABLE IF NOT EXISTS customer_group_memberships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  member_jid TEXT NOT NULL,
  member_phone TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '状态未知' CHECK(status IN ('在群','已退群','被移除','未关联客户','状态未知')),
  first_joined_at TEXT NOT NULL DEFAULT '',
  last_event_at TEXT NOT NULL DEFAULT '',
  last_event_id TEXT NOT NULL DEFAULT '',
  last_event_key TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence>=0 AND confidence<=1),
  manual_locked INTEGER NOT NULL DEFAULT 0 CHECK(manual_locked IN (0,1)),
  review_reason TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id,group_jid,member_jid)
);
CREATE INDEX IF NOT EXISTS idx_customer_group_memberships_customer
  ON customer_group_memberships(customer_id,account_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_customer_group_memberships_group
  ON customer_group_memberships(account_id,group_jid,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_customer_group_memberships_phone
  ON customer_group_memberships(account_id,member_phone,updated_at)
  WHERE member_phone<>'';
-- The catalog already owns the account/group identity. This index prevents
-- two enabled seats from scanning the same group under one account while
-- retaining disabled historical target rows for audit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_group_targets_enabled_account_group
  ON ws_group_monitor_targets(account_id,group_jid)
  WHERE enabled=1;
