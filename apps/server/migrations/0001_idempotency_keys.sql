-- 写接口幂等（06 §1）。新库的 schema.sql 已包含这张表；这份迁移让按旧 schema 建成的库补上它。
CREATE TABLE IF NOT EXISTS app.idempotency_keys (
  user_id          uuid NOT NULL REFERENCES app.users(id),
  key              uuid NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,
  response_body    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created ON app.idempotency_keys (created_at);
