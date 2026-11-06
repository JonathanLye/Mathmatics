-- 求助落库（U15、WS10）：提示与批注现在有写入方，刷新后按 noteId 读回。
-- 新库的 schema.sql 已包含这些索引与列；这份迁移让按旧 schema 建成的库补上。
CREATE INDEX IF NOT EXISTS hint_deliveries_attempt ON app.hint_deliveries (attempt_id, created_at);
CREATE INDEX IF NOT EXISTS annotations_attempt ON app.annotations (attempt_id, created_at);
ALTER TABLE app.annotations ADD COLUMN IF NOT EXISTS help_id uuid REFERENCES app.help_requests(id);
ALTER TABLE app.annotations ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE app.annotations ADD COLUMN IF NOT EXISTS useful boolean;
