import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bySession,
  createSession,
  LEGACY_SESSION_COOKIE,
  STUDENT_SESSION_COOKIE,
  STUDENT_SESSION_MS,
  TEACHER_SESSION_COOKIE,
  TEACHER_SESSION_MS,
} from '../src/auth/session.ts';
import { studentHome } from '../src/attempts/home.ts';
import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const contract = loadContract();
const USERNAME = 'lin.teacher';
const PASSWORD = 'correct horse battery';
const UNKNOWN_ATTEMPT = '00000000-0000-4000-8000-000000000001';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  // 探针：把限流键原样记下来（路由必须在第一次请求之前注册）。
  const limited = { rateLimit: { max: 100, timeWindow: '1 minute', keyGenerator: bySession } };
  app.get('/api/v1/probe/key-student', { config: limited }, async (request) => ({ key: bySession(request) }));
  app.get('/api/v1/teacher/probe-key', { config: limited }, async (request) => ({ key: bySession(request) }));
  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

// 取响应里全部 Set-Cookie 行（单个时 inject 给字符串，多个时给数组）。
function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [String(raw)];
}

function pairOf(res: LightMyRequestResponse, name: string): string {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
  if (!line) throw new Error(`响应里没有 ${name}：${JSON.stringify(setCookies(res))}`);
  return line.split(';')[0] as string;
}

async function studentLogin() {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  expect(res.statusCode).toBe(200);
  return res;
}

async function teacherLogin() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username: USERNAME, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res;
}

// 一个浏览器同时登录两端：Cookie 罐里有两个名字。
async function bothCookies(): Promise<{ student: string; teacher: string; both: string }> {
  const student = pairOf(await studentLogin(), STUDENT_SESSION_COOKIE);
  const teacher = pairOf(await teacherLogin(), TEACHER_SESSION_COOKIE);
  return { student, teacher, both: `${student}; ${teacher}` };
}

function get(url: string, cookie: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie, ...headers } });
}

function post(url: string, cookie: string, headers: Record<string, string> = {}, payload?: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...WRITE_HEADERS, ...headers }, payload });
}

// 直接在库里造旧版 pg_sid 会话（上线前签发的 Cookie）。
async function legacyCookie(role: 'student' | 'teacher'): Promise<{ cookie: string; sessionId: string }> {
  const userId = (
    await db.query<{ id: string }>(
      role === 'teacher'
        ? `select user_id as id from app.teacher_accounts where username = '${USERNAME}'`
        : `select u.id from app.users u where u.role = 'student' limit 1`,
    )
  ).rows[0]?.id;
  if (!userId) throw new Error('缺少账号');
  const session = await createSession(db, {
    userId,
    deviceId: null,
    ip: null,
    ttlMs: role === 'teacher' ? TEACHER_SESSION_MS : STUDENT_SESSION_MS,
  });
  return { cookie: `${LEGACY_SESSION_COOKIE}=${app.signCookie(session.id)}`, sessionId: session.id };
}

describe('两端 Cookie 分开', () => {
  it('学生登录只下发 pg_sid_s，教师登录只下发 pg_sid_t，二者属性符合 05 §7', async () => {
    const s = await studentLogin();
    expect(setCookies(s)).toHaveLength(1);
    const sLine = setCookies(s)[0] as string;
    expect(sLine).toMatch(/^pg_sid_s=/);
    for (const attr of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) expect(sLine).toMatch(attr);
    expect(sLine).not.toMatch(/Domain=/i);
    const sDays = (new Date(/Expires=([^;]+)/i.exec(sLine)?.[1] ?? '').getTime() - Date.now()) / 86_400_000;
    expect(sDays).toBeGreaterThan(29.9);
    expect(sDays).toBeLessThanOrEqual(30);

    const t = await teacherLogin();
    expect(setCookies(t)).toHaveLength(1);
    const tLine = setCookies(t)[0] as string;
    expect(tLine).toMatch(/^pg_sid_t=/);
    for (const attr of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) expect(tLine).toMatch(attr);
    expect(tLine).not.toMatch(/Domain=/i);
    const tHours = (new Date(/Expires=([^;]+)/i.exec(tLine)?.[1] ?? '').getTime() - Date.now()) / 3_600_000;
    expect(tHours).toBeGreaterThan(11.9);
    expect(tHours).toBeLessThanOrEqual(12);
  });

  it('同一浏览器先后登录两端，后一次登录不吊销前一次', async () => {
    const { both } = await bothCookies();
    expect((await get('/me', both, { 'x-pg-app': 'student' })).statusCode).toBe(200);
    expect((await get('/me', both, { 'x-pg-app': 'teacher' })).statusCode).toBe(200);
    const revoked = await db.query(`select 1 from app.auth_sessions where revoked_at is not null`);
    expect(revoked.rows).toHaveLength(0);
  });
});

describe('/me 按 x-pg-app 选择身份', () => {
  it('带两个 Cookie：student 头得到学生，teacher 头得到教师，不带头默认学生', async () => {
    const { both } = await bothCookies();

    const asStudent = await get('/me', both, { 'x-pg-app': 'student' });
    expect(asStudent.statusCode).toBe(200);
    contract.validate('Me', asStudent.json());
    expect(asStudent.json().role).toBe('student');

    const asTeacher = await get('/me', both, { 'x-pg-app': 'teacher' });
    expect(asTeacher.statusCode).toBe(200);
    contract.validate('Me', asTeacher.json());
    expect(asTeacher.json().role).toBe('teacher');

    expect((await get('/me', both)).json().role).toBe('student');
    expect((await get('/me', both, { 'x-pg-app': 'bogus' })).json().role).toBe('student');
  });

  it('只有教师 Cookie 时，学生端（或不带头）的 /me 是 401，教师端是 200', async () => {
    const { teacher } = await bothCookies();
    expect((await get('/me', teacher, { 'x-pg-app': 'student' })).statusCode).toBe(401);
    expect((await get('/me', teacher)).statusCode).toBe(401);
    expect((await get('/me', teacher, { 'x-pg-app': 'teacher' })).statusCode).toBe(200);
  });

  it('只有学生 Cookie 时，教师端的 /me 是 401', async () => {
    const { student } = await bothCookies();
    expect((await get('/me', student, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
    expect((await get('/me', student, { 'x-pg-app': 'student' })).statusCode).toBe(200);
  });
});

describe('守卫：另一端的 Cookie 得到 403，不是 401', () => {
  it('只有教师 Cookie：学生首页、读作答、同意书、年龄段全部 403', async () => {
    const { teacher } = await bothCookies();

    for (const url of ['/student/home', `/attempts/${UNKNOWN_ATTEMPT}`, '/consents']) {
      const res = await get(url, teacher);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect(res.json().error.detail).toEqual({ reason: 'wrong_app' });
    }
    const age = await post('/auth/student/age-band', teacher, {}, { ageBand: 'ge18' });
    expect(age.statusCode).toBe(403);
    const write = await post(`/attempts/${UNKNOWN_ATTEMPT}/finish`, teacher);
    expect(write.statusCode).toBe(403);
    const recog = await post(`/recognitions/${UNKNOWN_ATTEMPT}/confirm`, teacher, {}, { text: 'x' });
    expect(recog.statusCode).toBe(403);
  });

  it('学生 Cookie 读同一条作答路径：过了守卫，得到的是 404 而不是 403', async () => {
    const { student } = await bothCookies();
    expect((await get(`/attempts/${UNKNOWN_ATTEMPT}`, student)).statusCode).toBe(404);
    expect((await get('/student/home', student)).statusCode).toBe(200);
  });

  it('只有学生 Cookie：教师接口 403', async () => {
    const { student } = await bothCookies();
    for (const url of ['/teacher/classes', '/teacher/problems']) {
      const res = await get(url, student);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.detail).toEqual({ reason: 'wrong_app' });
    }
    expect((await get('/teacher/classes', student)).json().error.message).toBe('需要教师账号');
  });

  it('两个 Cookie 都在：各读各的接口', async () => {
    const { both } = await bothCookies();
    expect((await get('/student/home', both)).statusCode).toBe(200);
    expect((await get('/teacher/classes', both)).statusCode).toBe(200);
  });

  it('没有任何 Cookie：两端都是 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/student/home' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/classes' })).statusCode).toBe(401);
  });

  it('过期的另一端 Cookie 不算“登录了另一端”：仍是 401', async () => {
    const { teacher } = await bothCookies();
    await db.query(`update app.auth_sessions set expires_at = now() - interval '1 minute'`);
    expect((await get('/student/home', teacher)).statusCode).toBe(401);
  });

  it('x-pg-app 头对学生/教师接口无效：教师接口永远读教师 Cookie', async () => {
    const { student } = await bothCookies();
    const res = await get('/teacher/classes', student, { 'x-pg-app': 'student' });
    expect(res.statusCode).toBe(403);
    const res2 = await get('/student/home', student, { 'x-pg-app': 'teacher' });
    expect(res2.statusCode).toBe(200);
  });
});

describe('退出只影响指定的一端', () => {
  it('教师端退出：只吊销并清除 pg_sid_t，学生会话仍有效', async () => {
    const { both, student } = await bothCookies();
    const out = await post('/auth/logout', both, { 'x-pg-app': 'teacher' });
    expect(out.statusCode).toBe(204);
    const cleared = setCookies(out);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatch(/^pg_sid_t=;/);

    expect((await get('/me', both, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
    expect((await get('/me', student, { 'x-pg-app': 'student' })).statusCode).toBe(200);
    expect((await get('/student/home', student)).statusCode).toBe(200);
  });

  it('学生端退出（不带头也是学生）：只清 pg_sid_s，教师会话仍有效', async () => {
    const { both, teacher } = await bothCookies();
    const out = await post('/auth/logout', both);
    expect(out.statusCode).toBe(204);
    expect(setCookies(out)).toHaveLength(1);
    expect(setCookies(out)[0]).toMatch(/^pg_sid_s=;/);

    expect((await get('/student/home', both)).statusCode).toBe(403);
    expect((await get('/teacher/classes', teacher)).statusCode).toBe(200);
    expect((await get('/me', teacher, { 'x-pg-app': 'teacher' })).statusCode).toBe(200);
  });

  it('只带学生 Cookie 却声明教师端退出：401，学生会话不被碰', async () => {
    const { student } = await bothCookies();
    expect((await post('/auth/logout', student, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
    expect((await get('/me', student)).statusCode).toBe(200);
  });
});

describe('旧 pg_sid 只读兼容', () => {
  it('旧学生 Cookie 能读学生接口，旧教师 Cookie 能读教师接口', async () => {
    await studentLogin(); // 保证学生账号存在
    const s = await legacyCookie('student');
    expect((await get('/student/home', s.cookie)).statusCode).toBe(200);
    const t = await legacyCookie('teacher');
    expect((await get('/teacher/classes', t.cookie)).statusCode).toBe(200);
  });

  it('旧教师 Cookie 读不了学生接口（403），旧学生 Cookie 读不了教师接口（403）', async () => {
    await studentLogin();
    const t = await legacyCookie('teacher');
    const s = await legacyCookie('student');
    for (const url of ['/student/home', `/attempts/${UNKNOWN_ATTEMPT}`, '/consents']) {
      expect((await get(url, t.cookie)).statusCode, url).toBe(403);
    }
    expect((await get('/teacher/classes', s.cookie)).statusCode).toBe(403);
  });

  it('旧学生 Cookie 访问 /me：返回学生，下发 pg_sid_s 并清掉 pg_sid，会话 id 不变', async () => {
    await studentLogin();
    const s = await legacyCookie('student');
    const res = await get('/me', s.cookie, { 'x-pg-app': 'student' });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('student');

    const lines = setCookies(res);
    const fresh = lines.find((l) => l.startsWith('pg_sid_s='));
    const cleared = lines.find((l) => l.startsWith('pg_sid=;'));
    expect(fresh).toBeDefined();
    expect(cleared).toBeDefined();
    expect(fresh).toMatch(/HttpOnly/i);
    // 新 Cookie 解签后就是原会话 id，换名不换会话。
    const value = /^pg_sid_s=([^;]+)/.exec(fresh as string)?.[1] ?? '';
    expect(app.unsignCookie(decodeURIComponent(value)).value).toBe(s.sessionId);
    // 之后只靠新 Cookie 即可。
    expect((await get('/student/home', `pg_sid_s=${value}`)).statusCode).toBe(200);
  });

  it('旧教师 Cookie 带 x-pg-app: teacher 访问 /me：转成 pg_sid_t；带 student 头则 401 且不转换', async () => {
    const t = await legacyCookie('teacher');
    const wrong = await get('/me', t.cookie, { 'x-pg-app': 'student' });
    expect(wrong.statusCode).toBe(401);
    expect(setCookies(wrong)).toHaveLength(0);

    const res = await get('/me', t.cookie, { 'x-pg-app': 'teacher' });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('teacher');
    expect(setCookies(res).some((l) => l.startsWith('pg_sid_t='))).toBe(true);
    expect(setCookies(res).some((l) => l.startsWith('pg_sid=;'))).toBe(true);
  });

  it('新 Cookie 优先于旧 Cookie：新 Cookie 在场时不读旧的，/me 也不转换', async () => {
    const { student } = await bothCookies();
    const s = await legacyCookie('student');
    const res = await get('/me', `${student}; ${s.cookie}`, { 'x-pg-app': 'student' });
    expect(res.statusCode).toBe(200);
    expect(setCookies(res)).toHaveLength(0);
  });

  it('旧 Cookie 退出：吊销会话并清掉 pg_sid', async () => {
    await studentLogin();
    const s = await legacyCookie('student');
    const out = await post('/auth/logout', s.cookie);
    expect(out.statusCode).toBe(204);
    expect(setCookies(out).some((l) => l.startsWith('pg_sid=;'))).toBe(true);
    expect((await get('/student/home', s.cookie)).statusCode).toBe(401);
  });
});

describe('学生首页只看学生身份', () => {
  it('教师同时是班级成员时，/student/home 不会把班级作业当成他自己的', async () => {
    const teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher' order by created_at limit 1`)).rows[0]
      ?.id as string;
    await db.query(`insert into app.class_members (class_id, user_id, role) values ($1, $2, 'teacher') on conflict do nothing`, [fx.classId, teacherId]);
    const version = (
      await db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = 'epsN'`)
    ).rows[0]?.version;
    await db.query(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
       values ($1, 'epsN', $2, 'practice', now() - interval '1 hour', 'open', $3)`,
      [fx.classId, version, teacherId],
    );
    await studentLogin();
    expect((await studentHome(db, contract, teacherId)).todo).toEqual([]);
    const studentId = (await db.query<{ id: string }>(`select id from app.users where role = 'student' limit 1`)).rows[0]?.id as string;
    expect(((await studentHome(db, contract, studentId)).todo as unknown[]).length).toBe(1);
  });
});

describe('事件入口 /events/batch 两端共用', () => {
  it('只有教师 Cookie 且没声明教师端：401，不会把教师当成学生设备的上报者', async () => {
    const { teacher } = await bothCookies();
    expect((await post('/events/batch', teacher, {}, { events: [] })).statusCode).toBe(401);
    expect((await post('/events/batch', teacher, { 'x-pg-app': 'teacher' }, { events: [] })).statusCode).toBe(200);
  });

  it('两个 Cookie 都在，默认按学生身份入库', async () => {
    const { both } = await bothCookies();
    expect((await post('/events/batch', both, {}, { events: [] })).statusCode).toBe(200);
  });
});

describe('会话级限流键跟随本请求所属的那一端', () => {
  it('同一浏览器的学生/教师接口各用自己 Cookie 的会话 id 作为键', async () => {
    const { student, teacher, both } = await bothCookies();
    const idOf = (pair: string) => app.unsignCookie(decodeURIComponent(pair.split('=')[1] as string)).value;
    expect((await get('/probe/key-student', both)).json().key).toBe(idOf(student));
    expect((await get('/teacher/probe-key', both)).json().key).toBe(idOf(teacher));
    // 只有另一端的 Cookie 时，本端回退到 IP，不借用另一端的会话 id。
    expect((await get('/probe/key-student', teacher)).json().key).toBe('127.0.0.1');
  });
});

describe('镜像令牌不依赖会话 Cookie', () => {
  it('不带任何 Cookie、令牌无效：401（走令牌分支，不走 requireTeacher 的 403）', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/teacher/attempts/${randomUUID()}/stream?token=bad` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain('镜像令牌');
  });
});
