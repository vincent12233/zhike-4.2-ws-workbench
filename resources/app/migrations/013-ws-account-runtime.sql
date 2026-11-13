-- Keep runtime status (which is valid only for the current WebView process)
-- separate from the last observed account status.  This prevents a restart
-- from either falsely reporting an account as online or losing reconnect
-- context entirely.
ALTER TABLE ws_accounts ADD COLUMN last_status TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_accounts ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';

UPDATE ws_accounts
SET last_status = CASE
      WHEN status <> '未连接' AND last_status = '' THEN status
      ELSE last_status
    END,
    last_seen_at = CASE
      WHEN status = '已连接' AND last_seen_at = '' THEN updated_at
      ELSE last_seen_at
    END;
