-- 学习路径与练习区（Task 11 / Task 16）。新库的 schema.sql 已包含这些结构；这份迁移让旧库补上。
CREATE TABLE IF NOT EXISTS content.courses (
  id     text PRIMARY KEY,
  title  text NOT NULL,
  sort   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content.course_units (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    text NOT NULL REFERENCES content.courses(id),
  chapter_no   integer NOT NULL,
  unit_no      integer NOT NULL,
  title        text NOT NULL,
  summary      text NOT NULL DEFAULT '',
  concept_ids  text[] NOT NULL DEFAULT '{}',
  sort         integer NOT NULL DEFAULT 0,
  UNIQUE (course_id, chapter_no, unit_no)
);

CREATE TABLE IF NOT EXISTS content.unit_items (
  unit_id     uuid NOT NULL REFERENCES content.course_units(id),
  problem_id  text NOT NULL REFERENCES content.problems(id),
  sort        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (unit_id, problem_id)
);
CREATE INDEX IF NOT EXISTS unit_items_problem ON content.unit_items (problem_id);

ALTER TABLE app.assignments ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'teacher';
DO $$ BEGIN
  ALTER TABLE app.assignments ADD CONSTRAINT assignments_origin_check CHECK (origin IN ('teacher', 'path'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 自学布置按（班级，题，版本）懒创建一份，并发创建靠这个索引收敛。
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_path
  ON app.assignments (class_id, problem_id, problem_version) WHERE origin = 'path';

ALTER TABLE content.problem_versions ADD COLUMN IF NOT EXISTS review_source text NOT NULL DEFAULT 'teacher';
DO $$ BEGIN
  ALTER TABLE content.problem_versions ADD CONSTRAINT problem_versions_review_source_check CHECK (review_source IN ('teacher', 'auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE content.problems ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- 练习区：学生在自学作答里主动看了思路或完整解答（Task 16）。
CREATE TABLE IF NOT EXISTS app.solution_reveals (
  user_id     uuid NOT NULL REFERENCES app.users(id),
  attempt_id  uuid NOT NULL REFERENCES app.attempts(id),
  problem_id  text NOT NULL,
  level       text NOT NULL CHECK (level IN ('approach', 'full')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id, level)
);
CREATE INDEX IF NOT EXISTS solution_reveals_attempt ON app.solution_reveals (attempt_id);
