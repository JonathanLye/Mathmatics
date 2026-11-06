-- 重做（证明本/错题本）：attempts.kind 增加 'redo'。这是 07 §8「只增不改」的唯一例外：放宽一个 CHECK 的取值集合，
-- 不改任何已有行。同一父作答同时只能有一个未结束的重做。可重复执行。
ALTER TABLE app.attempts DROP CONSTRAINT IF EXISTS attempts_kind_check;
ALTER TABLE app.attempts ADD CONSTRAINT attempts_kind_check CHECK (kind IN ('main', 'transfer', 'redo'));
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_open_redo
  ON app.attempts (parent_attempt_id) WHERE kind = 'redo' AND status IN ('active', 'parked', 'locked');
