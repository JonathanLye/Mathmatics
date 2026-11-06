-- 学生进度、设置与反馈（全部为新增表；新库的 schema.sql 已包含，旧库补上）。可重复执行。
CREATE TABLE IF NOT EXISTS app.student_settings (
  user_id      uuid PRIMARY KEY REFERENCES app.users(id),
  daily_goal   smallint NOT NULL DEFAULT 3 CHECK (daily_goal BETWEEN 1 AND 20),   -- 每天自己写出的关键步骤数
  default_input text NOT NULL DEFAULT 'hand' CHECK (default_input IN ('hand', 'keyboard', 'photo')),
  theme        text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  sound        boolean NOT NULL DEFAULT true,
  motion       boolean NOT NULL DEFAULT true,
  haptics      boolean NOT NULL DEFAULT true,
  onboarding   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.xp_ledger (            -- 经验台账：只追加；(user_id, source_key) 唯一保证幂等，重做/重放不重复发
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES app.users(id),
  source_key  text NOT NULL,                          -- key:{题}:{步骤} / layer:{题}:L{n} / done:{题} / daily:{日期}
  kind        text NOT NULL CHECK (kind IN ('key_own', 'key_hinted', 'layer', 'problem', 'daily')),
  amount      integer NOT NULL,
  day         date NOT NULL,                          -- Asia/Shanghai 自然日
  attempt_id  uuid REFERENCES app.attempts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_key)
);
CREATE INDEX IF NOT EXISTS xp_ledger_user_day ON app.xp_ledger (user_id, day);

CREATE TABLE IF NOT EXISTS app.student_badges (
  user_id    uuid NOT NULL REFERENCES app.users(id),
  badge_id   text NOT NULL,                           -- 徽章目录在代码里（apps/server/src/progress/badges.ts）
  earned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS app.student_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users(id),
  kind        text NOT NULL CHECK (kind IN ('bug', 'idea', 'content', 'other')),
  body        text NOT NULL,
  page        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_feedback_created ON app.student_feedback (created_at DESC);

