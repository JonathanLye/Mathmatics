import {
  createAttempt,
  deserializeState,
  gateRule,
  replay,
  type Secret,
  type SerializedAttemptState,
} from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setupFixture,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();

const ALL_REQUIRED = {
  service: true,
  crossBorderHosting: true,
  crossBorderModel: false,
  monitoring: true,
  research: false,
};

const DRAFT_ID = '00000000-0000-4000-8000-0000000000d1';
const UNKNOWN_ATTEMPT = '00000000-0000-4000-8000-00000000ffff';
// 学生原文的标记：不得出现在任何事件 payload 里。
const STUDENT_MARKER = '学生原文标记ZQX';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherId: string;
let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]
    ?.id as string;
  assignmentId = await openAssignment(fx.classId, 'epsN');
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function openAssignment(classId: string, problemId: string): Promise<string> {
  const version = (
    await db.query<{ version: number }>(
      `select max(version) as version from content.problem_versions where problem_id = $1`,
      [problemId],
    )
  ).rows[0]?.version;
  const row = await db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1, $2, $3, 'practice', now() - interval '1 hour', 'open', $4)
     returning id`,
    [classId, problemId, version, teacherId],
  );
  return row.rows[0]?.id as string;
}

async function studentCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody(),
  });
  return cookieFrom(res.headers['set-cookie']);
}

async function signConsent(cookie: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: ALL_REQUIRED },
  });
}

const post = (cookie: string, path: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { cookie, ...WRITE_HEADERS, ...headers }, payload });

const get = (cookie: string, path: string) => app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie } });

const input = { provenance: 'keyboard', draftId: DRAFT_ID };
const lineBody = (statement: string, justification?: string) => ({ statement, justification, input });

// 登录、签署同意书、开始作答：返回 cookie 与作答 ID。
async function startedAttempt(): Promise<{ cookie: string; id: string; state: Record<string, unknown> }> {
  const cookie = await studentCookie();
  await signConsent(cookie);
  const res = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
  expect(res.statusCode, res.body).toBe(200);
  const state = res.json().state as Record<string, unknown>;
  return { cookie, id: state.attemptId as string, state };
}

function validState(body: { state: unknown }): void {
  expect(() => contract.validate('AttemptState', body.state)).not.toThrow();
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('作答接口（#19）', () => {
  it('未签同意书：开始作答与写接口都返回 CONSENT_REQUIRED（#18 的 DoD）', async () => {
    const cookie = await studentCookie();
    const start = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
    expect(start.statusCode).toBe(403);
    expect(start.json().error.code).toBe('CONSENT_REQUIRED');

    const write = await post(cookie, `/attempts/${UNKNOWN_ATTEMPT}/lines`, lineBody('取 ε'));
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('签署后开始作答：第 1 层、版本 0，响应通过 AttemptState 契约；重复开始返回同一作答', async () => {
    const { cookie, id, state } = await startedAttempt();
    validState({ state });
    // 开始作答本身是一次状态变化（attempt.start），版本从 1 开始。
    expect(state).toMatchObject({ kind: 'main', status: 'active', mode: 'practice', currentLayer: 'L1', stateVersion: 1 });
    expect((state.layers as { status: string }[]).map((l) => l.status)).toEqual([
      'active',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);

    const again = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
    expect(again.json().state.attemptId).toBe(id);
  });

  it('第 1 层提交行：409 WRONG_LAYER，detail.state 为当前状态且通过契约', async () => {
    const { cookie, id } = await startedAttempt();
    const res = await post(cookie, `/attempts/${id}/lines`, lineBody('取 ε'));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WRONG_LAYER');
    validState({ state: res.json().error.detail.state });
    expect(res.json().error.detail.state.currentLayer).toBe('L1');
  });

  it('跳过层：可跳过的层前进；第 3 层不可跳过（409 LAYER_LOCKED）；层不符（409 WRONG_LAYER）', async () => {
    const { cookie, id } = await startedAttempt();
    const skip1 = await post(cookie, `/attempts/${id}/layers/L1/skip`);
    expect(skip1.statusCode).toBe(200);
    expect(skip1.json().state).toMatchObject({ currentLayer: 'L2', stateVersion: 2 });
    expect(skip1.json().state.layers[0].status).toBe('skipped');

    const wrong = await post(cookie, `/attempts/${id}/layers/L4/skip`);
    expect(wrong.json().error.code).toBe('WRONG_LAYER');

    await post(cookie, `/attempts/${id}/layers/L2/skip`);
    const skip3 = await post(cookie, `/attempts/${id}/layers/L3/skip`);
    expect(skip3.statusCode).toBe(409);
    expect(skip3.json().error.code).toBe('LAYER_LOCKED');
  });

  it('第 3 层写一行：attempt_lines 与 ev.events 同时写入，seq 连续，last_event_seq 为最大 seq；事件不含学生原文', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    await post(cookie, `/attempts/${id}/layers/L2/skip`);
    const res = await post(cookie, `/attempts/${id}/lines`, lineBody(STUDENT_MARKER, '由题设'));
    expect(res.statusCode).toBe(200);
    validState(res.json());
    expect(res.json().state).toMatchObject({ currentLayer: 'L3', stateVersion: 4 });

    const lines = await db.query<{ role: string; idx: number; statement: string; classifier_path: string }>(
      `select role, idx, statement, classifier_path from app.attempt_lines where attempt_id = $1`,
      [id],
    );
    expect(lines.rows).toEqual([
      expect.objectContaining({ role: 'step', idx: 1, statement: STUDENT_MARKER, classifier_path: 'rule' }),
    ]);

    const events = await db.query<{ seq: number; type: string; payload: string }>(
      `select seq, type, payload::text as payload from ev.events where attempt_id = $1 order by seq`,
      [id],
    );
    expect(events.rows.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(events.rows.map((e) => e.type)).toEqual(['attempt.start', 'layer.skip', 'layer.skip', 'line.submit']);
    for (const e of events.rows) expect(e.payload).not.toContain(STUDENT_MARKER);

    const attempt = await db.query<{ last_event_seq: number | string; state_version: number }>(
      `select last_event_seq, state_version from app.attempts where id = $1`,
      [id],
    );
    expect(Number(attempt.rows[0]?.last_event_seq)).toBe(4);
    expect(attempt.rows[0]?.state_version).toBe(4);
  });

  it('If-Match 落后：409 STATE_STALE，detail.state 为最新状态；第二个带旧版本的写入被拒', async () => {
    const { cookie, id } = await startedAttempt(); // 版本 1
    const first = await post(cookie, `/attempts/${id}/layers/L1/skip`, undefined, { 'if-match': '1' });
    expect(first.json().state.stateVersion).toBe(2);

    // 另一个窗口仍拿着版本 1：被拒，detail.state 是最新的版本 2。
    const stale = await post(cookie, `/attempts/${id}/layers/L2/skip`, undefined, { 'if-match': '1' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STATE_STALE');
    expect(stale.json().error.detail.state.stateVersion).toBe(2);
    validState({ state: stale.json().error.detail.state });

    // 带引号的版本号同样接受。
    const current = await post(cookie, `/attempts/${id}/layers/L2/skip`, undefined, { 'if-match': '"2"' });
    expect(current.statusCode).toBe(200);
    expect(current.json().state).toMatchObject({ stateVersion: 3, currentLayer: 'L3' });

    const second = await post(cookie, `/attempts/${id}/layers/L3/skip`, undefined, { 'if-match': '2' });
    expect(second.json().error.code).toBe('STATE_STALE');
  });

  it('所有权：他人的作答读写都返回 404', async () => {
    const { cookie, id } = await startedAttempt();
    await db.query(`update app.attempts set user_id = $2 where id = $1`, [id, teacherId]);
    expect((await get(cookie, `/attempts/${id}`)).statusCode).toBe(404);
    const write = await post(cookie, `/attempts/${id}/layers/L1/skip`);
    expect(write.statusCode).toBe(404);
    expect(write.json().error.code).toBe('NOT_FOUND');
  });

  it('搁置后写入返回 ATTEMPT_LOCKED；再次开始恢复为进行中，事件记 resumed=true', async () => {
    const { cookie, id } = await startedAttempt();
    const parked = await post(cookie, `/attempts/${id}/park`);
    expect(parked.json().state.status).toBe('parked');

    const locked = await post(cookie, `/attempts/${id}/layers/L1/skip`);
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('ATTEMPT_LOCKED');

    const resumed = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
    expect(resumed.json().state).toMatchObject({ attemptId: id, status: 'active' });
    const resumeEvent = await db.query<{ payload: { resumed: boolean } }>(
      `select payload from ev.events where attempt_id = $1 and type = 'attempt.start' order by seq desc limit 1`,
      [id],
    );
    expect(resumeEvent.rows[0]?.payload.resumed).toBe(true);
  });

  it('布置已关闭：开始作答返回 409 ASSIGNMENT_CLOSED', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    await db.query(`update app.assignments set close_at = now() - interval '1 minute' where id = $1`, [assignmentId]);
    const res = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ASSIGNMENT_CLOSED');
  });

  it('转移题：第 5 层开始迁移题创建子作答（kind=transfer，题目为 epsN-T1），父作答仍在第 5 层', async () => {
    const { cookie, id } = await startedAttempt();
    // 白盒：把父作答的引擎状态放到第 5 层（前四层已完成），只测迁移题的创建。
    const stored = (await db.query<{ state: object }>(`select state from app.attempts where id = $1`, [id])).rows[0]
      ?.state as object;
    const parentState = { ...stored, layer: 5, status: { 1: 'skip', 2: 'skip', 3: 'done', 4: 'done' } };
    await db.query(`update app.attempts set state = $2::jsonb, current_layer = 'L5' where id = $1`, [
      id,
      JSON.stringify(parentState),
    ]);

    const res = await post(cookie, `/attempts/${id}/transfer`);
    expect(res.statusCode).toBe(200);
    validState(res.json());
    expect(res.json().state).toMatchObject({ kind: 'transfer', parentAttemptId: id, currentLayer: 'L3' });
    expect(res.json().state.problem.problemId).toBe('epsN-T1');

    const again = await post(cookie, `/attempts/${id}/transfer`);
    expect(again.json().state.attemptId).toBe(res.json().state.attemptId);

    const parent = await get(cookie, `/attempts/${id}`);
    expect(parent.json().state.currentLayer).toBe('L5');
  });

  it('重放：ev.events 按 seq 重放得到的引擎状态，与 app.attempts.state 一致', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    await post(cookie, `/attempts/${id}/layers/L2/skip`);
    await post(cookie, `/attempts/${id}/lines`, lineBody(STUDENT_MARKER, '由题设'));

    const events = await db.query<{ type: string; ts: Date; payload: Record<string, unknown> }>(
      `select type, ts_server as ts, payload from ev.events where attempt_id = $1 order by seq`,
      [id],
    );
    const row = (
      await db.query<{ problem_version: number; state: SerializedAttemptState }>(
        `select problem_version, state from app.attempts where id = $1`,
        [id],
      )
    ).rows[0];
    const problem = await loadProblem(db, 'epsN', row?.problem_version ?? 1);
    // attempt.start 与 attempt.park 是服务端事件，不驱动引擎状态。
    const engineEvents = events.rows
      .filter((e) => e.type !== 'attempt.start' && e.type !== 'attempt.park')
      .map((e) => ({ type: e.type, at: new Date(e.ts).getTime(), payload: e.payload }));
    const startAt = new Date(events.rows[0]?.ts as Date).getTime();

    expect(replay(createAttempt(problem.ctx, startAt), engineEvents)).toEqual(
      deserializeState(row?.state as SerializedAttemptState),
    );
  });

  it('泄露扫描：学生接口的响应不含未透露关键步骤的泄题片段；负面对照能报出', async () => {
    const { cookie, id, state } = await startedAttempt();
    const bodies: unknown[] = [state];
    bodies.push((await post(cookie, `/attempts/${id}/layers/L1/skip`)).json());
    bodies.push((await post(cookie, `/attempts/${id}/layers/L2/skip`)).json());
    bodies.push((await post(cookie, `/attempts/${id}/lines`, lineBody(STUDENT_MARKER, '由题设'))).json());
    bodies.push((await get(cookie, `/attempts/${id}`)).json());

    const secret = (
      await db.query<{ secret: Secret }>(`select secret from vault.problem_secrets where problem_id = 'epsN'`)
    ).rows[0]?.secret as Secret;
    const stateRow = await db.query<{ state: { hint: { matched: string[] } } }>(
      `select state from app.attempts where id = $1`,
      [id],
    );
    const matched = new Set(stateRow.rows[0]?.state.hint.matched ?? []);

    for (const body of bodies) {
      for (const text of strings(body)) {
        expect(gateRule(secret, text, matched, []).ok, `泄露：${text}`).toBe(true);
      }
    }

    // 负面对照：把一个未透露关键步骤的泄题片段放进文本，扫描必须报出。
    const unrevealed = secret.keys.find((k) => !matched.has(k.id));
    const fragment = unrevealed?.leak[0];
    expect(fragment).toBeDefined();
    expect(gateRule(secret, `示例 ${fragment}`, matched, []).ok).toBe(false);
  });
});
