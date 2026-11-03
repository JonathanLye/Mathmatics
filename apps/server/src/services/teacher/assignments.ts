import type { AuthContext } from '../../auth/session.ts';
import type { Db, Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { assertClassTeacher } from './auth.ts';
import { appendTeacherEvent } from './events.ts';
import { toAssignmentCard, type AssignmentCardRow } from './view.ts';

export interface AssignmentInput {
  classId: string;
  problemId: string;
  version: number;
  mode: 'practice' | 'test';
  openAt: string;
  closeAt?: string | null;
  settings?: unknown;
}

export interface PublishReviewInput {
  proofIds?: string[];
  note?: string;
}

// openapi AssignmentCreate.settings 的六个键；白名单存储，防止任意 JSON 写进 assignments.settings。
const ASSIGNMENT_SETTINGS_KEYS = [
  'layers',
  'revealBudget',
  'photoEnabled',
  'hintsEnabled',
  'maxSwitches',
  'durationMin',
] as const;

function normalizeAssignmentSettings(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input !== null && typeof input === 'object') {
    for (const key of ASSIGNMENT_SETTINGS_KEYS) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

function parseTime(value: string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError('VALIDATION_FAILED', 422, `${label}时间格式不对`);
  return date;
}

// 04 §7：只能选已发布版本。SQL 外键只保证版本存在，不保证 review_status。
async function loadPublishedProblem(db: Queryable, problemId: string, version: number): Promise<void> {
  const row = (
    await db.query<{ review_status: string }>(
      `select review_status from content.problem_versions where problem_id = $1 and version = $2`,
      [problemId, version],
    )
  ).rows[0];
  if (!row || row.review_status !== 'published') {
    throw new AppError('VALIDATION_FAILED', 422, '只能布置已发布的题目版本');
  }
}

// 06 §5：布置状态一律按数据库时钟推导。当前没有 scheduled → open 的调度器（worker 属 B），
// 所以“未来开放”的布置暂时永远不会自动开；但 close_at 已过的布置必须在读取时就返回 closed。
const DERIVED_STATUS_SQL = `
  case
    when a.status = 'cancelled' then 'cancelled'
    when a.close_at is not null and a.close_at <= now() then 'closed'
    when a.open_at <= now() then 'open'
    else 'scheduled'
  end`;

async function assignmentCardById(q: Queryable, assignmentId: string): Promise<Record<string, unknown>> {
  const row = (
    await q.query<AssignmentCardRow>(
      `select a.id, pv.public, a.mode, ${DERIVED_STATUS_SQL} as status,
              a.open_at, a.close_at, a.review_published_at
         from app.assignments a
         join content.problem_versions pv
           on pv.problem_id = a.problem_id and pv.version = a.problem_version
        where a.id = $1`,
      [assignmentId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '布置不存在');
  return toAssignmentCard(row);
}

type AssignmentOwnerRow = {
  class_id: string;
  problem_id: string;
  problem_version: number;
  mode: string;
  status: string;
  close_at: Date | string | null;
  // 06 §5：关闭判定用数据库时钟，不用应用进程的 Date.now()。
  time_closed: boolean;
}

async function findAssignment(q: Queryable, assignmentId: string): Promise<AssignmentOwnerRow> {
  const row = (
    await q.query<AssignmentOwnerRow>(
      `select class_id, problem_id, problem_version, mode, status, close_at,
              (close_at is not null and close_at <= now()) as time_closed
         from app.assignments where id = $1`,
      [assignmentId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '布置不存在');
  return row;
}

export async function createAssignment(
  db: Db,
  auth: AuthContext,
  input: AssignmentInput,
): Promise<Record<string, unknown>> {
  await assertClassTeacher(db, auth, input.classId);
  const openAt = parseTime(input.openAt, '开放');
  if (openAt === null) throw new AppError('VALIDATION_FAILED', 422, '开放时间必填');
  const closeAt = parseTime(input.closeAt, '截止');
  if (closeAt !== null && closeAt.getTime() <= openAt.getTime()) {
    throw new AppError('VALIDATION_FAILED', 422, '截止时间必须晚于开放时间');
  }
  // 04 §7：测验的开放与截止都必填；练习允许不设截止。
  if (input.mode === 'test' && closeAt === null) {
    throw new AppError('VALIDATION_FAILED', 422, '测验必须设置截止时间');
  }
  await loadPublishedProblem(db, input.problemId, input.version);
  const settings = normalizeAssignmentSettings(input.settings);

  return db.tx(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `insert into app.assignments
         (class_id, problem_id, problem_version, mode, open_at, close_at, settings, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb,
               case
                 when $6::timestamptz is not null and $6::timestamptz <= now() then 'closed'
                 when $5::timestamptz <= now() then 'open'
                 else 'scheduled'
               end,
               $8)
       returning id`,
      [
        input.classId,
        input.problemId,
        input.version,
        input.mode,
        openAt,
        closeAt,
        JSON.stringify(settings),
        auth.userId,
      ],
    );
    const assignmentId = inserted.rows[0]?.id;
    if (!assignmentId) throw new Error('insert app.assignments 没有返回 id');
    await appendTeacherEvent(tx, {
      type: 't.assign',
      teacherId: auth.userId,
      classId: input.classId,
      assignmentId,
      problemId: input.problemId,
      problemVersion: input.version,
      payload: { assignmentId, mode: input.mode, problemId: input.problemId, version: input.version },
    });
    return assignmentCardById(tx, assignmentId);
  });
}

export async function updateAssignment(
  db: Db,
  auth: AuthContext,
  assignmentId: string,
  input: AssignmentInput,
): Promise<Record<string, unknown>> {
  const existing = await findAssignment(db, assignmentId);
  await assertClassTeacher(db, auth, existing.class_id);
  if (input.classId !== existing.class_id) throw new AppError('NOT_FOUND', 404, '布置不存在');

  // 04 §7：已开始的作答固定在开题版本；已有作答时不允许更换题目/模式，避免“同一布置两种题”。
  const attempts = (
    await db.query<{ n: string }>(`select count(*)::text as n from app.attempts where assignment_id = $1`, [
      assignmentId,
    ])
  ).rows[0]?.n;
  const changedProblem =
    input.problemId !== existing.problem_id ||
    input.version !== existing.problem_version ||
    input.mode !== existing.mode;
  if (Number(attempts ?? 0) > 0 && changedProblem) {
    throw new AppError('VALIDATION_FAILED', 422, '已有作答，不能更换题目或模式');
  }

  const openAt = parseTime(input.openAt, '开放');
  if (openAt === null) throw new AppError('VALIDATION_FAILED', 422, '开放时间必填');
  const closeAt = parseTime(input.closeAt, '截止');
  if (closeAt !== null && closeAt.getTime() <= openAt.getTime()) {
    throw new AppError('VALIDATION_FAILED', 422, '截止时间必须晚于开放时间');
  }
  if (input.mode === 'test' && closeAt === null) {
    throw new AppError('VALIDATION_FAILED', 422, '测验必须设置截止时间');
  }
  await loadPublishedProblem(db, input.problemId, input.version);
  const settings = normalizeAssignmentSettings(input.settings);

  return db.tx(async (tx) => {
    await tx.query(
      `update app.assignments
          set problem_id = $2, problem_version = $3, mode = $4, open_at = $5, close_at = $6,
              settings = $7::jsonb,
              status = case
                when $6::timestamptz is not null and $6::timestamptz <= now() then 'closed'
                when $5::timestamptz <= now() then 'open'
                else 'scheduled'
              end
        where id = $1`,
      [
        assignmentId,
        input.problemId,
        input.version,
        input.mode,
        openAt,
        closeAt,
        JSON.stringify(settings),
      ],
    );
    await appendTeacherEvent(tx, {
      type: 't.assign',
      teacherId: auth.userId,
      classId: existing.class_id,
      assignmentId,
      problemId: input.problemId,
      problemVersion: input.version,
      payload: { assignmentId, mode: input.mode, problemId: input.problemId, version: input.version },
    });
    return assignmentCardById(tx, assignmentId);
  });
}

// 04 §6：布置关闭后发布参考证明与讲评；A/B 两组同时发布（同一布置）。参考证明读取必须记审计（05 §7）。
export async function publishReview(
  db: Db,
  auth: AuthContext,
  assignmentId: string,
  input: PublishReviewInput,
): Promise<Record<string, unknown>> {
  const existing = await findAssignment(db, assignmentId);
  await assertClassTeacher(db, auth, existing.class_id);

  // 06 §5：是否关闭以数据库时钟为准，不用应用进程的 Date.now()。
  if (existing.status !== 'closed' && !existing.time_closed) {
    throw new AppError('VALIDATION_FAILED', 409, '布置尚未关闭，不能发布讲评');
  }

  const proofIds = [...new Set(input.proofIds ?? [])];
  if (proofIds.length > 0) {
    const rows = (
      await db.query<{ proof_id: string; publishable: boolean }>(
        `select proof_id, publishable from vault.reference_proofs
          where problem_id = $1 and version = $2 and proof_id = any($3::text[])`,
        [existing.problem_id, existing.problem_version, proofIds],
      )
    ).rows;
    const publishable = new Set(rows.filter((row) => row.publishable).map((row) => row.proof_id));
    const missing = proofIds.filter((id) => !publishable.has(id));
    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 422, '参考证明不存在或不可发布', { proofIds: missing });
    }
  }

  await db.tx(async (tx) => {
    await tx.query(`update app.assignments set review_published_at = now(), review_note = $2 where id = $1`, [
      assignmentId,
      input.note ?? null,
    ]);
    await tx.query(
      `insert into vault.reference_access_log (user_id, problem_id, version, purpose)
       values ($1, $2, $3, 'publish')`,
      [auth.userId, existing.problem_id, existing.problem_version],
    );
    // P2-2：本轮不新增“发布选择表”（需 B 的契约/schema）；把 proofIds 选择写进 audit_log 以便追溯，
    // 语义：P0 发布该版本全部 publishable 证明，proofIds 仅做校验与审计记录。
    await tx.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'publish_review', $2, $3::jsonb)`,
      [auth.userId, assignmentId, JSON.stringify({ proofIds })],
    );
    await appendTeacherEvent(tx, {
      type: 't.publish_review',
      teacherId: auth.userId,
      classId: existing.class_id,
      assignmentId,
      problemId: existing.problem_id,
      problemVersion: existing.problem_version,
      payload: { assignmentId },
    });
  });

  return assignmentCardById(db, assignmentId);
}
