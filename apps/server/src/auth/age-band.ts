import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 13 §4：未成年人分档。档位存在 app.student_profiles.age_band；null 表示尚未选择。
// <14 不开通（需监护人同意的流程本期不做）；14–17 可用，同意书附加「建议告知监护人」。
export type AgeBand = 'lt14' | '14to17' | 'ge18';

export function isAgeBand(value: unknown): value is AgeBand {
  return value === 'lt14' || value === '14to17' || value === 'ge18';
}

export async function getAgeBand(db: Queryable, userId: string): Promise<AgeBand | null> {
  const row = (
    await db.query<{ age_band: string | null }>(`select age_band from app.student_profiles where user_id = $1`, [userId])
  ).rows[0];
  return isAgeBand(row?.age_band) ? row.age_band : null;
}

// 只允许设置一次：已记录时 409 AGE_BAND_LOCKED。条件 UPDATE 同时兜住并发（两个请求只有一个成功），
// 也保证 <14 不能通过重新提交 ge18 自我解锁（13 §4 的「不开通」必须是硬约束）。
export async function setAgeBandOnce(db: Queryable, userId: string, band: AgeBand): Promise<void> {
  const rows = (
    await db.query<{ user_id: string }>(
      `update app.student_profiles set age_band = $2 where user_id = $1 and age_band is null returning user_id`,
      [userId, band],
    )
  ).rows;
  if (rows.length > 0) return;
  const existing = await db.query<{ age_band: string | null }>(
    `select age_band from app.student_profiles where user_id = $1`,
    [userId],
  );
  if (existing.rows.length === 0) throw new AppError('NOT_FOUND', 404, '学生档案不存在');
  throw new AppError('AGE_BAND_LOCKED', 409, '年龄段已记录，如需修改请联系老师');
}

