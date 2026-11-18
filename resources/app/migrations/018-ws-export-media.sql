-- 6.0.3 durable WS media references, attachment audit and export jobs.
-- Binary media is optional: when the native bridge cannot provide a file,
-- the row still preserves message linkage and an explicit unavailable status.
CREATE TABLE IF NOT EXISTS ws_media_assets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'file',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  sha256 TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','available','pending','unavailable','deleted')),
  unavailable_reason TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_media_assets_account ON ws_media_assets(account_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ws_media_assets_message ON ws_media_assets(account_id, message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_media_assets_conversation ON ws_media_assets(account_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ws_media_assets_sha ON ws_media_assets(account_id, sha256) WHERE sha256 <> '';

CREATE TABLE IF NOT EXISTS ws_send_attachments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  send_audit_id TEXT NOT NULL DEFAULT '',
  media_id TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0 CHECK(order_no >= 0),
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','cancelled')),
  error_message TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES ws_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(send_audit_id) REFERENCES ws_send_audit(id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES ws_media_assets(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_ws_send_attachments_audit ON ws_send_attachments(account_id, send_audit_id, order_no);
CREATE INDEX IF NOT EXISTS idx_ws_send_attachments_media ON ws_send_attachments(account_id, media_id, created_at);

CREATE TABLE IF NOT EXISTS ws_export_jobs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'account' CHECK(scope IN ('account','all')),
  account_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  progress_total INTEGER NOT NULL DEFAULT 0 CHECK(progress_total >= 0),
  progress_done INTEGER NOT NULL DEFAULT 0 CHECK(progress_done >= 0),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  output_path TEXT NOT NULL DEFAULT '',
  output_sha256 TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ws_export_jobs_status ON ws_export_jobs(status, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_ws_export_jobs_account ON ws_export_jobs(account_id, created_at, id);

-- Existing 6.0.3 workspaces get explicit payload metadata without rewriting
-- prior audit rows. The server also guards these columns for hand-migrated DBs.
ALTER TABLE ws_send_audit ADD COLUMN payload_kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE ws_send_audit ADD COLUMN caption TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_send_audit ADD COLUMN attachment_ids_json TEXT NOT NULL DEFAULT '[]';

