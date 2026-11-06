import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { notebookCounts } from './notebook.ts';

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
  title: string | null;
  chapter: string | null;
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
    title: row.title ?? row.problem_id,
    mode: row.mode,
    status: row.status,
    openAt: iso(row.open_at),
    closeAt: iso(row.close_at),
    attemptId: row.attempt_id,
    attemptStatus: row.attempt_status,
    currentLayer: row.current_layer,
    reviewPublished: row.review_published_at !== null,
  };
  // 首页不再带整段题面（题多时体积大）；路径与练习区的条目带截断的预览。
  if (row.chapter !== null) card.chapter = row.chapter;
  return card;
}

// GET /student/home（openapi StudentHome / #74）：学生所在班级布置的三分栏。
// 只做只读聚合，不判定层、预算或对错：前端只渲染服务端给的状态（12 §1）。
export async function studentHome(db: Db, contract: ContractValidator, userId: string): Promise<Record<string, unknown>> {
  const rows = (
    await db.query<HomeRow>(
      `select a.id as assignment_id, a.problem_id, a.mode, a.status, a.open_at, a.close_at,
              a.review_published_at, pv.public->>'title' as title, pv.public->>'chapter' as chapter,
              att.id as attempt_id, att.status as attempt_status, att.current_layer
         from app.assignments a
         join app.class_members m on m.class_id = a.class_id and m.user_id = $1 and m.role = 'student'
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

  // 本周（Asia/Shanghai，周一起）自己写出的关键步骤；只统计 kind='main'，重做与迁移题不计入。
  const week = (
    await db.query<{ keys_own: string; keys_total: string; problems_done: string }>(
      `select coalesce(sum(keys_own), 0)::text as keys_own, coalesce(sum(keys_total), 0)::text as keys_total,
              count(*) filter (where status = 'completed')::text as problems_done
         from app.attempts
        where user_id = $1 and kind = 'main'
          and (updated_at at time zone 'Asia/Shanghai') >= date_trunc('week', now() at time zone 'Asia/Shanghai')`,
      [userId],
    )
  ).rows[0];
  const dto: Record<string, unknown> = {
    inProgress,
    todo,
    done,
    week: {
      keysOwn: Number(week?.keys_own ?? 0),
      keysTotal: Number(week?.keys_total ?? 0),
      problemsDone: Number(week?.problems_done ?? 0),
    },
    notebook: await notebookCounts(db, userId),
  };
  contract.validate('StudentHome', dto);
  return dto;
}

// GET /student/assignments/{assignmentId}（openapi AssignmentCard）：只给本班学生；布置不存在或不在自己班里一律 404。
export async function studentAssignment(
  db: Db,
  contract: ContractValidator,
  userId: string,
  assignmentId: string,
): Promise<Record<string, unknown>> {
  const row = (
    await db.query<HomeRow & { problem_version: number }>(
      `select a.id as assignment_id, a.problem_id, a.problem_version, a.mode, a.status, a.open_at, a.close_at,
              a.review_published_at, pv.public,
              att.id as attempt_id, att.status as attempt_status, att.current_layer
         from app.assignments a
         join app.class_members m on m.class_id = a.class_id and m.user_id = $1
         join content.problem_versions pv on pv.problem_id = a.problem_id and pv.version = a.problem_version
         left join app.attempts att on att.assignment_id = a.id and att.user_id = $1 and att.kind = 'main'
        where a.id = $2 and a.status <> 'cancelled'`,
      [userId, assignmentId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '找不到这份布置');
  const card = { ...toCard(row), problemId: row.problem_id, version: row.problem_version };
  contract.validate('AssignmentCard', card);
  return card;
}
