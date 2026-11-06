import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, setStudentAgeBand, type Fixture } from './support/fixtures.ts';

// 测验模式锁定（11 §5.2）：锁定后，每一条写接口都必须返回 409 ATTEMPT_LOCKED。
// 断言的是精确的 409 与错误码，不接受 422：请求体不合法时会先于守卫失败，那样的"通过"没有意义。
const DRAFT_ID = randomUUID();
const input = { provenance: 'keyboard', draftId: DRAFT_ID };

const WRITES: Array<{ name: string; method: 'POST'; url: (id: string) => string; payload?: object }> = [
  { name: 'definition', method: 'POST', url: (id) => `/api/v1/attempts/${id}/definition`, payload: { text: '设 ε 为任意正数，取 N 使 1/N < ε。', input } },
  { name: 'framework', method: 'POST', url: (id) => `/api/v1/attempts/${id}/framework`, payload: { text: '取 ε > 0，构造 N。', input } },
  { name: 'framework/template', method: 'POST', url: (id) => `/api/v1/attempts/${id}/framework/template`, payload: { input } },
  { name: 'lines', method: 'POST', url: (id) => `/api/v1/attempts/${id}/lines`, payload: { statement: '1/N < ε', justification: 'N > 1/ε', input } },
  { name: 'selfcheck/:itemId', method: 'POST', url: (id) => `/api/v1/attempts/${id}/selfcheck/SC1`, payload: { text: '这里是自检的回答内容。', input } },
  { name: 'summary', method: 'POST', url: (id) => `/api/v1/attempts/${id}/summary`, payload: { answers: ['结论', '依据', '条件', '取值', '验证'], input } },
  { name: 'finish', method: 'POST', url: (id) => `/api/v1/attempts/${id}/finish` },
  { name: 'transfer', method: 'POST', url: (id) => `/api/v1/attempts/${id}/transfer` },
  { name: 'park', method: 'POST', url: (id) => `/api/v1/attempts/${id}/park` },
  { name: 'layers/:layer/skip', method: 'POST', url: (id) => `/api/v1/attempts/${id}/layers/L3/skip` },
];

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let assignmentId: string;
let teacherId: string;

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

async function lockedAttempt(): Promise<{ cookie: string; id: string }> {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  const cookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, cookie);
  await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: {
      version: 'v2',
      items: { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false },
    },
  });
  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignmentId}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });
  expect(start.statusCode, start.body).toBe(200);
  const id = start.json().state.attemptId as string;
  await db.query(`update app.attempts set status = 'locked', locked_reason = 'away' where id = $1`, [id]);
  return { cookie, id };
}

describe('锁定作答的写接口守卫（11 §5.2）', () => {
  it.each(WRITES)('$name：锁定后返回 409 ATTEMPT_LOCKED，且不写入任何事件', async (route) => {
    const { cookie, id } = await lockedAttempt();
    const eventsBefore = await db.query<{ n: string }>(`select count(*)::text as n from ev.events where attempt_id = $1`, [id]);
    const res = await app.inject({
      method: route.method,
      url: route.url(id),
      headers: { cookie, ...WRITE_HEADERS },
      payload: route.payload,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error.code).toBe('ATTEMPT_LOCKED');
    const eventsAfter = await db.query<{ n: string }>(`select count(*)::text as n from ev.events where attempt_id = $1`, [id]);
    expect(eventsAfter.rows[0]?.n).toBe(eventsBefore.rows[0]?.n);
  });
});
