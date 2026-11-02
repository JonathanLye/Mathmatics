import type { Queryable } from '../db/index.ts';

// 为一个服务端事件预留下一个 seq。调用方必须已在同一事务里持有该作答的行锁（ingest 的预留、或 FOR UPDATE）。
export async function nextSeq(tx: Queryable, attemptId: string): Promise<number> {
  const reserved = await tx.query<{ last_event_seq: number | string }>(
    `update app.attempts set last_event_seq = last_event_seq + 1 where id = $1 returning last_event_seq`,
    [attemptId],
  );
  return Number(reserved.rows[0]?.last_event_seq ?? 0);
}
