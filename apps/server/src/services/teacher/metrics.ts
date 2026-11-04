import type { AuthContext } from '../../auth/session.ts';
import type { Queryable } from '../../db/index.ts';
import { assertClassTeacher } from './auth.ts';
import { loadProblem } from '../../attempts/problem.ts';

// 08 §4.1/§4.2 的班级/布置级指标；教师端只展示、不重算。
// n < 10 时只给人数与计数，比例/中位数一律 null（08 §4.2），不用 0 冒充。
type AttemptRow = {
  id: string;
  problem_id: string;
  problem_version: number;
  status: string;
  current_layer: string;
  state: { hint?: { matched?: string[]; keyCost?: Record<string, number> } };
  reveal: string | number;
  keys_total: number;
  keys_own: number;
  independence: string | number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

export async function buildClassMetrics(
  db: Queryable,
  auth: AuthContext,
  classId: string,
  assignmentId: string | undefined,
): Promise<Record<string, unknown>> {
  await assertClassTeacher(db, auth, classId);

  const attempts = (
    await db.query<AttemptRow>(
      assignmentId === undefined
        ? `select a.id, a.problem_id, a.problem_version, a.status, a.current_layer, a.state,
                  a.reveal, a.keys_total, a.keys_own, a.independence
             from app.attempts a join app.assignments asg on asg.id = a.assignment_id
            where asg.class_id = $1 and a.kind = 'main'`
        : `select a.id, a.problem_id, a.problem_version, a.status, a.current_layer, a.state,
                  a.reveal, a.keys_total, a.keys_own, a.independence
             from app.attempts a join app.assignments asg on asg.id = a.assignment_id
            where asg.class_id = $1 and a.assignment_id = $2 and a.kind = 'main'`,
      assignmentId === undefined ? [classId] : [classId, assignmentId],
    )
  ).rows;

  const n = attempts.length;
  const enough = n >= 10; // 08 §4.2 样本量规则
  const attemptIds = attempts.map((row) => row.id);
  const completed = attempts.filter((row) => row.status === 'completed').length;

  const layerFunnel: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };
  for (const row of attempts) layerFunnel[row.current_layer] = (layerFunnel[row.current_layer] ?? 0) + 1;

  const independenceValues = attempts
    .map((row) => (row.independence === null ? null : Number(row.independence)))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const autonomousRate: number[] = [];
  const keyHeat = new Map<string, { label: string; own: number; viaHint: number }>();
  const problemCache = new Map<string, string | null>();
  for (const row of attempts) {
    const matched = row.state.hint?.matched ?? [];
    const keyCost = row.state.hint?.keyCost ?? {};
    let autonomous = 0;
    for (const keyId of matched) {
      const cacheKey = `${row.problem_id}@${row.problem_version}`;
      let label = problemCache.get(cacheKey);
      if (label === undefined) {
        try {
          const problem = await loadProblem(db, row.problem_id, row.problem_version);
          label = problem.ctx.pkg.secret.keys.find((key) => key.id === keyId)?.label ?? keyId;
        } catch {
          label = keyId;
        }
        problemCache.set(cacheKey, label);
      }
      const entry = keyHeat.get(keyId) ?? { label: label ?? keyId, own: 0, viaHint: 0 };
      if (Number(keyCost[keyId] ?? 0) > 0) entry.viaHint += 1;
      else {
        entry.own += 1;
        autonomous += 1;
      }
      keyHeat.set(keyId, entry);
    }
    const keysTotal = Number(row.keys_total);
    if (keysTotal > 0) autonomousRate.push(autonomous / keysTotal);
  }

  const eventStats = attemptIds.length
    ? (
        await db.query<{ attempt_id: string; hidden: number }>(
          `select attempt_id, count(*) filter (where type = 'integ.visibility' and payload->>'state' = 'visible' and coalesce((payload->>'awayMs')::bigint, 0) >= 2000)::int as hidden
             from ev.events where attempt_id = any($1::uuid[]) group by attempt_id`,
          [attemptIds],
        )
      ).rows
    : [];
  // 离开次数是计数不是比例，n<10 也返回（08 §4.2 只限制比例/中位数）。
  const awayMedian = median(eventStats.map((row) => row.hidden)) ?? 0;

  const counters = attemptIds.length
    ? (
        await db.query<{ rapid: number; flagged: number }>(
          `select
             (select count(*)::int from ev.events where attempt_id = any($1::uuid[]) and type = 'hint.rapid_lock') as rapid,
             (select count(*)::int from app.integrity_signals where attempt_id = any($1::uuid[]) and score >= 0.5) as flagged`,
          [attemptIds],
        )
      ).rows[0]
    : { rapid: 0, flagged: 0 };

  // 首次求助前时长：进入 L3 → 第一条 cost>0 的 hint.deliver；从未领取按删失（L3 停留）处理（08 §4.1）。
  let firstHelpMedian: number | null = null;
  let postHintMedian: number | null = null;
  if (enough && attemptIds.length) {
    const latencyRows = (
      await db.query<{ attempt_id: string; l3_at: Date | null; first_hint: Date | null; last_at: Date | null }>(
        `select attempt_id,
                min(ts_server) filter (where type = 'layer.enter' and payload->>'layer' = 'L3') as l3_at,
                min(ts_server) filter (where type = 'hint.deliver' and (payload->>'cost')::numeric > 0) as first_hint,
                max(ts_server) as last_at
           from ev.events where attempt_id = any($1::uuid[]) group by attempt_id`,
        [attemptIds],
      )
    ).rows;
    const latencies: number[] = [];
    for (const row of latencyRows) {
      if (!row.l3_at) continue;
      const start = new Date(row.l3_at).getTime();
      const end = row.first_hint ? new Date(row.first_hint).getTime() : row.last_at ? new Date(row.last_at).getTime() : null;
      if (end !== null && end >= start) latencies.push((end - start) / 1000);
    }
    firstHelpMedian = median(latencies);

    const dwellRows = (
      await db.query<{ attempt_id: string; hint_at: Date; next_submit: Date | null }>(
        `select e.attempt_id, e.ts_server as hint_at,
                (select min(e2.ts_server) from ev.events e2
                  where e2.attempt_id = e.attempt_id and e2.type = 'line.submit' and e2.seq > e.seq) as next_submit
           from ev.events e
          where e.attempt_id = any($1::uuid[]) and e.type = 'hint.deliver'
            and (e.payload->>'cost')::numeric > 0`,
        [attemptIds],
      )
    ).rows;
    const perAttempt = new Map<string, number[]>();
    for (const row of dwellRows) {
      if (!row.next_submit) continue;
      const gap = (new Date(row.next_submit).getTime() - new Date(row.hint_at).getTime()) / 1000;
      if (gap < 0) continue;
      const list = perAttempt.get(row.attempt_id) ?? [];
      list.push(gap);
      perAttempt.set(row.attempt_id, list);
    }
    postHintMedian = median([...perAttempt.values()].map((list) => median(list)).filter((v): v is number => v !== null));
  }

  return {
    n,
    completionRate: enough ? round(completed / n) : null,
    independenceMedian: enough ? round(median(independenceValues)) : null,
    firstHelpLatencyMedianSec: round(firstHelpMedian),
    postHintDwellMedianSec: round(postHintMedian),
    rapidHintEvents: counters.rapid,
    autonomousCoverage: enough ? round(median(autonomousRate)) : null,
    layerFunnel,
    keyHeat: [...keyHeat.entries()].map(([key, value]) => ({ key, ...value })),
    integrity: { awayEventsMedian: round(awayMedian) ?? 0, flagged: counters.flagged },
  };
}
