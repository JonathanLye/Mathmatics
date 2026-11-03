import type { Queryable } from '../../db/index.ts';

// 08 §3 的教师服务端事件（t.assign / t.publish_review / t.nudge / t.resolve_flag / t.export / t.review_package）
// 必须由服务端在状态变化的同一事务里写；不带作答的事件按 ingest 的口径 seq=0（07 只规定按用户另计，无计数器）。
export interface TeacherEventInput {
  type: string;
  teacherId: string;
  classId: string;
  assignmentId?: string | null;
  problemId?: string | null;
  problemVersion?: number | null;
  payload: Record<string, unknown>;
}

export async function appendTeacherEvent(tx: Queryable, input: TeacherEventInput): Promise<void> {
  const anon = (
    await tx.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [input.teacherId])
  ).rows[0]?.anon_code;
  if (!anon) throw new Error(`教师账号缺失：${input.teacherId}`);

  await tx.query(
    `insert into ev.events
       (id, seq, type, source, ts_server, user_id, user_anon, role,
        class_id, assignment_id, problem_id, problem_version, payload)
     values (gen_random_uuid(), 0, $1, 'server', now(), $2, $3, 'teacher',
             $4, $5, $6, $7, $8::jsonb)`,
    [
      input.type,
      input.teacherId,
      anon,
      input.classId,
      input.assignmentId ?? null,
      input.problemId ?? null,
      input.problemVersion ?? null,
      JSON.stringify(input.payload),
    ],
  );
}
