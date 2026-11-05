CREATE TABLE IF NOT EXISTS ws_collection_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'created',
  total INTEGER NOT NULL DEFAULT 0,
  discovered INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  analyzing INTEGER NOT NULL DEFAULT 0,
  analyzed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  retryable INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_collection_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  followup_status TEXT NOT NULL DEFAULT 'none',
  next_followup_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  checkpoint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, conversation_id),
  FOREIGN KEY(run_id) REFERENCES ws_collection_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES ws_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ws_collection_items_run_status ON ws_collection_items(run_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_ws_collection_items_followup ON ws_collection_items(followup_status,next_followup_at);
