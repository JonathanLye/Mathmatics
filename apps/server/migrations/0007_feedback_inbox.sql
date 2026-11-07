-- 反馈信箱（15-反馈与信箱.md）：给 student_feedback 加状态、分类与上下文，新增对话表。
-- 只加列、加表、加索引；可重复执行。

CREATE SEQUENCE IF NOT EXISTS app.student_feedback_ref_seq;

ALTER TABLE app.student_feedback
  ADD COLUMN IF NOT EXISTS ref_no          integer NOT NULL DEFAULT nextval('app.student_feedback_ref_seq'),
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'open', 'need_info', 'resolved', 'closed')),
  ADD COLUMN IF NOT EXISTS category        text
    CHECK (category IS NULL OR category IN ('bug', 'display', 'content', 'suggestion', 'question', 'other')),
  ADD COLUMN IF NOT EXISTS area            text,
  ADD COLUMN IF NOT EXISTS context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS student_unread  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dev_unread      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS student_event   text CHECK (student_event IS NULL OR student_event IN ('confirmed', 'resolved')),
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason    text
    CHECK (close_reason IS NULL OR close_reason IN ('fixed', 'duplicate', 'wontfix', 'no_repro')),
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE UNIQUE INDEX IF NOT EXISTS student_feedback_ref_no ON app.student_feedback (ref_no);
CREATE INDEX IF NOT EXISTS student_feedback_user_activity ON app.student_feedback (user_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS student_feedback_status_activity ON app.student_feedback (status, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS app.feedback_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id  uuid NOT NULL REFERENCES app.student_feedback(id) ON DELETE CASCADE,
  author_role  text NOT NULL CHECK (author_role IN ('student', 'dev')),
  author_id    uuid NOT NULL REFERENCES app.users(id),
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_messages_thread ON app.feedback_messages (feedback_id, created_at);
