import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';

// content.problem_versions.public 里首页用到的字段（problem-package.schema.json 的 public 子集）。
interface PublicProblem {
  title?: string;
  chapter?: string;
  stem?: string;
}

// 首页一次查询的扁平行：布置 + 学生自己的 main 作答（没有作答时为 null）。
// 用 type 而非 interface：Queryable.query 要求 Record<string, unknown>（隐式索引签名，见 view.ts）。
type HomeRow = {
  assignment_id: string;
  problem_id: string;
  mode: 'practice' | 'test';
  status: 'scheduled' | 'open' | 'closed' | 'cancelled';
  open_at: Date | string;
  close_at: Date | string | null;
  review_published_at: Date | string | null;
  public: PublicProblem;
  attempt_id: string | null;
  attempt_status: 'active' | 'parked' | 'locked' | 'completed' | 'abandoned' | null;
  current_layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | null;
}

// 作答可视为「进行中」的状态（06 §5 的 AttemptStatus 子集）。
const IN_PROGRESS = new Set(['active', 'parked', 'locked']);

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function toCard(row: HomeRow): Record<string, unknown> {
  const card: Record<string, unknown> = {
    assignmentId: row.assignment_id,
    title: row.public.title ?? row.problem_id,
    mode: row.mode,
    status: row.status,
    openAt: iso(row.open_at),
    closeAt: iso(row.close_at),
    attemptId: row.attempt_id,
    attemptStatus: row.attempt_status,
    currentLayer: row.current_layer,
    reviewPublished: row.review_published_at !== null,
  };
  if (row.public.chapter !== undefined) card.chapter = row.public.chapter;
  if (row.public.stem !== undefined) card.stem = row.public.stem;
  return card;
}

// GET /student/home（openapi StudentHome / #74）：学生所在班级布置的三分栏。
// 只做只读聚合，不判定层、预算或对错：前端只渲染服务端给的状态（12 §1）。
export async function studentHome(db: Db, contract: ContractValidator, userId: string): Promise<Record<string, unknown>> {
  const rows = (
    await db.query<HomeRow>(
      `select a.id as assignment_id, a.problem_id, a.mode, a.status, a.open_at, a.close_at,
              a.review_published_at, pv.public,
              att.id as attempt_id, att.status as attempt_status, att.current_layer
         from app.assignments a
         join app.class_members m on m.class_id = a.class_id and m.user_id = $1
         join content.problem_versions pv on pv.problem_id = a.problem_id and pv.version = a.problem_version
         left join app.attempts att on att.assignment_id = a.id and att.user_id = $1 and att.kind = 'main'
        where a.status <> 'cancelled' and a.origin = 'teacher'
        order by a.open_at desc, a.id`,
      [userId],
    )
  ).rows;

  const inProgress: Record<string, unknown>[] = [];
  const todo: Record<string, unknown>[] = [];
  const done: Record<string, unknown>[] = [];
  for (const row of rows) {
    const card = toCard(row);
    if (row.attempt_status === 'completed') done.push(card);
    else if (row.attempt_status !== null && IN_PROGRESS.has(row.attempt_status)) inProgress.push(card);
    else todo.push(card);
  }

  const dto: Record<string, unknown> = { inProgress, todo, done };
  contract.validate('StudentHome', dto);
  return dto;
}
