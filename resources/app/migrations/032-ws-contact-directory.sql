CREATE TABLE ws_contact_directory (
  account_id TEXT NOT NULL REFERENCES ws_accounts(id) ON DELETE CASCADE,
  contact_key TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source='foreground-visible-contact'),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(account_id,contact_key)
);
