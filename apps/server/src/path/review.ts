import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { hasOpenTest } from './common.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /attempts/{attemptId}/review（06 §5）：可看时返回已标记可发布的参考证明与讲评。
//  - 自学作答（origin='path'）：自己完成后即可看；
//  - 教师布置：布置关闭且教师已发布讲评后才可看；
//  - 班里这道题还有没结束的测验时，一律不给（否则早交卷的人能把答案带给还在考的同学）。
export async function getPublishedReview(db: Db, userId: string, attemptId: string): Promise<Record<string, unknown>> {
  if (!UUID.test(attemptId)) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
  const row = (
    await db.query<{
      user_id: string;
      problem_id: string;
      problem_version: number;
      status: string;
      origin: 'teacher' | 'path';
      published: boolean;
      closed: boolean;
      review_note: string | null;
    }>(
      `select a.user_id, a.problem_id, a.problem_version, a.status, asg.origin,
              asg.review_published_at is not null as published, asg.review_note,
              (asg.status in ('closed', 'cancelled') or (asg.close_at is not null and asg.close_at <= now())) as closed
         from app.attempts a join app.assignments asg on asg.id = a.assignment_id
        where a.id = $1`,
      [attemptId],
    )
  ).rows[0];
  if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', 404, '找不到这次作答');

  const open = row.origin === 'path' ? row.status === 'completed' : row.published && row.closed;
  if (!open) throw new AppError('FORBIDDEN', 403, '讲评现在还不能看');
  if (await hasOpenTest(db, userId, row.problem_id)) {
    throw new AppError('FORBIDDEN', 403, '这道题老师正在用作测验，测验结束后再看讲评');
  }

  const proofs = (
    await db.query<{ text: string }>(
      `select text from vault.reference_proofs
        where problem_id = $1 and version = $2 and publishable
        order by route nulls last, proof_id`,
      [row.problem_id, row.problem_version],
    )
  ).rows.map((r) => r.text);
  await db.query(
    `insert into vault.reference_access_log (user_id, problem_id, version, purpose) values ($1, $2, $3, 'review')`,
    [userId, row.problem_id, row.problem_version],
  );
  const body: Record<string, unknown> = { proofs };
  if (row.review_note !== null && row.review_note !== '') body.note = row.review_note;
  return body;
}
