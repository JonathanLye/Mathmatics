-- 学生密码（WS1）。新库的 schema.sql 已包含这两列；这份迁移让旧库补上。
-- 每列单独一条语句：可重复执行，且 migration-idempotency 测试按语句逐列核对 schema.sql。
ALTER TABLE app.student_profiles ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE app.student_profiles ADD COLUMN IF NOT EXISTS password_set_at timestamptz;
