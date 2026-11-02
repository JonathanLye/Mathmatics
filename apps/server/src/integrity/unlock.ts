import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { nextSeq } from './seq.ts';

// 教师解锁一次锁定的作答（11 §5.2）。
// 只写 attempt.unlock{by}。不带 grantH4：补发 H4 需要引擎命令，见 issue #31 的交接项。
// 教师必须是该班级的所有者，或该班级里 role=teacher 的成员；否则返回 404（不泄露作答是否存在）。
export async function unlockAttempt(db: Db, input: { teacherId: string; attemptId: string }): Promise<void> {
  await db.tx(async (tx) => {
    const found = await tx.query<{ status: string; assignment_id: string; class_id: string; user_id: string }>(
      `select a.status, a.assignment_id, asg.class_id, a.user_id
         from app.attempts a
         join app.assignments asg on asg.id = a.assignment_id
        where a.id = $1
        for update of a`,
      [input.attemptId],
    );
    const row = found.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '作答不存在');

    const authorized = await tx.query(
      `select 1 from app.classes c where c.id = $1 and c.owner_id = $2
       union all
       select 1 from app.class_members m where m.class_id = $1 and m.user_id = $2 and m.role = 'teacher'
       limit 1`,
      [row.class_id, input.teacherId],
    );
    if (authorized.rows.length === 0) throw new AppError('NOT_FOUND', 404, '作答不存在');

    if (row.status !== 'locked') throw new AppError('ATTEMPT_NOT_LOCKED', 409, '这次作答没有被锁定');

    await tx.query(`update app.attempts set status = 'active', locked_reason = null where id = $1`, [input.attemptId]);
    const seq = await nextSeq(tx, input.attemptId);
    const by = (await tx.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [input.teacherId]))
      .rows[0]?.anon_code ?? 'unknown';
    await tx.query(
      `insert into ev.events
         (id, seq, type, source, ts_server, user_id, user_anon, role, assignment_id, attempt_id, problem_id, problem_version, mode, payload)
       select gen_random_uuid(), $2, 'attempt.unlock', 'teacher', now(), a.user_id, u.anon_code, 'student', a.assignment_id, a.id,
              a.problem_id, a.problem_version, a.mode, $3::jsonb
         from app.attempts a
         join app.users u on u.id = a.user_id
        where a.id = $1`,
      [input.attemptId, seq, JSON.stringify({ by })],
    );
  });
}
