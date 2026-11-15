-- User blocked senders enforcement toggle
ALTER TABLE users ADD COLUMN block_senders_enabled INTEGER NOT NULL DEFAULT 1;
