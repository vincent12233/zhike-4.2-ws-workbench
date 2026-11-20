-- NULL means the account follows its workspace default. Explicit preferences survive upgrades.
ALTER TABLE ws_account_settings ADD COLUMN open_unread_groups INTEGER CHECK(open_unread_groups IN (0,1));
UPDATE ws_account_settings
SET open_unread_groups = json_extract(settings_json, '$.openUnreadGroups')
WHERE CASE WHEN json_valid(settings_json) THEN json_type(settings_json, '$.openUnreadGroups') IN ('true','false') ELSE 0 END
  AND account_id IN (SELECT id FROM ws_accounts WHERE workspace_mode = 'dedicated');
