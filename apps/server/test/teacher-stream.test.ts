import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const USERNAME = 'stream.teacher';
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026006';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let base: string;
let teacherCookie: string;
let studentCookie: string;
let classId: string;
let assignmentId: string;

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

async function readSse(url: string, cookie?: string): Promise<{ event: string; data: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { headers: cookie === undefined ? {} : { cookie }, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const index = buffer.indexOf('\n\n');
      if (index >= 0) {
        const block = buffer.slice(0, index);
        await reader.cancel().catch(() => undefined);
        controller.abort();
        return {
          event: /^event: (.+)$/m.exec(block)?.[1] ?? '',
          data: /^data: (.+)$/m.exec(block)?.[1] ?? '',
        };
      }
    }
    throw new Error('SSE 没有收到事件');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
  const created = await post(teacherCookie, '/teacher/classes', { name: 'SSE 班', term: '2026 秋' });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classId as string;
  expect((await post(teacherCookie, `/teacher/classes/${classId}/roster`, `${STUDENT_NO},流学生\n`, 'text/csv')).statusCode).toBe(200);
  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
  });
  expect(assignment.statusCode, assignment.body).toBe(201);
  assignmentId = assignment.json().assignmentId as string;

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode: created.json().inviteCode as string, studentNo: STUDENT_NO }),
  });
  expect(login.statusCode, login.body).toBe(200);
  studentCookie = cookieFrom(login.headers['set-cookie']);
  // #64/#152：学生写接口前必须先选年龄段（<14 会 403）。
  await setStudentAgeBand(app, studentCookie);
  await post(studentCookie, '/consents', { version: 'p0-v1', items: REQUIRED });
  const started = await post(studentCookie, `/student/assignments/${assignment.json().assignmentId as string}/attempt`);
  expect(started.statusCode, started.body).toBe(200);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('班级看板 SSE（#48 C 侧 / 06 §6）', () => {
  it('教师 Cookie：首帧 event: row，数据为看板行', async () => {
    const { event, data } = await readSse(`${base}/api/v1/teacher/classes/${classId}/stream`, teacherCookie);
    expect(event).toBe('row');
    const row = JSON.parse(data) as { anonCode: string; status: string; layer: string; keysTotal: number };
    expect(row.anonCode).toMatch(/^S-/);
    expect(row.status).toBe('active');
    expect(row.layer).toBe('L1');
    expect(row.keysTotal).toBeGreaterThan(0);
  });

  it('assignmentId 过滤参数生效（契约参数）', async () => {
    const { event, data } = await readSse(
      `${base}/api/v1/teacher/classes/${classId}/stream?assignmentId=${assignmentId}`,
      teacherCookie,
    );
    expect(event).toBe('row');
    expect((JSON.parse(data) as { attemptId: string }).attemptId).toBeTruthy();
  });

  it('20s ping（测试注入更短间隔）', async () => {
    process.env.TEACHER_SSE_PING_MS = '80';
    const controller = new AbortController();
    try {
      const res = await fetch(`${base}/api/v1/teacher/classes/${classId}/stream`, {
        headers: { cookie: teacherCookie },
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawPing = false;
      while (!sawPing) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('event: ping')) sawPing = true;
      }
      await reader.cancel().catch(() => undefined);
      expect(sawPing).toBe(true);
    } finally {
      delete process.env.TEACHER_SSE_PING_MS;
      controller.abort();
    }
  });

  it('首帧期间断开不影响后续连接（清理竞态回归）', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v1/teacher/classes/${classId}/stream`, {
      headers: { cookie: teacherCookie },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const { event, data } = await readSse(`${base}/api/v1/teacher/classes/${classId}/stream`, teacherCookie);
    expect(event).toBe('row');
    expect((JSON.parse(data) as { anonCode: string }).anonCode).toMatch(/^S-/);
  });

  it('学生 403；非本班教师 404', async () => {
    const asStudent = await fetch(`${base}/api/v1/teacher/classes/${classId}/stream`, { headers: { cookie: studentCookie } });
    expect(asStudent.status).toBe(403);
    await createTeacherAccount(db, { username: 'stream.other', password: PASSWORD });
    const other = await teacherLogin('stream.other');
    const asOther = await fetch(`${base}/api/v1/teacher/classes/${classId}/stream`, { headers: { cookie: other } });
    expect(asOther.status).toBe(404);
  });
});
