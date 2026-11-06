import { decryptPii } from '../../auth/crypto.ts';
import type { AppConfig } from '../../config.ts';
import type { Queryable } from '../../db/index.ts';
import { ELIGIBLE_WHERE } from '../../path/common.ts';

import type { AuthContext } from '../../auth/session.ts';

import { assertClassTeacher } from './auth.ts';

function safeDecrypt(config: AppConfig, encrypted: Buffer | null): string | null {
  if (encrypted === null) return null;
  try {
    return decryptPii(config.piiKey, Buffer.from(encrypted));
  } catch {
    return null;
  }
}

// GET /teacher/classes/{classId}/self-study：自学（origin='path'）进度，单独成视图，不进看板、指标与导出。
// 每位学生在每个单元完成了几道题；进行中的题数、主动看过解答的题数。
export async function buildSelfStudy(
  db: Queryable,
  config: AppConfig,
  auth: AuthContext,
  classId: string,
): Promise<Record<string, unknown>> {
  await assertClassTeacher(db, auth, classId);

  const units = (
    await db.query<{ id: string; chapter_no: number; unit_no: number; title: string; total: string }>(
      `select cu.id, cu.chapter_no, cu.unit_no, cu.title, count(p.id)::text as total
         from content.course_units cu
         join content.unit_items ui on ui.unit_id = cu.id
         join content.problems p on p.id = ui.problem_id
         join content.problem_versions pv on pv.problem_id = p.id and pv.version = p.current_version and pv.review_status = 'published'
        where ${ELIGIBLE_WHERE}
        group by cu.id, cu.chapter_no, cu.unit_no, cu.title
        order by cu.chapter_no, cu.unit_no`,
    )
  ).rows;

  const roster = (
    await db.query<{ user_id: string; name_enc: Buffer | null; anon_code: string }>(
      `select r.claimed_by as user_id, r.name_enc, u.anon_code
         from app.roster_entries r join app.users u on u.id = r.claimed_by
        where r.class_id = $1 and r.claimed_by is not null
        order by r.imported_at`,
      [classId],
    )
  ).rows;

  // 本班自学布置下每人每题的最好一次作答。
  const attempts = (
    await db.query<{ user_id: string; problem_id: string; status: string; updated_at: Date | string }>(
      `select distinct on (a.user_id, a.problem_id) a.user_id, a.problem_id, a.status, a.updated_at
         from app.attempts a join app.assignments asg on asg.id = a.assignment_id
        where asg.class_id = $1 and asg.origin = 'path' and a.kind = 'main' and a.status <> 'abandoned'
        order by a.user_id, a.problem_id, (a.status = 'completed') desc, a.started_at desc`,
      [classId],
    )
  ).rows;
  const unitOfProblem = (
    await db.query<{ unit_id: string; problem_id: string }>(
      `select ui.unit_id, ui.problem_id from content.unit_items ui
         join content.problems p on p.id = ui.problem_id
         join content.problem_versions pv on pv.problem_id = p.id and pv.version = p.current_version and pv.review_status = 'published'
        where ${ELIGIBLE_WHERE}`,
    )
  ).rows;
  const unitsByProblem = new Map<string, string[]>();
  for (const row of unitOfProblem) unitsByProblem.set(row.problem_id, [...(unitsByProblem.get(row.problem_id) ?? []), row.unit_id]);

  const reveals = (
    await db.query<{ user_id: string; n: string }>(
      `select r.user_id, count(distinct r.problem_id)::text as n
         from app.solution_reveals r
         join app.class_members m on m.class_id = $1 and m.user_id = r.user_id
        group by r.user_id`,
      [classId],
    )
  ).rows;
  const revealed = new Map(reveals.map((r) => [r.user_id, Number(r.n)]));

  const students = roster.map((student) => {
    const mine = attempts.filter((a) => a.user_id === student.user_id);
    const byUnit = new Map<string, number>();
    for (const attempt of mine) {
      if (attempt.status !== 'completed') continue;
      for (const unitId of unitsByProblem.get(attempt.problem_id) ?? []) byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + 1);
    }
    const last = mine.map((a) => new Date(a.updated_at).getTime()).sort((a, b) => b - a)[0];
    return {
      anonCode: student.anon_code,
      displayName: safeDecrypt(config, student.name_enc),
      doneTotal: mine.filter((a) => a.status === 'completed').length,
      active: mine.filter((a) => a.status !== 'completed').length,
      revealed: revealed.get(student.user_id) ?? 0,
      lastActiveAt: last === undefined ? null : new Date(last).toISOString(),
      byUnit: units.map((u) => ({ unitId: u.id, done: byUnit.get(u.id) ?? 0 })),
    };
  });

  return {
    units: units.map((u) => ({ id: u.id, chapterNo: u.chapter_no, unitNo: u.unit_no, title: u.title, total: Number(u.total) })),
    students,
  };
}
