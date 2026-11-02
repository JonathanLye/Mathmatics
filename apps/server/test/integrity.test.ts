import { randomUUID } from 'node:crypto';

import { createAttempt, deserializeState, ENGINE_EVENT_TYPES, replay, type SerializedAttemptState } from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import { unlockAttempt } from '../src/integrity/unlock.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const contract = loadContract();
const SESSION_ID = randomUUID();
const DEVICE_A = randomUUID();
const DEVICE_B = randomUUID();

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherId: string;
let studentId: string;
let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
  const version = (
    await db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = 'epsN'`)
  ).rows[0]?.version;
  assignmentId = (
    await db.query<{ id: string }>(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
       values ($1, 'epsN', $2, 'test', now() - interval '1 hour', 'open', $3) returning id`,
      [fx.classId, version, teacherId],
    )
  ).rows[0]?.id as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function studentCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  const cookie = cookieFrom(res.headers['set-cookie']);
  studentId = (await db.query<{ id: string }>(`select id from app.users where role = 'student' limit 1`)).rows[0]?.id as string;
  return cookie;
}

async function signConsent(cookie: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: {
      version: 'p0-v1',
      items: { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false },
    },
  });
}

async function startAttempt(cookie: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignmentId}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().state.attemptId as string;
}

// 客户端事件：默认是一次"回到页面"，离开 3 秒。
const clientEvent = (overrides: Record<string, unknown>) => ({
  id: randomUUID(),
  type: 'integ.visibility',
  tsClient: '2026-11-03T04:00:00.000Z',
  sessionId: SESSION_ID,
  deviceId: DEVICE_A,
  clientSeq: 1,
  payload: { state: 'visible', awayMs: 3000 },
  ...overrides,
});

const away = (attemptId: string, awayMs = 3000) => clientEvent({ attemptId, payload: { state: 'visible', awayMs } });

function postBatch(cookie: string, events: unknown[]) {
  return app.inject({ method: 'POST', url: '/api/v1/events/batch', headers: { cookie, ...WRITE_HEADERS }, payload: { events } });
}

async function attemptRow(id: string) {
  return (await db.query<{ status: string; locked_reason: string | null }>(
    `select status, locked_reason from app.attempts where id = $1`,
    [id],
  )).rows[0];
}

async function eventsOf(id: string, type: string) {
  return (await db.query<{ payload: Record<string, unknown> }>(
    `select payload from ev.events where attempt_id = $1 and type = $2 order by seq`,
    [id, type],
  )).rows;
}

describe('测验模式锁定（11 §5.2）', () => {
  it('第 3 次离开（2 秒以上）锁定作答：写一条 attempt.lock，状态为 locked，之后写入返回 ATTEMPT_LOCKED', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    const res = await postBatch(cookie, [away(id), away(id), away(id)]);
    expect(res.statusCode, res.body).toBe(200);

    expect(await attemptRow(id)).toMatchObject({ status: 'locked', locked_reason: 'away' });
    const locks = await eventsOf(id, 'attempt.lock');
    expect(locks).toHaveLength(1);
    expect(locks[0]?.payload).toMatchObject({ reason: 'away', count: 3 });

    const get = await app.inject({ method: 'GET', url: `/api/v1/attempts/${id}`, headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(() => contract.validate('AttemptState', get.json().state)).not.toThrow();

    const write = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${id}/layers/L1/skip`,
      headers: { cookie, ...WRITE_HEADERS },
    });
    expect(write.statusCode).toBe(409);
    expect(write.json().error.code).toBe('ATTEMPT_LOCKED');
    expect(write.json().error.message).toBe('本题已锁定，请联系老师');
  });

  it('练习模式不锁定，离开次数再多也不锁', async () => {
    await db.query(`update app.assignments set mode = 'practice' where id = $1`, [assignmentId]);
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await postBatch(cookie, [away(id), away(id), away(id), away(id)]);
    expect((await attemptRow(id))?.status).toBe('active');
  });

  it('离开不足 2 秒不计次数', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await postBatch(cookie, [away(id, 1500), away(id, 1500), away(id, 1500)]);
    expect((await attemptRow(id))?.status).toBe('active');
  });

  it('同一批里超过阈值的离开只锁一次；重复上报同一批不重复计数', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    const batch = [away(id), away(id)];
    await postBatch(cookie, batch);
    expect((await attemptRow(id))?.status).toBe('active');
    const again = await postBatch(cookie, batch);
    expect(again.json()).toMatchObject({ accepted: 0, duplicates: 2 });
    expect((await attemptRow(id))?.status).toBe('active');

    await postBatch(cookie, [away(id), away(id), away(id)]);
    expect(await eventsOf(id, 'attempt.lock')).toHaveLength(1);
  });

  it('教师解锁：状态回到 active，写 attempt.unlock{by}；阈值 +1，再 1 次离开即重新锁定', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await postBatch(cookie, [away(id), away(id), away(id)]);
    expect((await attemptRow(id))?.status).toBe('locked');

    await unlockAttempt(db, { teacherId, attemptId: id });
    expect(await attemptRow(id)).toMatchObject({ status: 'active', locked_reason: null });
    const unlocks = await eventsOf(id, 'attempt.unlock');
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]?.payload).toMatchObject({ by: expect.any(String) });

    await postBatch(cookie, [away(id)]);
    expect((await attemptRow(id))?.status).toBe('locked');
  });

  it('解锁非锁定的作答返回 ATTEMPT_NOT_LOCKED；不在该班级的人解锁返回 NOT_FOUND', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await expect(unlockAttempt(db, { teacherId, attemptId: id })).rejects.toMatchObject({ code: 'ATTEMPT_NOT_LOCKED' });

    await postBatch(cookie, [away(id), away(id), away(id)]);
    await expect(unlockAttempt(db, { teacherId: studentId, attemptId: id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await attemptRow(id))?.status).toBe('locked');
  });

  it('锁定与解锁之后，重放得到的引擎状态与 app.attempts.state 一致（服务端事件不驱动引擎）', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await app.inject({ method: 'POST', url: `/api/v1/attempts/${id}/layers/L1/skip`, headers: { cookie, ...WRITE_HEADERS } });
    await postBatch(cookie, [away(id), away(id), away(id)]);
    await unlockAttempt(db, { teacherId, attemptId: id });
    await postBatch(cookie, [clientEvent({ attemptId: id, type: 'paste', payload: { target: 'line_statement', chars: 30, blocked: false } })]);

    const events = await db.query<{ type: string; ts: Date; payload: Record<string, unknown> }>(
      `select type, ts_server as ts, payload from ev.events where attempt_id = $1 order by seq`,
      [id],
    );
    const row = (await db.query<{ problem_version: number; state: SerializedAttemptState }>(
      `select problem_version, state from app.attempts where id = $1`,
      [id],
    )).rows[0];
    const problem = await loadProblem(db, 'epsN', row?.problem_version ?? 1);
    const engineEvents = events.rows
      .filter((e) => ENGINE_EVENT_TYPES.has(e.type))
      .map((e) => ({ type: e.type, at: new Date(e.ts).getTime(), payload: e.payload }));
    const startAt = new Date(events.rows[0]?.ts as Date).getTime();
    expect(engineEvents.length).toBeGreaterThan(0);
    expect(replay(createAttempt(problem.ctx, startAt), engineEvents)).toEqual(
      deserializeState(row?.state as SerializedAttemptState),
    );
  });
});

describe('服务端诚信信号（11 §4）', () => {
  it('粘贴 30 字记 paste_burst（integ.flag + app.integrity_signals）；29 字不记', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    const paste = (chars: number) =>
      clientEvent({ attemptId: id, type: 'paste', payload: { target: 'line_statement', chars, blocked: false } });
    await postBatch(cookie, [paste(29)]);
    expect(await eventsOf(id, 'integ.flag')).toHaveLength(0);

    await postBatch(cookie, [paste(30)]);
    const flags = await eventsOf(id, 'integ.flag');
    expect(flags).toHaveLength(1);
    expect(flags[0]?.payload).toMatchObject({ signal: 'paste_burst', score: 0.5 });
    const rows = await db.query<{ signal: string; source: string }>(
      `select signal, source from app.integrity_signals where attempt_id = $1`,
      [id],
    );
    expect(rows.rows).toEqual([{ signal: 'paste_burst', source: 'server' }]);
  });

  it('同一作答出现两个设备：记一次 multi_device，之后不重复记', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const id = await startAttempt(cookie);
    await postBatch(cookie, [clientEvent({ attemptId: id, deviceId: DEVICE_A }), clientEvent({ attemptId: id, deviceId: DEVICE_B })]);
    await postBatch(cookie, [clientEvent({ attemptId: id, deviceId: DEVICE_B })]);
    const flags = await eventsOf(id, 'integ.flag');
    expect(flags).toHaveLength(1);
    expect(flags[0]?.payload).toMatchObject({ signal: 'multi_device', score: 0.3 });
  });
});
