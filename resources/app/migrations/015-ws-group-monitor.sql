CREATE TABLE IF NOT EXISTS ws_group_monitor_profiles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK(status IN ('paused','starting','running','degraded','auth-required','error','stopped')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  poll_interval_sec INTEGER NOT NULL DEFAULT 45 CHECK(poll_interval_sec BETWEEN 15 AND 3600),
  last_heartbeat_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(slot_key),
  UNIQUE(account_id, slot_key)
);

CREATE TABLE IF NOT EXISTS ws_group_monitor_targets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  vip_only INTEGER NOT NULL DEFAULT 1 CHECK(vip_only IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  last_snapshot_hash TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES ws_group_monitor_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  UNIQUE(profile_id, group_jid)
);

CREATE TABLE IF NOT EXISTS ws_group_membership_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  member_jid TEXT NOT NULL,
  member_phone TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK(event_type IN ('joined','left','removed')),
  event_at TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system-event',
  source_event_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  evidence_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','review','ignored')),
  review_reason TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES ws_group_monitor_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES ws_group_monitor_targets(id) ON DELETE CASCADE,
  UNIQUE(idempotency_key)
);

CREATE TABLE IF NOT EXISTS ws_group_monitor_checkpoints (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  last_event_at TEXT NOT NULL DEFAULT '',
  last_snapshot_hash TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','running','paused','error')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES ws_group_monitor_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES ws_group_monitor_targets(id) ON DELETE CASCADE,
  UNIQUE(profile_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_group_monitor_profiles_account
  ON ws_group_monitor_profiles(account_id, enabled, status);
CREATE INDEX IF NOT EXISTS idx_ws_group_monitor_targets_profile
  ON ws_group_monitor_targets(profile_id, enabled, group_jid);
CREATE INDEX IF NOT EXISTS idx_ws_group_monitor_targets_account
  ON ws_group_monitor_targets(account_id, enabled, source_id);
CREATE INDEX IF NOT EXISTS idx_ws_group_membership_events_lookup
  ON ws_group_membership_events(account_id, target_id, event_at, observed_at);
CREATE INDEX IF NOT EXISTS idx_ws_group_membership_events_customer
  ON ws_group_membership_events(account_id, customer_id, event_at);
CREATE INDEX IF NOT EXISTS idx_ws_group_membership_events_review
  ON ws_group_membership_events(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_group_monitor_checkpoints_profile
  ON ws_group_monitor_checkpoints(profile_id, status, updated_at);
