-- Persist metadata observed from the visible WS conversation list.
-- This migration is additive and safe for existing PostgreSQL deployments.
-- It deliberately does not store cookies, QR payloads, passwords or tokens.

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_message_preview TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS visible_only BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS list_captured_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'conversations_unread_count_nonnegative'
    ) THEN
        ALTER TABLE conversations
            ADD CONSTRAINT conversations_unread_count_nonnegative CHECK (unread_count >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_account_list_capture
    ON conversations(account_id, list_captured_at DESC, updated_at DESC);

INSERT INTO schema_migrations(version, description)
VALUES (12, 'WS列表采集元数据与预览')
ON CONFLICT (version) DO NOTHING;
