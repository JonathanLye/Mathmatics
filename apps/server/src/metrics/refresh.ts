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

// 找出需要重算的作答（只看最近 30 天有动静的作答，避免作答表很大时每轮全表扫事件）：还没有指标行，或此后又有新事件。最近有动静的先算；单次最多 limit 个，下一轮接着来。
// 本地/单机部署由 server 进程的定时器调用（server.ts）；pg-boss worker 上线后可改由 worker 调度，函数不变。
export async function refreshStaleMetrics(db: Db, limit = 200): Promise<number> {
  const stale = await db.query<{ id: string }>(
    `select a.id
       from app.attempts a
       left join app.attempt_metrics m on m.attempt_id = a.id
      where greatest(a.started_at, a.updated_at) > now() - interval '30 days'
        and exists (select 1 from ev.events e where e.attempt_id = a.id and (m.computed_at is null or e.ts_server > m.computed_at))
      order by (select max(e.ts_server) from ev.events e where e.attempt_id = a.id) desc
      limit $1`,
    [limit],
  );
  return refreshAttemptMetrics(db, stale.rows.map((row) => row.id));
}
