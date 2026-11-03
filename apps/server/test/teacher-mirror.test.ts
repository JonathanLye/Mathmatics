import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const USERNAME = 'mirror.teacher';
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026003';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let base: string;
let teacherCookie: string;
let studentCookie: string;
let classId: string;
let assignmentId: string;
let attemptId: string;

function auth(cookie: string) {
  return { ...WRITE_HEADERS, cookie };
}

async function loginTeacher(username = USERNAME): Promise<string> {
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
    headers: { ...auth(cookie), ...(payload === undefined ? {} : { 'content-type': contentType }) },
    payload: payload as string | object | undefined,
  });
}

async function readSseEvent(
  url: string,
  headers: Record<string, string>,
): Promise<{ event: string; data: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
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
        const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
        const data = /^data: (.+)$/m.exec(block)?.[1] ?? '';
        return { event, data, headers: res.headers };
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
  teacherCookie = await loginTeacher();

  const created = await post(teacherCookie, '/teacher/classes', { name: '镜像班', term: '2026 秋' });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classId as string;
  expect((await post(teacherCookie, `/teacher/classes/${classId}/roster`, `${STUDENT_NO},王五\n`, 'text/csv')).statusCode).toBe(200);
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
  await post(studentCookie, '/consents', { version: 'p0-v1', items: REQUIRED });
  const started = await post(studentCookie, `/student/assignments/${assignmentId}/attempt`);
  expect(started.statusCode, started.body).toBe(200);
  attemptId = started.json().state.attemptId as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('镜像预览（#43 / 04 §5.1、06 §6）', () => {
  it('mirror-token：教师可取 5 分钟令牌；学生 403；非本班教师 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/mirror-token`,
      headers: { ...WRITE_HEADERS, cookie: teacherCookie },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { token: string; url: string; expiresAt: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.url).toContain(`/s/mirror?attempt=${attemptId}`);
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 1000);

    const asStudent = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/mirror-token`,
      headers: { ...WRITE_HEADERS, cookie: studentCookie },
      payload: {},
    });
    expect(asStudent.statusCode).toBe(403);

    await createTeacherAccount(db, { username: 'other.mirror', password: PASSWORD });
    const other = await loginTeacher('other.mirror');
    const asOther = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/mirror-token`,
      headers: { ...WRITE_HEADERS, cookie: other },
      payload: {},
    });
    expect(asOther.statusCode).toBe(404);
  });

  it('SSE（教师 Cookie）：event: state 返回学生视图，不泄露 secret；连接写 t.mirror open/close', async () => {
    const { event, data, headers } = await readSseEvent(`${base}/api/v1/teacher/attempts/${attemptId}/stream`, {
      cookie: teacherCookie,
    });
    expect(event).toBe('state');
    expect(headers.get('access-control-allow-origin')).toBeNull();
    const state = JSON.parse(data) as Record<string, unknown>;
    expect(state.attemptId).toBe(attemptId);
    expect(state.currentLayer).toBe('L1');
    expect(state).toHaveProperty('problem');
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(JSON.stringify(state)).not.toContain('referenceProofs');

    // 断开后 write close；open/close 都应在 ev.events 里
    await new Promise((resolve) => setTimeout(resolve, 400));
    const events = await db.query<{ payload: { attemptId?: string; action?: string } }>(
      `select payload from ev.events where attempt_id = $1 and type = 't.mirror' order by seq`,
      [attemptId],
    );
    const actions = events.rows.map((row) => row.payload.action);
    expect(actions).toContain('open');
    // 08 §3 / events.schema p_t_mirror：attemptId + action 均必填（A 复审 P2-1）
    for (const row of events.rows) {
      expect(row.payload.attemptId).toBe(attemptId);
      expect(['open', 'close']).toContain(row.payload.action);
    }
  });

  it('SSE（mirrorToken）：不带教师 Cookie 也可用；token 绑定 attempt、篡改签名 401', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/mirror-token`,
      headers: { ...WRITE_HEADERS, cookie: teacherCookie },
      payload: {},
    });
    const token = (tokenRes.json() as { token: string }).token;

    const { event, data, headers } = await readSseEvent(
      `${base}/api/v1/teacher/attempts/${attemptId}/stream?token=${encodeURIComponent(token)}`,
      {},
    );
    expect(event).toBe('state');
    expect((JSON.parse(data) as { attemptId: string }).attemptId).toBe(attemptId);
    // 沙箱 iframe（opaque origin）需要 CORS；token 路径无 Cookie，ACAO * 不涉及凭据（P1-2 方案①）
    expect(headers.get('access-control-allow-origin')).toBe('*');

    const tampered = `${token.slice(0, -2)}xx`;
    const bad = await fetch(`${base}/api/v1/teacher/attempts/${attemptId}/stream?token=${encodeURIComponent(tampered)}`);
    expect(bad.status).toBe(401);

    // 换一个 attempt（同一布置的第二次作答会复用；新开一个布置）：token 绑定不匹配 → 401
    const secondAssignment = await post(teacherCookie, '/teacher/assignments', {
      classId,
      problemId: 'epsN',
      version: 1,
      mode: 'practice',
      openAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(secondAssignment.statusCode, secondAssignment.body).toBe(201);
    const second = await post(
      studentCookie,
      `/student/assignments/${secondAssignment.json().assignmentId as string}/attempt`,
    );
    expect(second.statusCode, second.body).toBe(200);
    const secondAttempt = second.json().state.attemptId as string;
    expect(secondAttempt).not.toBe(attemptId);
    const wrong = await fetch(
      `${base}/api/v1/teacher/attempts/${secondAttempt}/stream?token=${encodeURIComponent(token)}`,
    );
    expect(wrong.status).toBe(401);
  });

  it('同一作答最多 2 条镜像连接，第 3 条 429 RATE_LIMITED（A 复审 P2-2）', async () => {
    const token = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/teacher/attempts/${attemptId}/mirror-token`,
        headers: { ...WRITE_HEADERS, cookie: teacherCookie },
        payload: {},
      })
    ).json().token as string;
    const url = `${base}/api/v1/teacher/attempts/${attemptId}/stream?token=${encodeURIComponent(token)}`;
    const first = await fetch(url);
    const second = await fetch(url);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const third = await fetch(url);
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe('RATE_LIMITED');
    await first.body?.cancel().catch(() => undefined);
    await second.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});
