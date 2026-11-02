import { randomUUID } from 'node:crypto';

import {
  createAttempt,
  deserializeState,
  ENGINE_EVENT_TYPES,
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
  try {
    expect(findLeaks(seen, await loadSecrets())).toEqual([]);
  } finally {
    seen = [];
    await app.close();
    await fx.close();
  }
});

// 库里所有题目包的 secret（epsN、epsN-T1 等）。响应可能属于任何一道题（如迁移子作答），所以每个响应都对全部 secret 检查。
async function loadSecrets(): Promise<Secret[]> {
  return (await db.query<{ secret: Secret }>(`select secret from vault.problem_secrets`)).rows.map((r) => r.secret);
}

// DoD：学生接口的每个响应，逐字符串 canon 后检查，未透露关键步骤的泄题片段必须为 0 命中。
// matched 取空集：不豁免任何关键步骤，比 DoD 的豁免（已写出 / H3-H4 已透露）更严格。
// 返回命中的"关键步骤: 片段"列表；空数组即无泄露。
function findLeaks(bodies: readonly { body: string }[], secrets: readonly Secret[]): string[] {
  const hits: string[] = [];
  for (const { body } of bodies) {
    for (const text of strings(JSON.parse(body))) {
      for (const secret of secrets) {
        const result = gateRule(secret, text, new Set(), []);
        if (!result.ok) for (const hit of result.hits) hits.push(`${hit.key}: ${hit.frag}`);
      }
    }
  }
  return hits;
}

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
  seen.push(res);
  return cookieFrom(res.headers['set-cookie']);
}

async function signConsent(cookie: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: ALL_REQUIRED },
  });
  seen.push(res);
}

// 每个学生接口的响应都记下来，测试结束时逐条做泄露扫描（issue #19 的 DoD）。
let seen: { body: string }[] = [];

const post = async (cookie: string, path: string, payload?: object, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { cookie, ...WRITE_HEADERS, ...headers }, payload });
  seen.push(res);
  return res;
};

const get = async (cookie: string, path: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie } });
  seen.push(res);
  return res;
};

const input = { provenance: 'keyboard', draftId: DRAFT_ID };
const lineBody = (statement: string, justification?: string) => ({ statement, justification, input });
const textBody = (text: string) => ({ text, input });

// 白盒：把作答的引擎状态与 current_layer 一起改到指定层，只用于测试该层的写接口（前面各层不走真实路径）。
async function patchState(
  id: string,
  currentLayer: string,
  patch: (state: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const stored = (await db.query<{ state: object }>(`select state from app.attempts where id = $1`, [id])).rows[0]
    ?.state as Record<string, unknown>;
  await db.query(`update app.attempts set state = $2::jsonb, current_layer = $3 where id = $1`, [
    id,
    JSON.stringify(patch(stored)),
    currentLayer,
  ]);
}

// 登录、签署同意书、开始作答：返回 cookie 与作答 ID。
async function startedAttempt(): Promise<{ cookie: string; id: string; state: Record<string, unknown> }> {
  const cookie = await studentCookie();
  await signConsent(cookie);
  const res = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
  expect(res.statusCode, res.body).toBe(200);
  const state = res.json().state as Record<string, unknown>;
  return { cookie, id: state.attemptId as string, state };
}

// 重放 ev.events 里的引擎事件，结果须与 app.attempts.state 一致。
// 只取 ENGINE_EVENT_TYPES（白名单）：attempt.start/park/lock/unlock、integ.* 与客户端观察事件只记录，不驱动引擎状态。
// 引擎的 apply 遇到未知类型会抛错，所以不能用黑名单。
async function expectReplayMatches(id: string): Promise<void> {
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
  const engineEvents = events.rows
    .filter((e) => ENGINE_EVENT_TYPES.has(e.type))
    .map((e) => ({ type: e.type, at: new Date(e.ts).getTime(), payload: e.payload }));
  const startAt = new Date(events.rows[0]?.ts as Date).getTime();

  expect(replay(createAttempt(problem.ctx, startAt), engineEvents)).toEqual(
    deserializeState(row?.state as SerializedAttemptState),
  );
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

  it('第 1 层定义与第 2 层骨架：提交与模板都返回 200 并通过契约，写入 def / frame 行', async () => {
    const { cookie, id } = await startedAttempt();
    const def = await post(cookie, `/attempts/${id}/definition`, textBody('设数列有极限'));
    expect(def.statusCode).toBe(200);
    validState(def.json());
    expect(def.json().state).toMatchObject({ currentLayer: 'L1' });
    expect(def.json().state.def.submissions).toBe(1);

    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    const frame = await post(cookie, `/attempts/${id}/framework`, textBody('取 ε 为任意正数'));
    expect(frame.statusCode).toBe(200);
    validState(frame.json());
    expect(frame.json().state).toMatchObject({ currentLayer: 'L2' });

    const template = await post(cookie, `/attempts/${id}/framework/template`);
    expect(template.statusCode).toBe(200);
    validState(template.json());

    const rows = await db.query<{ role: string; layer: string; statement: string }>(
      `select role, layer, statement from app.attempt_lines where attempt_id = $1 order by role`,
      [id],
    );
    expect(rows.rows).toEqual([
      { role: 'def', layer: 'L1', statement: '设数列有极限' },
      { role: 'frame', layer: 'L2', statement: '取 ε 为任意正数' },
    ]);
  });

  it('第 3 层写完：finish 返回 200，链条未闭合时事件记 complete=false，仍停在第 3 层', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    await post(cookie, `/attempts/${id}/layers/L2/skip`);
    const res = await post(cookie, `/attempts/${id}/finish`);
    expect(res.statusCode).toBe(200);
    validState(res.json());
    expect(res.json().state).toMatchObject({ currentLayer: 'L3', status: 'active' });

    const ev = await db.query<{ payload: { complete: boolean } }>(
      `select payload from ev.events where attempt_id = $1 and type = 'finish.try'`,
      [id],
    );
    expect(ev.rows.map((e) => e.payload.complete)).toEqual([false]);
  });

  it('第 4 层自检：逐题作答，有效与无效都写 selfcheck 行；三题通过则进入第 5 层；DTO 带每题状态', async () => {
    const { cookie, id } = await startedAttempt();
    await patchState(id, 'L4', (s) => ({
      ...s,
      layer: 4,
      status: { 1: 'skip', 2: 'skip', 3: 'done' },
      lines: 3,
      keyLine: { K1: 1, K2: 2, K3: 3 },
      selfcheck: { items: ['SC1', 'SC2', 'SC3'], passed: {} },
    }));

    const sc1 = await post(cookie, `/attempts/${id}/selfcheck/SC1`, textBody('第1行和第2行'));
    expect(sc1.statusCode).toBe(200);
    validState(sc1.json());
    expect(sc1.json().state.selfcheck.items[0]).toMatchObject({ itemId: 'SC1', status: 'accepted' });
    expect(sc1.json().state.currentLayer).toBe('L4');

    const sc2Bad = await post(cookie, `/attempts/${id}/selfcheck/SC2`, textBody('没有提到那个字母'));
    expect(sc2Bad.statusCode).toBe(200);
    validState(sc2Bad.json());
    expect(sc2Bad.json().state.selfcheck.items[1]).toMatchObject({ itemId: 'SC2', status: 'followup' });

    const sc2 = await post(cookie, `/attempts/${id}/selfcheck/SC2`, textBody('N 只依赖于 ε'));
    expect(sc2.json().state.selfcheck.items[1]).toMatchObject({ status: 'accepted' });

    const sc3 = await post(cookie, `/attempts/${id}/selfcheck/SC3`, textBody('第3行'));
    expect(sc3.statusCode).toBe(200);
    validState(sc3.json());
    expect(sc3.json().state).toMatchObject({ currentLayer: 'L5' });

    const rows = await db.query<{ slot: string; cls: string }>(
      `select slot, cls from app.attempt_lines where attempt_id = $1 and role = 'selfcheck'`,
      [id],
    );
    expect(rows.rows.map((r) => [r.slot, r.cls]).sort()).toEqual([
      ['SC1', 'pass'],
      ['SC2', 'fail'],
      ['SC2', 'pass'],
      ['SC3', 'pass'],
    ]);
  });

  it('第 6 层总结：五问写入 summary 行，通过即完成：status=completed、completed_at 有值、completion 存在', async () => {
    const { cookie, id } = await startedAttempt();
    await patchState(id, 'L6', (s) => ({
      ...s,
      layer: 6,
      status: { 1: 'skip', 2: 'skip', 3: 'done', 4: 'done', 5: 'skip' },
      summary: { asked: true },
    }));

    const res = await post(cookie, `/attempts/${id}/summary`, {
      answers: ['这是第一问的答案', '这是第二问的答案', '这是第三问的答案', '这是第四问的答案', '这是第五问的答案'],
      input,
    });
    expect(res.statusCode).toBe(200);
    validState(res.json());
    expect(res.json().state).toMatchObject({ status: 'completed', completion: { done: true, reviewAvailable: false } });

    const attempt = await db.query<{ status: string; completed_at: Date | null }>(
      `select status, completed_at from app.attempts where id = $1`,
      [id],
    );
    expect(attempt.rows[0]?.status).toBe('completed');
    expect(attempt.rows[0]?.completed_at).not.toBeNull();

    const rows = await db.query<{ slot: string; idx: number }>(
      `select slot, idx from app.attempt_lines where attempt_id = $1 and role = 'summary' order by idx`,
      [id],
    );
    expect(rows.rows.map((r) => [r.slot, r.idx])).toEqual([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ]);
  });

  it('重放：ev.events 按 seq 重放得到的引擎状态，与 app.attempts.state 一致', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    await post(cookie, `/attempts/${id}/layers/L2/skip`);
    await post(cookie, `/attempts/${id}/lines`, lineBody(STUDENT_MARKER, '由题设'));

    await expectReplayMatches(id);
  });

  it('重放：作答中的客户端观察事件（带 attemptId，与引擎事件共用 seq）不影响重放结果', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/events/batch',
      headers: { cookie, ...WRITE_HEADERS },
      payload: {
        events: [
          {
            id: randomUUID(),
            type: 'integ.blur',
            tsClient: '2026-11-03T04:00:00.000Z',
            sessionId: randomUUID(),
            deviceId: randomUUID(),
            clientSeq: 1,
            attemptId: id,
            layer: 'L1',
            payload: { awayMs: 1200 },
          },
        ],
      },
    });
    expect(ingest.statusCode, ingest.body).toBe(200);
    expect(ingest.json().accepted).toBe(1);
    await post(cookie, `/attempts/${id}/layers/L2/skip`);

    await expectReplayMatches(id);
  });

  it('扫描本身能报出泄露：放入未透露关键步骤的片段，findLeaks 必须命中（否则上面的 afterEach 扫描形同虚设）', async () => {
    const secrets = await loadSecrets();
    const fragment = secrets.find((s) => s.keys.length > 0)?.keys[0]?.leak[0];
    expect(fragment).toBeDefined();
    const leaks = findLeaks([{ body: JSON.stringify({ note: `示例 ${fragment}` }) }], secrets);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it('被扫描的响应确实包含字符串：所有记录的响应都经过 findLeaks 的遍历，不是空集', async () => {
    const { cookie, id } = await startedAttempt();
    await post(cookie, `/attempts/${id}/layers/L1/skip`);
    const scanned = seen.flatMap(({ body }) => strings(JSON.parse(body)));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(scanned.length).toBeGreaterThan(20);
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
