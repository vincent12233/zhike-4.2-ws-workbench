-- Local operator drafts and immutable target snapshots. No transport reads this table.
CREATE TABLE ws_group_drafts (
  account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT', 'CANCELLED')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX idx_ws_group_drafts_created ON ws_group_drafts(account_id, created_at DESC, id);
