-- 6.0.2 data-integrity hardening.
--
-- Migration 008 accidentally downgraded the WS message external-id index from
-- UNIQUE to an ordinary index while adding account partitioning.  Repair old
-- duplicates before restoring the database invariant.  The first row for a
-- key (oldest created_at, then stable id) remains canonical; duplicate rows
-- stay available for audit/history but lose the ambiguous external_id.  Their
-- original id is retained in data_json so replay can resolve to the canonical
-- row without deleting transcript content.
DROP INDEX IF EXISTS idx_ws_messages_external;

WITH ranked AS (
  SELECT
    id,
    external_id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id, conversation_id, external_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM ws_messages
  WHERE external_id <> ''
)
UPDATE ws_messages
SET
  data_json = CASE
    WHEN json_valid(data_json) AND substr(ltrim(data_json), 1, 1) = '{'
      THEN json_set(
        data_json,
        '$.duplicateExternalId', external_id,
        '$.duplicateExternalIdReason', 'migration-014-external-id-unique'
      )
    ELSE json_object(
      'duplicateExternalId', external_id,
      'duplicateExternalIdReason', 'migration-014-external-id-unique',
      'legacyDataJson', data_json
    )
  END,
  external_id = ''
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_messages_external
  ON ws_messages(account_id, conversation_id, external_id)
  WHERE external_id <> '';

