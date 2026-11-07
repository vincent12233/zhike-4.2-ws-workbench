-- Older preview builds could emit the same outbox event more than once. They
-- are transport duplicates, not business records; keep the oldest row and
-- remove only the redundant pending copies before adding the idempotency key.
DELETE FROM sync_outbox AS duplicate
USING sync_outbox AS keeper
WHERE duplicate.aggregate_type = keeper.aggregate_type
  AND duplicate.aggregate_id = keeper.aggregate_id
  AND duplicate.event_type = keeper.event_type
  AND duplicate.id > keeper.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_outbox_event
    ON sync_outbox (aggregate_type, aggregate_id, event_type);

INSERT INTO schema_migrations(version, description)
VALUES (8, '事务外盒事件去重约束')
ON CONFLICT (version) DO NOTHING;
