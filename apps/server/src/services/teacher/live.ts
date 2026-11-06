import { nextKey, type ProblemPackage } from '@proof-gym/engine';

import type { AppConfig } from '../../config.ts';
import type { Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { decryptPii } from '../../auth/crypto.ts';
import { loadProblem, type LoadedProblem } from '../../attempts/problem.ts';
import { assertClassTeacher } from './auth.ts';

import type { AuthContext } from '../../auth/session.ts';

// 04 §2.3 看板状态。stuck 不是状态枚举，只体现在 stuckSec / summary.stuck。
type LiveStatus = 'not_started' | 'active' | 'idle' | 'away' | 'parked' | 'locked' | 'completed';

export interface LiveRowDto {
  anonCode: string;
  displayName: string | null;
  attemptId: string | null;
  status: LiveStatus;
  layer: string | null;
  keysOwn: number;
  keysTotal: number;
  reveal: number;
  stuckSec: number;
  currentKeyLabel: string | null;
  lastActiveAt: string | null;
  awayCount: number;
  flags: string[];
}

export interface LiveSnapshotDto {
  classId: string;
  assignmentId: string | null;
  rows: LiveRowDto[];
  summary: {
    online: number;
    started: number;
    completed: number;
    stuck: number;
    flagged: number;
    layerFunnel: Record<string, number>;
    keyHeat: Array<{ key: string; label: string; stuck: number; viaHint: number }>;
  };
  at: string;
}

const ACTIVE_WINDOW_MS = 60_000;
const STUCK_MS = 3 * 60_000;

type RosterRow = {
  user_id: string;
  name_enc: Buffer | null;
  anon_code: string;
}

type AttemptRow = {
  id: string;
  user_id: string;
  problem_id: string;
  problem_version: number;
  status: string;
  current_layer: string;
  state: { hint?: { matched?: string[]; keyCost?: Record<string, number> } };
  reveal: string | number;
  keys_own: number;
  keys_total: number;
  started_at: Date | string;
}

async function resolveAssignmentId(
  db: Queryable,
  classId: string,
  assignmentId: string | undefined,
): Promise<string | null> {
  if (assignmentId !== undefined) {
    const found = await db.query(`select 1 from app.assignments where id = $1 and class_id = $2 and origin = 'teacher'`, [
      assignmentId,
      classId,
    ]);
    if (found.rows.length === 0) throw new AppError('NOT_FOUND', 404, '布置不存在');
    return assignmentId;
  }
  // 契约没有规定缺省取哪个布置；取最近开放的一个（04 §2.1 看板是“选中一个布置”）。
  const latest = (
    await db.query<{ id: string }>(
      `select id from app.assignments where class_id = $1 and status <> 'cancelled' and origin = 'teacher'
        order by open_at desc limit 1`,
      [classId],
    )
  ).rows[0];
  return latest?.id ?? null;
}

export async function buildLiveSnapshot(
  db: Queryable,
  config: AppConfig,
  auth: AuthContext,
  classId: string,
  assignmentId: string | undefined,
): Promise<LiveSnapshotDto> {
  // 复用 #50 的班级权限（教师 owner/成员；管理员看全部），不复制权限 SQL（A 复审 P3-3）。
  await assertClassTeacher(db, auth, classId);

  const roster = (
    await db.query<RosterRow>(
      `select r.claimed_by as user_id, r.name_enc, u.anon_code
         from app.roster_entries r
         join app.users u on u.id = r.claimed_by
        where r.class_id = $1 and r.claimed_by is not null
        order by r.imported_at`,
      [classId],
    )
  ).rows;

  const resolvedAssignmentId = await resolveAssignmentId(db, classId, assignmentId);
  const attempts = resolvedAssignmentId
    ? (
        await db.query<AttemptRow>(
          `select id, user_id, problem_id, problem_version, status, current_layer, state,
                  reveal, keys_own, keys_total, started_at
             from app.attempts
            where assignment_id = $1 and kind = 'main'`,
          [resolvedAssignmentId],
        )
      ).rows
    : [];

  const attemptByUser = new Map(attempts.map((row) => [row.user_id, row]));
  const problemCache = new Map<string, LoadedProblem>();
  const now = Date.now();
  const rows: LiveRowDto[] = [];
  const keyStats = new Map<string, { label: string; stuck: number; viaHint: number }>();
  const layerFunnel: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };

  const loadProblemCached = async (problemId: string, version: number): Promise<LoadedProblem> => {
    const cacheKey = `${problemId}@${version}`;
    const cached = problemCache.get(cacheKey);
    if (cached) return cached;
    const loaded = await loadProblem(db, problemId, version);
    problemCache.set(cacheKey, loaded);
    return loaded;
  };

  for (const student of roster) {
    const attempt = attemptByUser.get(student.user_id);
    const displayName = student.name_enc === null ? null : safeDecrypt(config, student.name_enc);
    if (!attempt) {
      rows.push({
        anonCode: student.anon_code,
        displayName,
        attemptId: null,
        status: 'not_started',
        layer: null,
        keysOwn: 0,
        keysTotal: 0,
        reveal: 0,
        stuckSec: 0,
        currentKeyLabel: null,
        lastActiveAt: null,
        awayCount: 0,
        flags: [],
      });
      continue;
    }

    layerFunnel[attempt.current_layer] = (layerFunnel[attempt.current_layer] ?? 0) + 1;

    const stats = (
      await db.query<{ last_active: Date | null; last_visibility: string | null; away_count: string; budget: boolean; help: boolean; integrity: boolean; last_new_key: Date | null }>(
        `select
           (select max(ts_server) from ev.events where attempt_id = $1) as last_active,
           (select payload->>'state' from ev.events where attempt_id = $1 and type = 'integ.visibility' order by seq desc limit 1) as last_visibility,
           (select count(*)::text from ev.events where attempt_id = $1 and type = 'integ.visibility' and payload->>'state' = 'visible' and coalesce((payload->>'awayMs')::bigint, 0) >= 2000) as away_count,
           (exists (select 1 from ev.events where attempt_id = $1 and type = 'budget.exhausted')) as budget,
           (exists (select 1 from app.help_flags where attempt_id = $1 and resolved_at is null)) as help,
           (exists (select 1 from app.integrity_signals where attempt_id = $1 and score >= 0.5 and disposition is null)) as integrity,
           (select max(ts_server) from ev.events
             where attempt_id = $1 and type in ('line.submit', 'line.edit')
               and jsonb_array_length(coalesce(payload->'newKeys', '[]'::jsonb)) > 0) as last_new_key`,
        [attempt.id],
      )
    ).rows[0];

    const lastActiveMs = stats?.last_active ? new Date(stats.last_active).getTime() : null;
    let status: LiveStatus;
    if (attempt.status === 'completed') status = 'completed';
    else if (attempt.status === 'locked') status = 'locked';
    else if (attempt.status === 'parked') status = 'parked';
    else if (stats?.last_visibility === 'hidden') status = 'away';
    else if (lastActiveMs !== null && now - lastActiveMs <= ACTIVE_WINDOW_MS) status = 'active';
    else status = 'idle';

    const loaded = await loadProblemCached(attempt.problem_id, attempt.problem_version);
    const secret = loaded.ctx.pkg.secret as ProblemPackage['secret'];
    const matched = new Set(attempt.state.hint?.matched ?? []);
    const keyCost = attempt.state.hint?.keyCost ?? {};
    for (const keyId of matched) {
      const key = secret.keys.find((item) => item.id === keyId);
      const label = key?.label ?? keyId;
      const entry = keyStats.get(keyId) ?? { label, stuck: 0, viaHint: 0 };
      entry.label = label;
      if (Number(keyCost[keyId] ?? 0) > 0) entry.viaHint += 1;
      keyStats.set(keyId, entry);
    }
    const currentKey = attempt.current_layer === 'L3' ? nextKey(secret, matched) : null;
    const stuckSec =
      attempt.current_layer === 'L3'
        ? Math.max(0, Math.floor((now - (stats?.last_new_key ? new Date(stats.last_new_key).getTime() : new Date(attempt.started_at).getTime())) / 1000))
        : 0;
    const isStuck = attempt.current_layer === 'L3' && stuckSec >= STUCK_MS / 1000;
    if (isStuck && currentKey) {
      const entry = keyStats.get(currentKey.id) ?? { label: currentKey.label ?? currentKey.id, stuck: 0, viaHint: 0 };
      entry.stuck += 1;
      keyStats.set(currentKey.id, entry);
    }

    const flags: string[] = [];
    if (stats?.help) flags.push('help');
    if (stats?.integrity) flags.push('integrity');
    if (stats?.budget) flags.push('budget_exhausted');

    rows.push({
      anonCode: student.anon_code,
      displayName,
      attemptId: attempt.id,
      status,
      layer: attempt.current_layer,
      keysOwn: Number(attempt.keys_own),
      keysTotal: Number(attempt.keys_total),
      reveal: Number(attempt.reveal),
      stuckSec,
      currentKeyLabel: currentKey ? (currentKey.label ?? currentKey.id) : null,
      lastActiveAt: stats?.last_active ? new Date(stats.last_active).toISOString() : null,
      awayCount: Number(stats?.away_count ?? 0),
      flags,
    });
  }

  rows.sort((a, b) => b.stuckSec - a.stuckSec || a.anonCode.localeCompare(b.anonCode));

  return {
    classId,
    assignmentId: resolvedAssignmentId,
    rows,
    summary: {
      online: rows.filter((row) => row.status === 'active').length,
      started: rows.filter((row) => row.attemptId !== null).length,
      completed: rows.filter((row) => row.status === 'completed').length,
      stuck: rows.filter((row) => row.stuckSec >= STUCK_MS / 1000).length,
      flagged: rows.filter((row) => row.flags.length > 0).length,
      layerFunnel,
      keyHeat: [...keyStats.entries()].map(([key, value]) => ({ key, ...value })),
    },
    at: new Date(now).toISOString(),
  };
}

function safeDecrypt(config: AppConfig, encrypted: Buffer): string | null {
  try {
    return decryptPii(config.piiKey, Buffer.from(encrypted));
  } catch {
    return null;
  }
}
