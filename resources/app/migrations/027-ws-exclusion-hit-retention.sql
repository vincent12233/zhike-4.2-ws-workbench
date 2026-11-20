-- Preserve why an automatic CRM write was blocked even after a rule is removed.
-- Keep migration 026 unchanged. Backfill evidence from rules before rebuilding
-- the hit ledger without its cascading foreign key. The migration runner owns
-- the transaction and backup; any failed copy rolls the complete step back.
CREATE TABLE ws_contact_exclusion_hits_v27 (
  id TEXT PRIMARY KEY,
  exclusion_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  member_jid TEXT NOT NULL DEFAULT '',
  member_phone TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK(action IN ('auto-create-blocked','auto-fill-blocked','lookup')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  rule_value_snapshot TEXT NOT NULL DEFAULT '',
  rule_name_snapshot TEXT NOT NULL DEFAULT '',
  rule_kind_snapshot TEXT NOT NULL DEFAULT ''
);

INSERT INTO ws_contact_exclusion_hits_v27 (
  id,exclusion_id,account_id,group_jid,member_jid,member_phone,action,
  evidence_json,created_at,rule_value_snapshot,rule_name_snapshot,rule_kind_snapshot
)
SELECT h.id,h.exclusion_id,h.account_id,h.group_jid,h.member_jid,h.member_phone,
       h.action,h.evidence_json,h.created_at,
       COALESCE(e.identity_value,h.member_jid,''),COALESCE(e.display_name,''),
       COALESCE(e.identity_kind,'')
FROM ws_contact_exclusion_hits h
LEFT JOIN ws_contact_exclusions e ON e.id=h.exclusion_id;

DROP TABLE ws_contact_exclusion_hits;
ALTER TABLE ws_contact_exclusion_hits_v27 RENAME TO ws_contact_exclusion_hits;
CREATE INDEX idx_ws_contact_exclusion_hits_time ON ws_contact_exclusion_hits(created_at DESC);
CREATE INDEX idx_ws_contact_exclusion_hits_member ON ws_contact_exclusion_hits(account_id,member_jid,created_at DESC);
