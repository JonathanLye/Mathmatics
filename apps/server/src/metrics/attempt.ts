import type { Queryable } from '../db/index.ts';

// 作答级指标（08 §4.1）中，现有事件已经能算的子集。
// 尚未实现（依赖 #29 的求助/提示事件、#21 的识别事件）：reveal、independence、keysOwn、hints、help、recognition、lesson 完成度。
// 这些字段在 DTO 里不出现，不写 0 冒充。
export interface AttemptMetrics {
  completed: boolean;
  durationMs: number | null;
  awayCount: number;
  awayMs: number;
  integrityMaxScore: number;
  integrityFlags: Record<string, number>;
  gateBlocks: Record<string, number>;
  defAttempts: number;
  lessonOpened: boolean;
  lines: number;
  provenance: Record<string, number>;
}

export async function computeAttemptMetrics(q: Queryable, attemptId: string): Promise<AttemptMetrics> {
  const counts = await q.query<{ type: string; n: string }>(
    `select type, count(*)::text as n from ev.events where attempt_id = $1 and type = any($2::text[]) group by type`,
    [attemptId, ['attempt.complete', 'def.submit', 'lesson.open', 'line.submit', 'integ.visibility']],
  );
  const n = (type: string) => Number(counts.rows.find((r) => r.type === type)?.n ?? 0);

  const away = await q.query<{ hidden: string; away_ms: string | null }>(
    `select count(*) filter (where payload->>'state' = 'hidden')::text as hidden,
            sum(case when payload->>'state' = 'visible' then coalesce((payload->>'awayMs')::int, 0) end)::text as away_ms
       from ev.events where attempt_id = $1 and type = 'integ.visibility'`,
    [attemptId],
  );

  const span = await q.query<{ ms: string | null }>(
    `select (extract(epoch from (max(ts_server) filter (where type = 'attempt.complete') - min(ts_server) filter (where type = 'attempt.start'))) * 1000)::text as ms
       from ev.events where attempt_id = $1`,
    [attemptId],
  );

  const integrity = await q.query<{ signal: string; n: string; max_score: number | null }>(
    `select signal, count(*)::text as n, max(score) as max_score from app.integrity_signals where attempt_id = $1 group by signal`,
    [attemptId],
  );

  const gates = await q.query<{ stage: string; n: string }>(
    `select payload->>'stage' as stage, count(*)::text as n from ev.events
      where attempt_id = $1 and type = 'gate.block' group by payload->>'stage'`,
    [attemptId],
  );

  const provenance = await q.query<{ kind: string; n: string }>(
    `select payload->>'provenance' as kind, count(*)::text as n from ev.events
      where attempt_id = $1 and type = 'line.submit' group by payload->>'provenance'`,
    [attemptId],
  );

  return {
    completed: n('attempt.complete') > 0,
    durationMs: span.rows[0]?.ms === null || span.rows[0]?.ms === undefined ? null : Math.round(Number(span.rows[0].ms)),
    awayCount: Number(away.rows[0]?.hidden ?? 0),
    awayMs: Number(away.rows[0]?.away_ms ?? 0),
    integrityMaxScore: Math.max(0, ...integrity.rows.map((r) => Number(r.max_score ?? 0))),
    integrityFlags: Object.fromEntries(integrity.rows.map((r) => [r.signal, Number(r.n)])),
    gateBlocks: Object.fromEntries(gates.rows.filter((r) => r.stage !== null).map((r) => [r.stage, Number(r.n)])),
    defAttempts: n('def.submit'),
    lessonOpened: n('lesson.open') > 0,
    lines: n('line.submit'),
    provenance: Object.fromEntries(provenance.rows.filter((r) => r.kind !== null).map((r) => [r.kind, Number(r.n)])),
  };
}
