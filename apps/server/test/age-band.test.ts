import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// #64 / 13 §4：学生在练习前必须选年龄段；<14 不开通；14–17 的同意书附加「建议告知监护人」。
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
let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
  assignmentId = await openAssignment();
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function openAssignment(): Promise<string> {
  const version = (
    await db.query<{ version: number }>(
      `select max(version) as version from content.problem_versions where problem_id = 'epsN'`,
    )
  ).rows[0]?.version;
  const row = await db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1, 'epsN', $2, 'practice', now() - interval '1 hour', 'open', $3)
     returning id`,
    [fx.classId, version, teacherId],
  );
  return row.rows[0]?.id as string;
}

async function login(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody(),
  });
  expect(res.statusCode).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function me(cookie: string) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as { ageBand: string | null; consentRequired: boolean };
}

async function chooseAge(cookie: string, ageBand: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/age-band',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { ageBand },
  });
}

async function signConsent(cookie: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: ALL_REQUIRED },
  });
}

const startAttempt = (cookie: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignmentId}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });

const sendEvents = (cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/events/batch',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { events: [] },
  });

describe('年龄分档与 14 岁以下不开通（#64 / 13 §4）', () => {
  it('登录后 ageBand=null；未分档时写接口 409、签同意书也 409（先分档再同意）', async () => {
    const cookie = await login();
    expect((await me(cookie)).ageBand).toBeNull();

    const start = await startAttempt(cookie);
    expect(start.statusCode).toBe(409);
    expect(start.json().error.code).toBe('AGE_BAND_REQUIRED');

    const consent = await signConsent(cookie);
    expect(consent.statusCode).toBe(409);
    expect(consent.json().error.code).toBe('AGE_BAND_REQUIRED');
  });

  it('ge18：记录后 Me.ageBand=ge18，签同意后可作答', async () => {
    const cookie = await login();
    const res = await chooseAge(cookie, 'ge18');
    expect(res.statusCode).toBe(200);
    expect(res.json().ageBand).toBe('ge18');
    expect((await me(cookie)).ageBand).toBe('ge18');

    expect((await signConsent(cookie)).statusCode).toBe(200);
    expect((await startAttempt(cookie)).statusCode).toBe(200);

    // ge18 的同意书不含 guardianNotice（该段只给 14–17）。
    const doc = await app.inject({ method: 'GET', url: '/api/v1/consents', headers: { cookie } });
    expect((doc.json() as { sections: Array<{ key: string }> }).sections.some((s) => s.key === 'guardianNotice')).toBe(false);
  });

  it('lt14：同意书/事件/作答全部拒绝；重新提交 ge18 也不能解锁（AGE_BAND_LOCKED）', async () => {
    const cookie = await login();
    expect((await chooseAge(cookie, 'lt14')).statusCode).toBe(200);
    expect((await me(cookie)).ageBand).toBe('lt14');

    const consent = await signConsent(cookie);
    expect(consent.statusCode).toBe(403);
    expect(consent.json().error.code).toBe('AGE_RESTRICTED');

    const events = await sendEvents(cookie);
    expect(events.statusCode).toBe(403);
    expect(events.json().error.code).toBe('AGE_RESTRICTED');

    const start = await startAttempt(cookie);
    expect(start.statusCode).toBe(403);
    expect(start.json().error.code).toBe('AGE_RESTRICTED');

    // 13 §4 的硬约束：已记录的年龄段不可自改。
    const retry = await chooseAge(cookie, 'ge18');
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('AGE_BAND_LOCKED');
    expect((await startAttempt(cookie)).statusCode).toBe(403);
  });

  it('14–17：同意书多出 guardianNotice（非必选、不签署）；签同意后可作答', async () => {
    const cookie = await login();
    expect((await chooseAge(cookie, '14to17')).statusCode).toBe(200);

    const doc = await app.inject({ method: 'GET', url: '/api/v1/consents', headers: { cookie } });
    expect(doc.statusCode).toBe(200);
    const sections = (doc.json() as { sections: Array<{ key: string; required: boolean }> }).sections;
    const guardian = sections.find((section) => section.key === 'guardianNotice');
    expect(guardian).toBeDefined();
    expect(guardian?.required).toBe(false);
    // 非签署项：签署请求里不出现也合法。
    expect((await signConsent(cookie)).statusCode).toBe(200);
    expect((await startAttempt(cookie)).statusCode).toBe(200);
  });

  it('非法年龄段 422；教师不能设置学生年龄段 403', async () => {
    const cookie = await login();
    const bad = await chooseAge(cookie, 'unknown');
    expect(bad.statusCode).toBe(422);

    await createTeacherAccount(db, { username: 'age.teacher', password: 'correct horse battery' });
    const loginTeacher = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/teacher/login',
      headers: WRITE_HEADERS,
      payload: { username: 'age.teacher', password: 'correct horse battery' },
    });
    expect(loginTeacher.statusCode).toBe(200);
    const teacherCookie = cookieFrom(loginTeacher.headers['set-cookie']);
    const res = await chooseAge(teacherCookie, 'ge18');
    expect(res.statusCode).toBe(403);
  });
});
