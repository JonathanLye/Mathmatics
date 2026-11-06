import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 学习路径与练习区共用的小工具：难度档、题面预览、可练题的判据、测验撞车守卫、学生的班级。

export type DifficultyBand = 'easy' | 'medium' | 'hard';

// 题目包 public.difficulty 取值 1–5（problem-package.schema.json）。学生看到三档：入门 / 进阶 / 挑战。
// 这是全服务端唯一的映射：筛选、分面、路径与练习区的条目都用它。
export function difficultyBand(difficulty: number | null | undefined): DifficultyBand {
  const n = Number(difficulty);
  if (!Number.isFinite(n) || n <= 2) return 'easy';
  if (n === 3) return 'medium';
  return 'hard';
}

export const BAND_ORDER: readonly DifficultyBand[] = ['easy', 'medium', 'hard'];

// 题面预览：最多 max 个字符，且不把 $…$ 公式从中间截断（未转义的 $ 成对；落在公式里就退回到该 $ 之前）。
export function stemPreview(stem: string | null | undefined, max = 120): string {
  const text = (stem ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let cut = max;
  // 不在转义的 \$ 或 surrogate pair 中间截断。
  while (cut > 0 && text[cut - 1] === '\\') cut -= 1;
  let open = -1;
  for (let i = 0; i < cut; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '$') open = open === -1 ? i : -1;
  }
  if (open !== -1) cut = open;
  const head = text.slice(0, cut).trimEnd();
  return head === '' ? '…' : `${head}…`;
}

// 可进入路径与练习区的题：未下架、主题（不是迁移题）、有已发布的当前版本、
// 有 secret 与至少一份参考证明（“挑出来的题一定完整、可以证明”），且不是测试卷/备用题。
// 别名约定：p = content.problems，pv = 当前已发布版本。
export const ELIGIBLE_FROM = `
  from content.problems p
  join content.problem_versions pv
    on pv.problem_id = p.id and pv.version = p.current_version and pv.review_status = 'published'`;
export const ELIGIBLE_WHERE = `
  p.hidden_at is null and p.kind = 'main'
  and coalesce(pv.public->>'role', 'required') in ('required', 'optional')
  and exists (select 1 from vault.problem_secrets s where s.problem_id = p.id and s.version = pv.version)
  and exists (select 1 from vault.reference_proofs r where r.problem_id = p.id and r.version = pv.version)`;

export interface StudentClass {
  classId: string;
  ownerId: string;
}

// 学生当前所在的班级，最近加入的在前。
export async function studentClasses(q: Queryable, userId: string): Promise<StudentClass[]> {
  const rows = (
    await q.query<{ class_id: string; owner_id: string }>(
      `select m.class_id, c.owner_id
         from app.class_members m join app.classes c on c.id = m.class_id
        where m.user_id = $1 and m.role = 'student' and m.left_at is null and c.archived_at is null
        order by m.joined_at desc, m.class_id`,
      [userId],
    )
  ).rows;
  return rows.map((row) => ({ classId: row.class_id, ownerId: row.owner_id }));
}

// 测验撞车：学生所在任一班里，这道题（任意版本）有还没结束的测验（含尚未开放的）。
// 自学入口、练习区、解答、讲评都要过这一道：否则早交卷的同学能从这里看到参考解答。
// 截止以数据库时钟为准；已取消、已关闭的不算。
export async function hasOpenTest(q: Queryable, userId: string, problemId: string): Promise<boolean> {
  const rows = (
    await q.query(
      `select 1
         from app.assignments a
         join app.class_members m on m.class_id = a.class_id and m.user_id = $1 and m.left_at is null
        where a.problem_id = $2 and a.mode = 'test' and a.origin = 'teacher'
          and a.status in ('scheduled', 'open')
          and (a.close_at is null or a.close_at > now())
        limit 1`,
      [userId, problemId],
    )
  ).rows;
  return rows.length > 0;
}

export async function assertNoOpenTest(q: Queryable, userId: string, problemId: string): Promise<void> {
  if (await hasOpenTest(q, userId, problemId)) {
    throw new AppError('TEST_IN_PROGRESS', 409, '这道题老师正在用作测验，等测验结束后再来练习');
  }
}

export type NodeState = 'todo' | 'active' | 'done';

export interface ProblemProgress {
  problemId: string;
  attemptId: string;
  assignmentId: string;
  attemptStatus: string;
  currentLayer: string;
  layerStatus: Record<string, string>;
  origin: 'teacher' | 'path';
  mode: 'practice' | 'test';
  reviewPublishedAt: Date | string | null;
  assignmentClosed: boolean;
}

// 学生在每道题上的最好一次主作答（同一题可能出现在多个布置里）：已完成的优先，其次最近开始的。
// 只算有效的：已完成，或所在布置仍开放（已关闭的未完成作答不算进行中）。
export async function progressByProblem(q: Queryable, userId: string): Promise<Map<string, ProblemProgress>> {
  const rows = (
    await q.query<{
      problem_id: string;
      attempt_id: string;
      assignment_id: string;
      status: string;
      current_layer: string;
      layer_status: Record<string, string> | null;
      origin: 'teacher' | 'path';
      mode: 'practice' | 'test';
      review_published_at: Date | string | null;
      closed: boolean;
    }>(
      `select distinct on (a.problem_id)
              a.problem_id, a.id as attempt_id, a.assignment_id, a.status, a.current_layer,
              a.state->'status' as layer_status, asg.origin, a.mode, asg.review_published_at,
              (asg.status in ('closed', 'cancelled') or (asg.close_at is not null and asg.close_at <= now())) as closed
         from app.attempts a
         join app.assignments asg on asg.id = a.assignment_id
        where a.user_id = $1 and a.kind = 'main' and a.status <> 'abandoned'
          and (a.status = 'completed'
               or (asg.status = 'open' and (asg.close_at is null or asg.close_at > now())))
        order by a.problem_id, (a.status = 'completed') desc, a.started_at desc`,
      [userId],
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      row.problem_id,
      {
        problemId: row.problem_id,
        attemptId: row.attempt_id,
        assignmentId: row.assignment_id,
        attemptStatus: row.status,
        currentLayer: row.current_layer,
        layerStatus: row.layer_status ?? {},
        origin: row.origin,
        mode: row.mode,
        reviewPublishedAt: row.review_published_at,
        assignmentClosed: row.closed,
      },
    ]),
  );
}

export function nodeStateOf(progress: ProblemProgress | undefined): NodeState {
  if (!progress) return 'todo';
  return progress.attemptStatus === 'completed' ? 'done' : 'active';
}

// 已完成的层数（done / skip）：引擎状态里 status[n] 为 'done' | 'skip' | 'disabled'。
export function layersDoneOf(progress: ProblemProgress | undefined): number {
  if (!progress) return 0;
  return Object.values(progress.layerStatus).filter((s) => s === 'done' || s === 'skip').length;
}

// 讲评是否可看：自学作答完成即可；教师布置要等教师发布。
export function reviewOpenFor(progress: ProblemProgress | undefined): boolean {
  if (!progress) return false;
  if (progress.origin === 'path') return progress.attemptStatus === 'completed';
  return progress.reviewPublishedAt !== null && progress.assignmentClosed;
}
