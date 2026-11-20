-- Account purpose is separate from connection state, group selection and CRM labels.
-- Existing accounts retain the ordinary workspace; no profiles or customer data move.
ALTER TABLE ws_accounts ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'ordinary'
  CHECK (workspace_mode IN ('ordinary', 'dedicated'));
