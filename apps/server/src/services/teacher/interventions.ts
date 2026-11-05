import { deserializeState, gateRule } from '@proof-gym/engine';

import type { AuthContext } from '../../auth/session.ts';
import type { Db, Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { unlockAttempt } from '../../integrity/unlock.ts';
import { nextSeq } from '../../integrity/seq.ts';
import { loadProblem } from '../../attempts/problem.ts';
import { createAttemptService } from '../../attempts/service.ts';
import type { ContractValidator } from '../../contract.ts';
import { loadTeacherAttempt } from './auth.ts';
import { appendTeacherAttemptEvent } from './events.ts';

export interface ResolveFlagInput {
  disposition?: 'dismissed' | 'noted' | 'talked';
  note?: string;
}

// 04 §6：发一句话 ≤200 字，过闸门（规则层；Jev/Qwen 复核在 09 §7 属 B 的通道）。
// 被拦时不发送，返回 {shown:'', gated:true}（契约只有这两个字段）；同时落库/事件/审计。
export async function nudgeStudent(
  db: Db,
  auth: AuthContext,
  attemptId: string,
  text: string,
): Promise<{ shown: string; gated: boolean }> {
  if (text.length > 200) throw new AppError('VALIDATION_FAILED', 422, '一句话不能超过 200 字');
  const row = await loadTeacherAttempt(db, auth, attemptId);
  const problem = await loadProblem(db, row.problem_id, row.problem_version);
  const state = deserializeState(row.state);
  const gate = gateRule(problem.ctx.pkg.secret, text, state.hint.matched, []);
  const gated = !gate.ok;
  const shown = gated ? '' : text;

  await db.tx(async (tx) => {
    await tx.query(`select id from app.attempts where id = $1 for update`, [attemptId]);
    await tx.query(
      `insert into app.teacher_nudges (attempt_id, teacher_id, text_input, text_shown, gated)
       values ($1, $2, $3, $4, $5)`,
      [attemptId, auth.userId, text, shown, gated],
    );
    const seq = await nextSeq(tx, attemptId);
    await appendTeacherAttemptEvent(tx, {
      type: 't.nudge',
      seq,
      teacherId: auth.userId,
      classId: row.class_id,
      attemptId,
      assignmentId: row.assignment_id,
      problemId: row.problem_id,
      problemVersion: row.problem_version,
      layer: row.current_layer,
      mode: row.mode,
      payload: { gated },
    });
    await tx.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'nudge', $2, $3::jsonb)`,
      [auth.userId, attemptId, JSON.stringify({ gated })],
    );
  });

  return { shown, gated };
}

// 04 §6 / 08 §3：处理求助标记或诚信信号。flagId 可能是 app.help_flags.id 或 app.integrity_signals.id。
export async function resolveFlag(
  db: Db,
  auth: AuthContext,
  flagId: string,
  input: ResolveFlagInput,
): Promise<void> {
  const disposition = input.disposition ?? 'noted';

  const helpFlag = (
    await db.query<{ attempt_id: string }>(`select attempt_id from app.help_flags where id = $1`, [flagId])
  ).rows[0];
  if (helpFlag) {
    const row = await loadTeacherAttempt(db, auth, helpFlag.attempt_id);
    await db.tx(async (tx) => {
      await tx.query(
        `update app.help_flags set resolved_by = $2, resolved_at = coalesce(resolved_at, now()), note = coalesce($3, note)
          where id = $1`,
        [flagId, auth.userId, input.note ?? null],
      );
      const seq = await nextSeq(tx, row.id);
      await appendTeacherAttemptEvent(tx, {
        type: 't.resolve_flag',
        seq,
        teacherId: auth.userId,
        classId: row.class_id,
        attemptId: row.id,
        assignmentId: row.assignment_id,
        problemId: row.problem_id,
        problemVersion: row.problem_version,
        layer: row.current_layer,
        mode: row.mode,
        payload: { flagId },
      });
      await tx.query(
        `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'resolve_flag', $2, $3::jsonb)`,
        [auth.userId, flagId, JSON.stringify({ kind: 'help', disposition, note: input.note ?? null })],
      );
    });
    return;
  }

  const signal = (
    await db.query<{ attempt_id: string | null }>(`select attempt_id from app.integrity_signals where id = $1`, [
      flagId,
    ])
  ).rows[0];
  if (!signal?.attempt_id) throw new AppError('NOT_FOUND', 404, '标记不存在');
  const row = await loadTeacherAttempt(db, auth, signal.attempt_id);
  await db.tx(async (tx) => {
    await tx.query(
      `update app.integrity_signals
          set disposition = $2, reviewed_by = $3, reviewed_at = coalesce(reviewed_at, now())
        where id = $1`,
      [flagId, disposition, auth.userId],
    );
    const seq = await nextSeq(tx, row.id);
    await appendTeacherAttemptEvent(tx, {
      type: 't.resolve_flag',
      seq,
      teacherId: auth.userId,
      classId: row.class_id,
      attemptId: row.id,
      assignmentId: row.assignment_id,
      problemId: row.problem_id,
      problemVersion: row.problem_version,
      layer: row.current_layer,
      mode: row.mode,
      payload: { flagId },
    });
    await tx.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'resolve_flag', $2, $3::jsonb)`,
      [auth.userId, flagId, JSON.stringify({ kind: 'integrity', disposition, note: input.note ?? null })],
    );
  });
}

// 04 §6 / 11 §5.2：解锁复用 B 的 unlockAttempt（不复制状态机逻辑）。
// 带 grantH4（关键步骤 ID，可为空串表示"下一个未完成的步骤"）时走软着陆：只在学生额度耗尽后补发一条 H4，
// 由引擎的 teacher.grant_h4 命令产生 hint.deliver{override:true}（不增加 reveal；学生需补 ≥6 字依据才计入；
// 完成时 attempt.complete.teacherOverrides 记录，独立度不计为"独立完成"），同时解除锁定并写 attempt.unlock{by, grantH4}。
export async function unlockForTeacher(
  db: Db,
  auth: AuthContext,
  attemptId: string,
  grantH4: string | undefined,
  contract: ContractValidator,
): Promise<void> {
  if (grantH4 !== undefined) {
    if (auth.role === 'admin') {
      throw new AppError('FORBIDDEN', 403, '管理员补发暂不支持（04 §1 的“管理员看全部”后续补）');
    }
    await createAttemptService(db, contract).grantH4({
      attemptId,
      keyId: grantH4 === '' ? undefined : grantH4,
      teacherAnon: (await db.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [auth.userId])).rows[0]?.anon_code ?? 'unknown',
      authorize: async (tx, row) => {
        await loadTeacherAttempt(tx, auth, row.id);
      },
    });
    await db.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'unlock', $2, $3::jsonb)`,
      [auth.userId, attemptId, JSON.stringify({ grantH4: grantH4 === '' ? 'next' : grantH4 })],
    );
    return;
  }
  await loadTeacherAttempt(db, auth, attemptId);
  if (auth.role === 'admin') {
    throw new AppError('FORBIDDEN', 403, '管理员解锁暂不支持（04 §1 的“管理员看全部”后续补）');
  }
  try {
    await unlockAttempt(db, { teacherId: auth.userId, attemptId });
  } catch (error) {
    if (error instanceof AppError && error.code === 'ATTEMPT_NOT_LOCKED') {
      throw new AppError('VALIDATION_FAILED', 409, '这次作答没有被锁定');
    }
    throw error;
  }
  await db.query(
    `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'unlock', $2, $3::jsonb)`,
    [auth.userId, attemptId, JSON.stringify({})],
  );
}

// 供测试/路由复用：确认 flagId 是 uuid（非 uuid 直接 404，避免 SQL 报错）。
export function ensureUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError('NOT_FOUND', 404, '标记不存在');
  }
}

export type { Queryable };
