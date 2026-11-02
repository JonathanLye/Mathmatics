import type { Db } from '../db/index.ts';

import { computeAttemptMetrics } from './attempt.ts';

// 派生数据可以随时重算（07 §1 原则 5）。这里按作答 ID 重算并写入 app.attempt_metrics（整行覆盖）。
export async function refreshAttemptMetrics(db: Db, attemptIds: readonly string[]): Promise<number> {
  let written = 0;
  for (const attemptId of [...new Set(attemptIds)].sort()) {
    const metrics = await computeAttemptMetrics(db, attemptId);
    await db.query(
      `insert into app.attempt_metrics (attempt_id, metrics, computed_at) values ($1, $2::jsonb, now())
       on conflict (attempt_id) do update set metrics = excluded.metrics, computed_at = excluded.computed_at`,
      [attemptId, JSON.stringify(metrics)],
    );
    written += 1;
  }
  return written;
}
