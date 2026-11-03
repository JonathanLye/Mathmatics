-- 证明陪练场 数据库 DDL v1（PostgreSQL 16+）
-- 说明见 07-数据库设计.md。原则：
--   1. 研究数据只多不少：events 只追加（触发器禁止改删），作答相关表全部软删除。
--   2. 题目包保密部分放在 vault schema，应用以外的角色无权读取；学生接口从不查询 vault 后原样返回。
--   3. 个人身份信息加密存储（*_enc，应用层 AES-256-GCM），对外只用 anon_code。
--   4. 所有时间 timestamptz；所有 ID uuid（由应用生成 uuid v7，库内默认值只作兜底）。
-- 校验：contracts/tools/check-sql.mjs 用 PGlite 完整执行本文件。

CREATE SCHEMA IF NOT EXISTS app;      -- 用户、班级、布置、作答
CREATE SCHEMA IF NOT EXISTS content;  -- 题库源、概念库、题目包公开部分、导入流水线
CREATE SCHEMA IF NOT EXISTS vault;    -- 题目包保密部分、参考证明
CREATE SCHEMA IF NOT EXISTS ev;       -- 只追加事件

-- =====================================================================
-- 1. 用户与班级
-- =====================================================================
CREATE TABLE app.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          text NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  anon_code     text NOT NULL UNIQUE,                 -- S-7K2Q9M / T-3F，导出与日志只用它
  display_name  text,                                 -- 学生默认空；教师可填
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE TABLE app.student_profiles (
  user_id          uuid PRIMARY KEY REFERENCES app.users(id),
  student_no_enc   bytea NOT NULL,                    -- 学号密文
  student_no_hash  text NOT NULL UNIQUE,              -- HMAC-SHA256(学号, pepper)，用于登录匹配
  name_enc         bytea,                             -- 姓名密文（名单导入时才有）
  age_band         text CHECK (age_band IN ('lt14', '14to17', 'ge18')),  -- 未成年人分档（13-合规）
  grade            text,
  major            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.teacher_accounts (
  user_id        uuid PRIMARY KEY REFERENCES app.users(id),
  username       text NOT NULL UNIQUE,
  password_hash  text NOT NULL,                       -- argon2id
  totp_secret_enc bytea,
  email_enc      bytea,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.classes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  term               text NOT NULL,                   -- 2026 秋
  owner_id           uuid NOT NULL REFERENCES app.users(id),
  invite_code        text NOT NULL UNIQUE,            -- 6 位，去掉易混字符
  invite_expires_at  timestamptz,
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 默认预算、拍照开关、诚信策略等
  created_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz
);

CREATE TABLE app.roster_entries (                     -- 教师导入的名单；学生首次登录时认领
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id         uuid NOT NULL REFERENCES app.classes(id),
  student_no_hash  text NOT NULL,
  name_enc         bytea,
  claimed_by       uuid REFERENCES app.users(id),
  claimed_at       timestamptz,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_no_hash)
);

CREATE TABLE app.class_members (
  class_id   uuid NOT NULL REFERENCES app.classes(id),
  user_id    uuid NOT NULL REFERENCES app.users(id),
  role       text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'assistant')),
  arm        text CHECK (arm IN ('A', 'B')),          -- 实验分组；未参与为空
  arm_order  text CHECK (arm_order IN ('AB', 'BA')),  -- 交叉设计顺序
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  PRIMARY KEY (class_id, user_id)
);

CREATE TABLE app.consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users(id),
  version     text NOT NULL,                          -- 同意书版本号，改文案必须升版本
  items       jsonb NOT NULL,                         -- {service, crossBorderHosting, crossBorderModel, monitoring, research}
  ip_masked   text,                                   -- /24 掩码
  ua_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX consents_user ON app.consents (user_id, created_at DESC);

CREATE TABLE app.devices (
  id          uuid PRIMARY KEY,                       -- 前端生成并持久化的 deviceId
  user_id     uuid REFERENCES app.users(id),
  platform    text,
  ua_hash     text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.auth_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users(id),
  device_id   uuid REFERENCES app.devices(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip_masked   text
);

CREATE INDEX auth_sessions_user ON app.auth_sessions (user_id) WHERE revoked_at IS NULL;

-- 写接口幂等（06 §1）：同一用户同一 Idempotency-Key 24 小时内重放返回首次响应。
-- 先占位（response_status 为空 = 处理中），处理完成后写入响应；失败的请求释放占位，允许重试。
CREATE TABLE app.idempotency_keys (
  user_id          uuid NOT NULL REFERENCES app.users(id),
  key              uuid NOT NULL,                      -- 客户端的 Idempotency-Key
  request_hash     text NOT NULL,                      -- 方法 + 路径 + 请求体的 SHA-256；同键不同请求会被拒绝
  response_status  integer,                            -- 空 = 处理中
  response_body    text,                               -- 首次响应原文（JSON 字符串）
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created ON app.idempotency_keys (created_at);

-- =====================================================================
-- 2. 题库源与导入流水线
-- =====================================================================
CREATE TABLE content.sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,                        -- 数学分析同步辅导及习题全解（华东师大版）
  kind          text NOT NULL DEFAULT 'pdf' CHECK (kind IN ('pdf', 'docx', 'manual')),
  file_sha256   text NOT NULL UNIQUE,
  pages         integer,
  storage_key   text NOT NULL,
  license_note  text,                                 -- 版权说明：仅限本课程内部教学使用
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.source_pages (
  source_id     uuid NOT NULL REFERENCES content.sources(id),
  page_no       integer NOT NULL,
  image_key     text NOT NULL,                        -- 渲染后的页图（200 dpi PNG）
  ocr_provider  text,
  ocr_md        text,                                 -- 识别出的 Markdown（含 $…$）
  ocr_json      jsonb,                                -- 版面块、坐标、置信度
  ocr_conf      real,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ocr_ok', 'ocr_failed', 'reviewed')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, page_no)
);

CREATE TABLE content.source_items (                   -- 从页面切出的条目：例题 / 考研真题 / 课后习题 / 内容提要
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES content.sources(id),
  volume       text CHECK (volume IN ('上', '下')),
  chapter_no   integer NOT NULL,
  chapter_title text,
  section      text,
  item_type    text NOT NULL CHECK (item_type IN ('summary', 'example', 'exam', 'exercise')),
  item_no      text,                                  -- 例 4 / 题 2.1 / 习题 3(2)
  exam_source  text,                                  -- 北京大学 2003
  pages        integer[] NOT NULL,
  stem_md      text,
  analysis_md  text,                                  -- 解题分析（起草 H0–H2 的素材）
  solution_md  text,                                  -- 解题过程（参考证明素材，只进 vault）
  is_proof     boolean,                               -- 是否为证明题（筛选用）
  extract_conf real,
  status       text NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted', 'selected', 'drafted', 'skipped')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_items_chapter ON content.source_items (source_id, chapter_no, item_type);

CREATE TABLE content.import_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES content.sources(id),
  params       jsonb NOT NULL,                        -- 页码范围、章节、要起草的条目 ID 等
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  stage        text,                                  -- render / ocr / extract / draft / check
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_cny     numeric(10, 4) NOT NULL DEFAULT 0,
  created_by   uuid NOT NULL REFERENCES app.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  error        text
);

CREATE TABLE content.import_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES content.import_jobs(id),
  source_item_id  uuid REFERENCES content.source_items(id),
  problem_id      text NOT NULL,                      -- 拟定的题目 ID
  draft           jsonb NOT NULL,                     -- 完整题目包草稿（含 secret）
  draft_a         jsonb,                              -- 模型 A 原稿
  draft_b         jsonb,                              -- 模型 B 原稿
  model_a         text,
  model_b         text,
  arbiter         text,
  disagreements   jsonb NOT NULL DEFAULT '[]'::jsonb, -- 两稿分歧及仲裁结果
  auto_checks     jsonb NOT NULL DEFAULT '{}'::jsonb, -- schema/katex/leak/pattern/lean
  status          text NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted', 'checked', 'in_review', 'approved', 'returned', 'discarded')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 3. 概念库与题目包
-- =====================================================================
CREATE TABLE content.concepts (
  id           text NOT NULL,
  version      integer NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('definition', 'frame')),
  title        text NOT NULL,
  body         jsonb NOT NULL,                        -- concept.schema.json 的 Concept
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  reviewed_by  uuid REFERENCES app.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE TABLE content.glossary (
  id        text PRIMARY KEY,
  triggers  text[] NOT NULL,
  answer    text NOT NULL,
  layers    text[],
  status    text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'retired')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.problems (
  id               text PRIMARY KEY,                  -- epsN
  kind             text NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'transfer')),
  title            text NOT NULL,
  chapter          text,
  current_version  integer,                           -- 最新已发布版本
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.problem_versions (
  problem_id     text NOT NULL REFERENCES content.problems(id),
  version        integer NOT NULL,
  public         jsonb NOT NULL,                      -- problem-package.schema.json 的 public
  review_status  text NOT NULL CHECK (review_status IN ('draft', 'pending', 'returned', 'published', 'retired')),
  auto_checks    jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_id       uuid REFERENCES content.import_drafts(id),
  reviewed_by    uuid REFERENCES app.users(id),
  reviewed_at    timestamptz,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, version)
);
-- 已发布版本不可修改：要改就发新版本（作答固定在开题时的版本上）
CREATE FUNCTION content.freeze_published() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.review_status = 'published' AND (NEW.public IS DISTINCT FROM OLD.public) THEN
    RAISE EXCEPTION 'published problem version % v% is immutable', OLD.problem_id, OLD.version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER problem_versions_freeze BEFORE UPDATE ON content.problem_versions
  FOR EACH ROW EXECUTE FUNCTION content.freeze_published();

CREATE TABLE vault.problem_secrets (
  problem_id  text NOT NULL,
  version     integer NOT NULL,
  secret      jsonb NOT NULL,                         -- problem-package.schema.json 的 secret，去掉 referenceProofs
  PRIMARY KEY (problem_id, version),
  FOREIGN KEY (problem_id, version) REFERENCES content.problem_versions(problem_id, version)
);

CREATE TABLE vault.reference_proofs (
  problem_id   text NOT NULL,
  version      integer NOT NULL,
  proof_id     text NOT NULL,
  route        integer,
  text         text NOT NULL,
  publishable  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (problem_id, version, proof_id),
  FOREIGN KEY (problem_id, version) REFERENCES content.problem_versions(problem_id, version)
);

CREATE TABLE vault.reference_access_log (             -- 谁、为什么读了参考证明
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES app.users(id),
  problem_id  text NOT NULL,
  version     integer NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('review', 'publish', 'lean', 'export_admin')),
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.review_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id     text NOT NULL,
  version        integer NOT NULL,
  draft_id       uuid REFERENCES content.import_drafts(id),
  reviewer_id    uuid NOT NULL REFERENCES app.users(id),
  decision       text NOT NULL CHECK (decision IN ('approve', 'return', 'edit')),
  comments       text,
  diff           jsonb,                               -- 教师改了哪些字段
  minutes_spent  integer,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.lean_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id  text NOT NULL,
  version     integer NOT NULL,
  ok          boolean NOT NULL,
  sorry       boolean NOT NULL DEFAULT false,
  ms          integer,
  toolchain   text,
  output      text,
  at          timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 4. 布置与实验
-- =====================================================================
CREATE TABLE app.assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id             uuid NOT NULL REFERENCES app.classes(id),
  problem_id           text NOT NULL,
  problem_version      integer NOT NULL,
  mode                 text NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'test')),
  open_at              timestamptz NOT NULL,
  close_at             timestamptz,
  settings             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 预算覆盖、启用层、拍照/提示开关、诚信阈值
  status               text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'closed', 'cancelled')),
  review_published_at  timestamptz,                    -- 题目关闭后教师发布参考证明与讲评
  review_note          text,
  created_by           uuid NOT NULL REFERENCES app.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (problem_id, problem_version) REFERENCES content.problem_versions(problem_id, version)
);
CREATE INDEX assignments_class ON app.assignments (class_id, open_at DESC);

CREATE TABLE app.experiments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES app.classes(id),
  design        jsonb NOT NULL,                       -- 交叉设计、知识块、A/B 条件说明
  prereg_url    text,                                 -- OSF 预注册
  ethics_ref    text,                                 -- 伦理审查批件号
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'ended')),
  frozen_versions jsonb,                              -- 实验期冻结的模型与提示词版本
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 5. 作答（服务端为准）
-- =====================================================================
CREATE TABLE app.attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id      uuid NOT NULL REFERENCES app.assignments(id),
  user_id            uuid NOT NULL REFERENCES app.users(id),
  problem_id         text NOT NULL,
  problem_version    integer NOT NULL,
  kind               text NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'transfer')),
  parent_attempt_id  uuid REFERENCES app.attempts(id),
  mode               text NOT NULL CHECK (mode IN ('practice', 'test')),
  arm                text CHECK (arm IN ('A', 'B')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'parked', 'locked', 'completed', 'abandoned')),
  current_layer      text NOT NULL DEFAULT 'L1' CHECK (current_layer IN ('L1', 'L2', 'L3', 'L4', 'L5', 'L6')),
  state              jsonb NOT NULL,                  -- 引擎状态（packages/engine 的 AttemptState），只由服务端写
  state_version      integer NOT NULL DEFAULT 0,      -- 乐观锁；每次状态变化 +1
  reveal             numeric(4, 2) NOT NULL DEFAULT 0,
  keys_own           smallint NOT NULL DEFAULT 0,
  keys_total         smallint NOT NULL,
  independence       numeric(4, 3),
  last_event_seq     bigint NOT NULL DEFAULT 0,       -- 事件 seq 分配器
  locked_reason      text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  active_ms          bigint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (problem_id, problem_version) REFERENCES content.problem_versions(problem_id, version)
);
CREATE UNIQUE INDEX attempts_one_main ON app.attempts (assignment_id, user_id) WHERE kind = 'main';
CREATE UNIQUE INDEX attempts_one_transfer ON app.attempts (parent_attempt_id) WHERE kind = 'transfer';
CREATE INDEX attempts_user ON app.attempts (user_id, started_at DESC);
CREATE INDEX attempts_assignment_status ON app.attempts (assignment_id, status);

CREATE TABLE app.attempt_lines (                      -- 学生写下的每一行（各层通用）
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid NOT NULL REFERENCES app.attempts(id),
  layer                text NOT NULL CHECK (layer IN ('L1', 'L2', 'L3', 'L4', 'L5', 'L6')),
  role                 text NOT NULL CHECK (role IN ('def', 'frame', 'step', 'selfcheck', 'summary')),
  idx                  integer NOT NULL,              -- 本层内序号；第 3 层即行号
  slot                 text,                          -- 自检题 ID / 总结第几问
  statement            text NOT NULL,                 -- MathText
  justification        text,                          -- MathText（第 3 层"依据"）
  statement_canon      text NOT NULL,
  justification_canon  text,
  provenance           text NOT NULL CHECK (provenance IN ('ink', 'keyboard', 'photo', 'mixed', 'paste')),
  recog_id             uuid,
  cls                  text,                          -- match / error / unknown / lowconf / demo_needs_reason / pass / fail
  keys                 text[] NOT NULL DEFAULT '{}',
  new_keys             text[] NOT NULL DEFAULT '{}',
  error_id             text,
  conf                 real,
  classifier_path      text,
  flagged              boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  edited_at            timestamptz,
  deleted_at           timestamptz
);
CREATE INDEX attempt_lines_attempt ON app.attempt_lines (attempt_id, layer, idx);

CREATE TABLE app.ink_captures (                       -- 原始笔迹（x,y,t,p），用于识别、回放与诚信核查
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid NOT NULL REFERENCES app.attempts(id),
  draft_id       uuid NOT NULL,
  target         text NOT NULL,
  format         text NOT NULL DEFAULT 'ink-v1',      -- 见 03-手写键盘与识别.md §2
  strokes        bytea NOT NULL,                      -- gzip(JSON ink-v1)；P1 起大于 64KB 的转存对象存储
  stroke_count   integer NOT NULL,
  point_count    integer NOT NULL,
  duration_ms    integer NOT NULL,
  canvas         jsonb NOT NULL,                      -- {w,h,dpr,orientation,fullscreen}
  pointer_types  text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ink_captures_attempt ON app.ink_captures (attempt_id, created_at);

CREATE TABLE app.photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   uuid NOT NULL REFERENCES app.attempts(id),
  storage_key  text NOT NULL,
  sha256       text NOT NULL,
  bytes        integer NOT NULL,
  w            integer,
  h            integer,
  source       text NOT NULL CHECK (source IN ('camera', 'album')),
  exif_stripped boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.recognitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      uuid NOT NULL REFERENCES app.attempts(id),
  draft_id        uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('ink', 'photo')),
  ink_id          uuid REFERENCES app.ink_captures(id),
  photo_id        uuid REFERENCES app.photos(id),
  provider        text NOT NULL,
  result_text     text,                               -- MathText
  result_lines    jsonb,                              -- 拍照：[{text, bbox, conf}]
  confidence      real,
  cross_provider  text,
  cross_text      text,
  agree           boolean,
  latency_ms      integer,
  queue_ms        integer,
  cost_cny        numeric(10, 5),
  status          text NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'empty')),
  confirmed_text  text,
  edited          boolean,
  edit_distance   integer,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recognitions_attempt ON app.recognitions (attempt_id, created_at);

CREATE TABLE app.drafts (                             -- 服务端草稿备份（前端以 IndexedDB 为主）
  attempt_id  uuid NOT NULL REFERENCES app.attempts(id),
  target      text NOT NULL,
  content     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, target)
);

-- =====================================================================
-- 6. 求助、提示、批注、模型调用、闸门
-- =====================================================================
CREATE TABLE app.help_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid NOT NULL REFERENCES app.attempts(id),
  layer       text NOT NULL,
  intent      text NOT NULL CHECK (intent IN ('stuck', 'concept', 'check_line', 'free')),
  routed      text NOT NULL CHECK (routed IN ('stuck', 'concept', 'check_line', 'pressure', 'off_topic')),
  routed_by   text NOT NULL CHECK (routed_by IN ('chip', 'rule', 'jev', 'llm')),
  conf        real,
  text        text,                                   -- 学生自由输入（原文保留，研究用）
  line_id     uuid REFERENCES app.attempt_lines(id),
  outcome     text,                                   -- hint / concept / annotation / refusal / denied
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX help_requests_attempt ON app.help_requests (attempt_id, created_at);

CREATE TABLE app.hint_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES app.attempts(id),
  help_id       uuid REFERENCES app.help_requests(id),
  key_id        text NOT NULL,
  level         text NOT NULL CHECK (level IN ('H0', 'H1', 'H2', 'H3', 'H4')),
  cost          numeric(3, 1) NOT NULL,
  reveal_before numeric(4, 2) NOT NULL,
  reveal_after  numeric(4, 2) NOT NULL,
  text_shown    text NOT NULL,                        -- 实际下发文本（过闸门后）
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.annotations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES app.attempts(id),
  line_id       uuid REFERENCES app.attempt_lines(id),
  kind          text NOT NULL,
  source        text NOT NULL,
  text_shown    text NOT NULL,
  gate_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.model_calls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid REFERENCES app.attempts(id),
  import_job_id  uuid REFERENCES content.import_jobs(id),
  purpose        text NOT NULL,                       -- classify_step / route_help / gate_review / def_check / lesson_gen / ocr_cross / draft_a ...
  provider       text NOT NULL,                       -- typesafe / deepseek / dashscope / simpletex
  model          text NOT NULL,                       -- jev-1.13 / deepseek-flash / qwen3.8-flash ...
  model_version  text,                                -- 响应里返回的实际版本
  prompt_version text,
  input_hash     text NOT NULL,                       -- 输入内容哈希（原文不重复存）
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  cost_cny       numeric(12, 6),
  status         text NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'skipped')),
  shadow         boolean NOT NULL DEFAULT false,      -- 影子调用：结果只记录不生效
  output         jsonb,                               -- 结构化输出（Jev 概率、LLM JSON）
  confidence     real,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_calls_purpose ON app.model_calls (purpose, created_at);
CREATE INDEX model_calls_attempt ON app.model_calls (attempt_id) WHERE attempt_id IS NOT NULL;

CREATE TABLE app.gate_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid REFERENCES app.attempts(id),
  channel       text NOT NULL,
  text_hash     text NOT NULL,
  stages        jsonb NOT NULL,                       -- [{stage:'rule',hit:false},{stage:'jev',p:0.03},{stage:'cross',leak:false}]
  blocked       boolean NOT NULL,
  blocked_keys  text[] NOT NULL DEFAULT '{}',
  fallback      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 7. 诚信、教师干预、导出、审计
-- =====================================================================
CREATE TABLE app.integrity_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   uuid REFERENCES app.attempts(id),
  user_id      uuid NOT NULL REFERENCES app.users(id),
  signal       text NOT NULL,                         -- away_long / paste_burst / no_provenance / similarity / ai_style / multi_device / timing / capture
  score        real NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  source       text NOT NULL CHECK (source IN ('client', 'server')),
  disposition  text CHECK (disposition IN ('dismissed', 'noted', 'talked')),
  reviewed_by  uuid REFERENCES app.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integrity_signals_attempt ON app.integrity_signals (attempt_id, created_at);

CREATE TABLE app.help_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   uuid NOT NULL REFERENCES app.attempts(id),
  user_id      uuid NOT NULL REFERENCES app.users(id),
  layer        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by  uuid REFERENCES app.users(id),
  resolved_at  timestamptz,
  note         text
);

CREATE TABLE app.teacher_nudges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid NOT NULL REFERENCES app.attempts(id),
  teacher_id  uuid NOT NULL REFERENCES app.users(id),
  text_input  text NOT NULL,
  text_shown  text NOT NULL,                          -- 过闸门后的文本
  gated       boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES app.users(id),
  scope        jsonb NOT NULL,                        -- {classId, assignmentIds, tables}
  format       text NOT NULL CHECK (format IN ('csv', 'xlsx', 'jsonl')),
  anonymized   boolean NOT NULL DEFAULT true,
  approved_by  uuid REFERENCES app.users(id),         -- 实名导出须管理员审批
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'pending_approval', 'running', 'done', 'failed', 'expired')),
  file_key     text,
  row_count    integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE app.audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES app.users(id),
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  ip_masked  text,
  at         timestamptz NOT NULL DEFAULT now()
);

-- 派生指标（worker 定时刷新，供看板与导出；原始口径以事件为准）
CREATE TABLE app.attempt_metrics (
  attempt_id   uuid PRIMARY KEY REFERENCES app.attempts(id),
  metrics      jsonb NOT NULL,                        -- 见 08-事件与数据字典.md §4
  computed_at  timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 8. 只追加事件（按月分区）
-- =====================================================================
CREATE TABLE ev.ingest_ids (                          -- 幂等去重：同一事件 ID 只入库一次
  id           uuid PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ev.events (
  id              uuid NOT NULL,
  seq             bigint NOT NULL,
  type            text NOT NULL,
  source          text NOT NULL CHECK (source IN ('student', 'server', 'teacher')),
  ts_server       timestamptz NOT NULL DEFAULT now(),
  ts_client       timestamptz,
  session_id      uuid,
  device_id       uuid,
  client_seq      integer,
  user_id         uuid,
  user_anon       text NOT NULL,
  role            text NOT NULL,
  class_id        uuid,
  assignment_id   uuid,
  attempt_id      uuid,
  problem_id      text,
  problem_version integer,
  layer           text,
  mode            text,
  arm             text,
  app_version     text,
  platform        text,
  prompt_version  text,
  model_versions  jsonb,
  payload         jsonb NOT NULL,
  PRIMARY KEY (id, ts_server)
) PARTITION BY RANGE (ts_server);

CREATE TABLE ev.events_2026_11 PARTITION OF ev.events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE ev.events_2026_12 PARTITION OF ev.events FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE ev.events_2027_01 PARTITION OF ev.events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE ev.events_default PARTITION OF ev.events DEFAULT;   -- worker 每月 25 日预建下月分区

CREATE INDEX events_attempt_seq ON ev.events (attempt_id, seq);
CREATE INDEX events_class_time ON ev.events (class_id, ts_server);
CREATE INDEX events_type_time ON ev.events (type, ts_server);
CREATE INDEX events_user_time ON ev.events (user_id, ts_server);

CREATE FUNCTION ev.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ev.events is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER events_no_update BEFORE UPDATE OR DELETE ON ev.events
  FOR EACH ROW EXECUTE FUNCTION ev.append_only();

-- =====================================================================
-- 9. 角色与权限（部署时以超级用户执行；PGlite 校验时跳过）
-- =====================================================================
-- CREATE ROLE pg_app LOGIN;        -- 应用服务
-- CREATE ROLE pg_reviewer LOGIN;   -- 导入/审核 worker
-- CREATE ROLE pg_analyst LOGIN;    -- 只读研究导出（只看匿名视图）
-- GRANT USAGE ON SCHEMA app, content, ev TO pg_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app, content TO pg_app;
-- GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ev TO pg_app;          -- 事件只能插入
-- GRANT USAGE ON SCHEMA vault TO pg_app;
-- GRANT SELECT ON vault.problem_secrets TO pg_app;                     -- 引擎需要关键步骤与提示
-- REVOKE ALL ON vault.reference_proofs FROM pg_app;                    -- 参考证明只给 pg_reviewer
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA content, vault TO pg_reviewer;
-- GRANT INSERT ON vault.reference_access_log TO pg_app, pg_reviewer;
