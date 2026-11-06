import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, setStudentAgeBand, type Fixture } from './support/fixtures.ts';

const ALL_REQUIRED = {
  service: true,
  crossBorderHosting: true,
  crossBorderModel: false,
  monitoring: true,
  research: false,
};

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function studentCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody(),
  });
  expect(res.statusCode).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function signConsent(cookie: string): Promise<void> {
  // #64：写接口要求年龄分档；测试默认 ge18。
  await setStudentAgeBand(app, cookie);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: ALL_REQUIRED },
  });
  expect(res.statusCode).toBe(200);
}

async function openAssignment(problemId = 'epsN', status = 'open'): Promise<string> {
  const version = (
    await db.query<{ version: number }>(
      `select max(version) as version from content.problem_versions where problem_id = $1`,
      [problemId],
    )
  ).rows[0]?.version;
  const row = await db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1, $2, $3, 'practice', now() - interval '1 hour', $4, $5)
     returning id`,
    [fx.classId, problemId, version, status, teacherId],
  );
  return row.rows[0]?.id as string;
}

const getHome = async (cookie: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/student/home', headers: { cookie } });
  return { status: res.statusCode, body: res.json() as Record<string, unknown[]> };
};

describe('GET /student/home（#74）', () => {
  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/student/home' });
    expect(res.statusCode).toBe(401);
  });

  it('没有布置时三组都是空数组', async () => {
    const cookie = await studentCookie();
    const { status, body } = await getHome(cookie);
    expect(status).toBe(200);
    // Task 6：首页带本周计数与证明本计数（没有作答时都是 0）
    expect(body).toEqual({
      inProgress: [],
      todo: [],
      done: [],
      week: { keysOwn: 0, keysTotal: 0, problemsDone: 0 },
      notebook: { cards: 0, toRedo: 0 },
    });
  });

  it('未开始的布置进 todo，带 assignmentId/title/mode/status', async () => {
    const assignmentId = await openAssignment();
    const cookie = await studentCookie();
    const { status, body } = await getHome(cookie);
    expect(status).toBe(200);
    const todo = body.todo as Record<string, unknown>[];
    expect(todo).toHaveLength(1);
    expect(todo[0]).toMatchObject({
      assignmentId,
      mode: 'practice',
      status: 'open',
      attemptId: null,
      attemptStatus: null,
    });
    expect(typeof todo[0]?.title).toBe('string');
    expect((todo[0]?.title as string).length).toBeGreaterThan(0);
  });

  it('开始作答后进 inProgress，完成后进 done', async () => {
    const assignmentId = await openAssignment();
    const cookie = await studentCookie();
    await signConsent(cookie);
    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/student/assignments/${assignmentId}/attempt`,
      headers: { cookie, ...WRITE_HEADERS },
    });
    expect(start.statusCode).toBe(200);
    const attemptId = (start.json() as { state: { attemptId: string } }).state.attemptId;

    const active = await getHome(cookie);
    expect(active.status).toBe(200);
    const inProgress = active.body.inProgress as Record<string, unknown>[];
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]).toMatchObject({ assignmentId, attemptId, attemptStatus: 'active', currentLayer: 'L1' });
    expect(active.body.todo).toHaveLength(0);

    // 完成态由作答流程写入；这里只验证首页分类，不重复引擎测试。
    await db.query(`update app.attempts set status = 'completed', completed_at = now() where id = $1`, [attemptId]);
    const finished = await getHome(cookie);
    const done = finished.body.done as Record<string, unknown>[];
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ assignmentId, attemptId, attemptStatus: 'completed' });
    expect(finished.body.inProgress).toHaveLength(0);
  });

  it('cancelled 布置不出现在首页', async () => {
    const cancelled = await openAssignment('epsN', 'cancelled');
    const cookie = await studentCookie();
    const { status, body } = await getHome(cookie);
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(cancelled);
  });
});
