import type { Queryable } from '../db/index.ts';

import { AWAY_COUNT_MIN_MS, lockThreshold, MULTI_DEVICE_WINDOW_MINUTES, PASTE_BURST_CHARS, SIGNAL_SCORE } from './rules.ts';

type Signal = keyof typeof SIGNAL_SCORE;

interface ServerEvent {
  attemptId: string;
  type: 'integ.flag' | 'attempt.lock';
  payload: Record<string, unknown>;
  signal?: Signal;
}

// 在 ingest 事务里调用：本批客户端事件已写入，作答行已被 ingest 的 seq 预留锁定。
// 所以下面的计数能看到本批的事件，而且读到的 status 是锁之后的最新值（READ COMMITTED 下，等行锁后的语句取新快照）。
// 同一批里每个作答最多锁一次（锁后 status 变为 locked，后续判断直接跳过）。
export async function applyIntegrityRules(
  tx: Queryable,
  batch: { eventIds: readonly string[]; attemptIds: readonly string[] },
): Promise<void> {
  const pending: ServerEvent[] = [];
  const attemptIds = [...new Set(batch.attemptIds)].sort();

  // paste_burst：单次粘贴 ≥ 30 字，每次粘贴记一条（11 §4）。证据只含事件 ID 与字数。
  const pastes = await tx.query<{ attempt_id: string; event_id: string; chars: number }>(
    `select attempt_id, id as event_id, (payload->>'chars')::int as chars
       from ev.events
      where id = any($1::uuid[]) and type = 'paste' and attempt_id is not null
        and (payload->>'chars')::int >= $2`,
    [batch.eventIds, PASTE_BURST_CHARS],
  );
  for (const p of pastes.rows) {
    pending.push({
      attemptId: p.attempt_id,
      type: 'integ.flag',
      signal: 'paste_burst',
      payload: { signal: 'paste_burst', score: SIGNAL_SCORE.paste_burst, evidence: { eventId: p.event_id, chars: p.chars } },
    });
  }

  for (const attemptId of attemptIds) {
    // multi_device：同一作答在 5 分钟窗口内（按服务端时间）出现两个设备；每个作答只记一次。
    const devices = await tx.query<{ n: string }>(
      `select count(distinct device_id)::text as n from ev.events
        where attempt_id = $1 and device_id is not null
          and ts_server > now() - make_interval(mins => $2)`,
      [attemptId, MULTI_DEVICE_WINDOW_MINUTES],
    );
    const deviceCount = Number(devices.rows[0]?.n ?? 0);
    if (deviceCount >= 2) {
      const already = await tx.query(
        `select 1 from app.integrity_signals where attempt_id = $1 and signal = 'multi_device' limit 1`,
        [attemptId],
      );
      if (already.rows.length === 0) {
        pending.push({
          attemptId,
          type: 'integ.flag',
          signal: 'multi_device',
          payload: { signal: 'multi_device', score: SIGNAL_SCORE.multi_device, evidence: { deviceCount } },
        });
      }
    }

    // 测验锁定：只对测验模式、且仍为 active 的作答判断。计数来自 ev.events（服务端累加，前端改不了）。
    const row = (await tx.query<{ status: string; mode: string }>(`select status, mode from app.attempts where id = $1`, [attemptId]))
      .rows[0];
    if (!row || row.mode !== 'test' || row.status !== 'active') continue;
    const away = await tx.query<{ n: string }>(
      `select count(*)::text as n from ev.events
        where attempt_id = $1 and type = 'integ.visibility'
          and payload->>'state' = 'visible' and coalesce((payload->>'awayMs')::int, 0) >= $2`,
      [attemptId, AWAY_COUNT_MIN_MS],
    );
    const unlocks = await tx.query<{ n: string }>(
      `select count(*)::text as n from ev.events where attempt_id = $1 and type = 'attempt.unlock'`,
      [attemptId],
    );
    const awayCount = Number(away.rows[0]?.n ?? 0);
    const threshold = lockThreshold(Number(unlocks.rows[0]?.n ?? 0));
    if (awayCount >= threshold) {
      await tx.query(`update app.attempts set status = 'locked', locked_reason = 'away' where id = $1 and status = 'active'`, [attemptId]);
      pending.push({ attemptId, type: 'attempt.lock', payload: { reason: 'away', count: awayCount } });
    }
  }

  if (pending.length === 0) return;
  await writeServerEvents(tx, pending);
}

// 服务端事件与 ingest 客户端事件共用 ev.events 的 seq 空间：同一作答按一次性预留的区间分配。
async function writeServerEvents(tx: Queryable, pending: readonly ServerEvent[]): Promise<void> {
  const byAttempt = new Map<string, ServerEvent[]>();
  for (const e of pending) byAttempt.set(e.attemptId, [...(byAttempt.get(e.attemptId) ?? []), e]);

  for (const attemptId of [...byAttempt.keys()].sort()) {
    const events = byAttempt.get(attemptId) ?? [];
    const reserved = await tx.query<{ last_event_seq: number | string }>(
      `update app.attempts set last_event_seq = last_event_seq + $2 where id = $1 returning last_event_seq`,
      [attemptId, events.length],
    );
    let seq = Number(reserved.rows[0]?.last_event_seq ?? 0) - events.length;
    const info = (
      await tx.query<{
        user_id: string;
        assignment_id: string;
        problem_id: string;
        problem_version: number;
        mode: string;
        anon_code: string;
      }>(
        `select a.user_id, a.assignment_id, a.problem_id, a.problem_version, a.mode, u.anon_code
           from app.attempts a join app.users u on u.id = a.user_id where a.id = $1`,
        [attemptId],
      )
    ).rows[0];
    if (!info) continue;

    for (const e of events) {
      seq += 1;
      await tx.query(
        `insert into ev.events
           (id, seq, type, source, ts_server, user_id, user_anon, role, assignment_id, attempt_id,
            problem_id, problem_version, mode, payload)
         values (gen_random_uuid(), $1, $2, 'server', now(), $3, $4, 'student', $5, $6, $7, $8, $9, $10::jsonb)`,
        [seq, e.type, info.user_id, info.anon_code, info.assignment_id, attemptId, info.problem_id, info.problem_version, info.mode, JSON.stringify(e.payload)],
      );
      if (e.type === 'integ.flag' && e.signal) {
        const evidence = (e.payload.evidence ?? {}) as Record<string, unknown>;
        await tx.query(
          `insert into app.integrity_signals (attempt_id, user_id, signal, score, evidence, source)
           values ($1, $2, $3, $4, $5::jsonb, 'server')`,
          [attemptId, info.user_id, e.signal, SIGNAL_SCORE[e.signal], JSON.stringify(evidence)],
        );
      }
    }
  }
}
