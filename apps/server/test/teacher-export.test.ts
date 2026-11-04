import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const USERNAME = 'export.teacher';
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026007';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let base: string;
let teacherCookie: string;
let classId: string;

async function teacherLogin(username = USERNAME): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function post(cookie: string, path: string, payload?: unknown, contentType = 'application/json') {
  return app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: { ...WRITE_HEADERS, cookie, ...(payload === undefined ? {} : { 'content-type': contentType }) },
    payload: payload as string | object | undefined,
  });
}

async function waitDone(exportId: string): Promise<{ status: string; url: string | null; rows: number | null }> {
  for (let i = 0; i < 80; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${exportId}`, headers: { cookie: teacherCookie } });
    expect(res.statusCode, res.body).toBe(200);
    const job = res.json() as { status: string; url: string | null; rows: number | null };
    if (['done', 'failed', 'pending_approval'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('导出任务未在 4s 内完成');
}

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
  teacherCookie = await teacherLogin();
  const created = await post(teacherCookie, '/teacher/classes', { name: '导出班', term: '2026 秋' });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classId as string;
  expect((await post(teacherCookie, `/teacher/classes/${classId}/roster`, `${STUDENT_NO},导出学生\n`, 'text/csv')).statusCode).toBe(200);
  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
  });
  expect(assignment.statusCode, assignment.body).toBe(201);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode: created.json().inviteCode as string, studentNo: STUDENT_NO }),
  });
  expect(login.statusCode, login.body).toBe(200);
  const studentCookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, studentCookie);
  await post(studentCookie, '/consents', { version: 'p0-v1', items: REQUIRED });
  const started = await post(studentCookie, `/student/assignments/${assignment.json().assignmentId as string}/attempt`);
  expect(started.statusCode, started.body).toBe(200);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('导出任务（#35 / 04 §9 / 08 §5）', () => {
  it('CSV 导出：queued → done，下载 zip（含字段字典），行数 ≥1', async () => {
    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts', 'lines', 'events'],
      anonymized: true,
    });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { exportId: string; status: string };
    expect(job.status).toBe('queued');
    const done = await waitDone(job.exportId);
    expect(done.status).toBe('done');
    expect(done.url).toBe(`/api/v1/teacher/exports/${job.exportId}/download`);
    expect(done.rows).toBeGreaterThanOrEqual(1);

    const download = await fetch(`${base}${done.url}`, { headers: { cookie: teacherCookie } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('zip');
    const body = Buffer.from(await download.arrayBuffer());
    expect(body.subarray(0, 2).toString()).toBe('PK');
  });

  it('实名导出 → pending_approval，不生成文件；未知表 422', async () => {
    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts'],
      anonymized: false,
    });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { exportId: string; status: string };
    expect(job.status).toBe('pending_approval');
    const status = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${job.exportId}`, headers: { cookie: teacherCookie } });
    expect((status.json() as { url: string | null }).url).toBeNull();

    const bad = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['nope'] });
    expect(bad.statusCode, bad.body).toBe(422);
  });

  it('非本班教师 404；其他教师看不到他人导出', async () => {
    await createTeacherAccount(db, { username: 'export.other', password: PASSWORD });
    const other = await teacherLogin('export.other');
    const forbidden = await post(other, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    expect(forbidden.statusCode).toBe(404);

    const created = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    const job = created.json() as { exportId: string };
    const hide = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${job.exportId}`, headers: { cookie: other } });
    expect(hide.statusCode).toBe(404);
  });
});
