import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { studentNoHash } from '../src/auth/crypto.ts';
import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';

import {
  buildTestApp,
  cookieFrom,
  DEVICE_A,
  DEVICE_B,
  loginBody,
  setupFixture,
    TEST_STUDENT_NO,
  testConfig,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another long passphrase';
const SECOND_INVITE = 'M4N8PQ';
const TEACHER = 'lin.teacher';
const TEACHER_PASSWORD = 'teacher-password-1';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;

async function startApp(overrides: Parameters<typeof buildTestApp>[1] = {}): Promise<void> {
  app = await buildTestApp(db, overrides);
}

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await startApp();
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

const post = (url: string, payload: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { ...WRITE_HEADERS, ...(cookie ? { cookie } : {}), ...extra },
    payload: payload as Record<string, unknown>,
  });
const get = (url: string, cookie?: string, extra: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { ...(cookie ? { cookie } : {}), ...extra } });

const login = (body: Record<string, unknown>) => post('/auth/student/login', body);
const errorOf = (res: LightMyRequestResponse) => res.json().error as { code: string; message: string; detail?: Record<string, unknown> };

// 邀请码首次登录（未设密码），返回会话 Cookie。
async function activate(overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await login(loginBody(overrides));
  expect(res.statusCode).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function activateAndSetPassword(password = PASSWORD): Promise<string> {
  const cookie = await activate();
  const res = await post('/auth/student/password', { newPassword: password }, cookie);
  expect(res.statusCode).toBe(200);
  return cookie;
}

async function addSecondClass(studentNos: string[] = [TEST_STUDENT_NO]): Promise<string> {
  const owner = (await db.query<{ owner_id: string }>('select owner_id from app.classes where id = $1', [fx.classId])).rows[0]?.owner_id;
  const cls = await db.query<{ id: string }>(
    `insert into app.classes (name, term, owner_id, invite_code) values ('线代 B 班', '2026 秋', $1, $2) returning id`,
    [owner, SECOND_INVITE],
  );
  const classId = cls.rows[0]?.id as string;
  for (const no of studentNos) {
    await db.query('insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)', [classId, studentNoHash(testConfig.studentNoPepper, no)]);
  }
  return classId;
}

describe('学生登录：邀请码激活与密码登录', () => {
  it('未设密码：邀请码 + 学号登录成功，Me.needsPassword=true；设好密码后变为 false', async () => {
    const res = await login(loginBody());
    expect(res.statusCode).toBe(200);
    contract.validate('Me', res.json());
    expect(res.json().needsPassword).toBe(true);
    const cookie = cookieFrom(res.headers['set-cookie']);

    const set = await post('/auth/student/password', { newPassword: PASSWORD }, cookie);
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ ok: true });
    const me = await get('/me', cookie);
    expect(me.json().needsPassword).toBe(false);
    contract.validate('Me', me.json());

    const row = await db.query<{ password_hash: string; password_set_at: string }>('select password_hash, password_set_at from app.student_profiles');
    expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0]?.password_set_at).not.toBeNull();
    expect(JSON.stringify(me.json())).not.toContain('argon2');
  });

  it('已设密码：学号 + 密码即可登录，不需要邀请码；needsPassword=false', async () => {
    await activateAndSetPassword();
    const res = await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_B });
    expect(res.statusCode).toBe(200);
    contract.validate('Me', res.json());
    expect(res.json()).toMatchObject({ role: 'student', needsPassword: false });
    expect(String(res.headers['set-cookie'])).toMatch(/^pg_sid_s=/);
  });

  it('已设密码的学号只凭邀请码不能登录：401 PASSWORD_REQUIRED_LOGIN（堵住同学冒登）', async () => {
    await activateAndSetPassword();
    const res = await login(loginBody({ deviceId: DEVICE_B }));
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toMatchObject({ code: 'PASSWORD_REQUIRED_LOGIN', message: '这个学号已设置密码，请用密码登录' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('密码错误、学号不存在、没设密码又没带邀请码：同一个 401 INVALID_CREDENTIALS 和同一句文案', async () => {
    await activateAndSetPassword();
    await db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [
      fx.classId,
      studentNoHash(testConfig.studentNoPepper, '2026002'),
    ]);
    await activate({ studentNo: '2026002', deviceId: DEVICE_B }); // 2026002 已激活但没设密码

    const attempts = [
      { studentNo: TEST_STUDENT_NO, password: 'wrong password!', deviceId: DEVICE_A }, // 已设密码，密码错
      { studentNo: '9999999', password: PASSWORD, deviceId: DEVICE_A }, // 学号不存在
      { studentNo: '2026002', password: PASSWORD, deviceId: DEVICE_A }, // 存在但没设密码，也没带邀请码
      { studentNo: '8888888', deviceId: DEVICE_A }, // 什么都没有
    ];
    const seen = new Set<string>();
    for (const body of attempts) {
      const res = await login(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(401);
      expect(errorOf(res).code).toBe('INVALID_CREDENTIALS');
      seen.add(errorOf(res).message);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect([...seen]).toEqual(['学号或密码不对']);
  });

  it('没设密码的学号：邀请码照旧可以登录，同时带了 password 也只是激活（不校验）', async () => {
    const res = await login(loginBody({ password: 'whatever-is-ignored' }));
    expect(res.statusCode).toBe(200);
    expect(res.json().needsPassword).toBe(true);
  });

  it('没设密码、邀请码不对：401 INVALID_INVITE；学号不在名单：403 NOT_IN_ROSTER（原有规则不变）', async () => {
    expect(errorOf(await login(loginBody({ inviteCode: 'ZZZZZZ' }))).code).toBe('INVALID_INVITE');
    const res = await login(loginBody({ studentNo: '7777777' }));
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('NOT_IN_ROSTER');
  });

  it('第二个班：学号 + 密码 + 新班邀请码入班；邀请码错 401、不在名单 403、已被别人认领 403', async () => {
    await activateAndSetPassword();
    const secondClass = await addSecondClass();

    const wrongInvite = await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, inviteCode: 'ZZZZZZ', deviceId: DEVICE_B });
    expect(wrongInvite.statusCode).toBe(401);
    expect(errorOf(wrongInvite).code).toBe('INVALID_INVITE');

    // 邀请码对、密码错：不能借邀请码入班
    const wrongPassword = await login({ studentNo: TEST_STUDENT_NO, password: 'wrong password!', inviteCode: SECOND_INVITE, deviceId: DEVICE_B });
    expect(errorOf(wrongPassword).code).toBe('INVALID_CREDENTIALS');
    expect((await db.query('select 1 from app.class_members where class_id = $1', [secondClass])).rows).toHaveLength(0);

    const joined = await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, inviteCode: SECOND_INVITE, deviceId: DEVICE_B });
    expect(joined.statusCode).toBe(200);
    expect((joined.json().classes as Array<{ id: string }>).map((c) => c.id).sort()).toEqual([fx.classId, secondClass].sort());
    const claimed = await db.query('select 1 from app.roster_entries where class_id = $1 and claimed_by is not null', [secondClass]);
    expect(claimed.rows).toHaveLength(1);
  });

  it('第二个班：该班名单里没有这个学号 → 403 NOT_IN_ROSTER，且不入班', async () => {
    await activateAndSetPassword();
    await addSecondClass(['5555555']);
    const res = await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, inviteCode: SECOND_INVITE, deviceId: DEVICE_B });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('NOT_IN_ROSTER');
    expect((await db.query('select 1 from app.class_members m join app.classes c on c.id = m.class_id where c.invite_code = $1', [SECOND_INVITE])).rows).toHaveLength(0);
  });

  it('请求体校验：缺学号 / 邀请码长度不对 → 422；邀请码和密码都可省略', async () => {
    expect((await login({ deviceId: DEVICE_A })).statusCode).toBe(422);
    expect((await login({ studentNo: TEST_STUDENT_NO, inviteCode: 'ABC', deviceId: DEVICE_A })).statusCode).toBe(422);
    // 邀请码和密码都省略 → 走 INVALID_CREDENTIALS，而不是校验失败
    expect((await login({ studentNo: TEST_STUDENT_NO, deviceId: DEVICE_A })).statusCode).toBe(401);
  });
});

describe('学生登录：失败锁定（复用 login-throttle）', () => {
  it('同一 (IP, 学号) 密码连错 5 次后锁定：第 6 次即使密码正确也是 429；锁定不影响别的学号', async () => {
    await activateAndSetPassword();
    for (let i = 0; i < 5; i += 1) {
      const res = await login({ studentNo: TEST_STUDENT_NO, password: `wrong password ${i}`, deviceId: DEVICE_A });
      expect(errorOf(res).code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_A });
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked)).toMatchObject({ code: 'RATE_LIMITED', detail: { retryAfterSec: expect.any(Number) } });

    const other = await login({ studentNo: '1234567', password: PASSWORD, deviceId: DEVICE_A });
    expect(other.statusCode).toBe(401);
  });

  it('成功登录会清零失败计数', async () => {
    await activateAndSetPassword();
    for (let i = 0; i < 4; i += 1) await login({ studentNo: TEST_STUDENT_NO, password: `wrong password ${i}`, deviceId: DEVICE_A });
    expect((await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_A })).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) await login({ studentNo: TEST_STUDENT_NO, password: `wrong password ${i}`, deviceId: DEVICE_A });
    expect((await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_A })).statusCode).toBe(200);
  });
});

describe('STUDENT_PASSWORD_ENFORCE：未设密码的学生被挡在设密码之前', () => {
  it('开启：除 /me、/auth/logout、/auth/student/password、/auth/logout-all 外的学生接口 403 PASSWORD_SETUP_REQUIRED', async () => {
    await app.close();
    await startApp({ studentPasswordEnforce: true });
    const cookie = await activate();

    for (const res of [
      await get('/consents', cookie),
      await get('/student/home', cookie),
      await post('/consents', { version: 'x', items: {} }, cookie),
      await post('/auth/student/age-band', { ageBand: 'ge18' }, cookie),
      await post('/events/batch', { events: [] }, cookie),
    ]) {
      expect(res.statusCode, res.body).toBe(403);
      expect(errorOf(res)).toMatchObject({ code: 'PASSWORD_SETUP_REQUIRED' });
      // 不能带 wrong_app：客户端要靠 code 把它路由到设密码页，而不是回登录页。
      expect(errorOf(res).detail?.reason).not.toBe('wrong_app');
    }

    const me = await get('/me', cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json().needsPassword).toBe(true);

    expect((await post('/auth/student/password', { newPassword: PASSWORD }, cookie)).statusCode).toBe(200);
    expect((await get('/consents', cookie)).statusCode).toBe(200);
    expect((await post('/auth/logout', {}, cookie)).statusCode).toBe(204);
  });

  it('开启：未设密码的学生也能退出所有设备', async () => {
    await app.close();
    await startApp({ studentPasswordEnforce: true });
    const cookie = await activate();
    expect((await post('/auth/logout-all', {}, cookie)).statusCode).toBe(204);
  });

  it('开启：教师不受影响；已设密码的学生不受影响', async () => {
    await app.close();
    await startApp({ studentPasswordEnforce: true });
    const cookie = await activate();
    await post('/auth/student/password', { newPassword: PASSWORD }, cookie);
    expect((await get('/consents', cookie)).statusCode).toBe(200);
    await createTeacherAccount(db, { username: TEACHER, password: TEACHER_PASSWORD });
    const t = await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD });
    expect((await get('/teacher/classes', cookieFrom(t.headers['set-cookie']))).statusCode).toBe(200);
  });

  it('关闭（测试/开发默认）：未设密码的学生照常使用，但 Me.needsPassword 仍如实返回 true', async () => {
    const cookie = await activate();
    expect((await get('/consents', cookie)).statusCode).toBe(200);
    expect((await get('/me', cookie)).json().needsPassword).toBe(true);
  });
});

describe('POST /auth/student/password', () => {
  it('策略不通过 → 422 VALIDATION_FAILED，message 可直接展示；库里没有写入', async () => {
    const cookie = await activate();
    for (const bad of ['short', '12345678', 'qwertyui', 'x'.repeat(65)]) {
      const res = await post('/auth/student/password', { newPassword: bad }, cookie);
      expect(res.statusCode, bad).toBe(422);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      expect(errorOf(res).message).toMatch(/密码/);
    }
    const row = await db.query<{ password_hash: string | null }>('select password_hash from app.student_profiles');
    expect(row.rows[0]?.password_hash).toBeNull();
  });

  it('不能与学号相同', async () => {
    await db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [
      fx.classId,
      studentNoHash(testConfig.studentNoPepper, '20269999'),
    ]);
    const cookie = await activate({ studentNo: '20269999' });
    const res = await post('/auth/student/password', { newPassword: '20269999' }, cookie);
    expect(res.statusCode).toBe(422);
    expect(errorOf(res).message).toMatch(/学号/);
  });

  it('改密：必须带当前密码；缺失 422、错误 403 INVALID_CREDENTIALS（不是 401，会话保持有效）', async () => {
    const cookie = await activateAndSetPassword();
    const missing = await post('/auth/student/password', { newPassword: NEW_PASSWORD }, cookie);
    expect(missing.statusCode).toBe(422);
    const wrong = await post('/auth/student/password', { currentPassword: 'not the password', newPassword: NEW_PASSWORD }, cookie);
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
    expect(errorOf(wrong).detail?.reason).not.toBe('wrong_app');
    expect((await get('/me', cookie)).statusCode).toBe(200);
  });

  it('改密成功：旧密码失效、新密码可登录、其他会话被作废、当前会话保留', async () => {
    const cookie = await activateAndSetPassword();
    const other = cookieFrom((await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_B })).headers['set-cookie']);
    expect((await get('/me', other)).statusCode).toBe(200);

    const res = await post('/auth/student/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect((await get('/me', other)).statusCode).toBe(401);
    expect((await get('/me', cookie)).statusCode).toBe(200);
    expect(errorOf(await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_A })).code).toBe('INVALID_CREDENTIALS');
    expect((await login({ studentNo: TEST_STUDENT_NO, password: NEW_PASSWORD, deviceId: DEVICE_A })).statusCode).toBe(200);
  });

  it('新密码与当前密码相同 → 422', async () => {
    const cookie = await activateAndSetPassword();
    const res = await post('/auth/student/password', { currentPassword: PASSWORD, newPassword: PASSWORD }, cookie);
    expect(res.statusCode).toBe(422);
  });

  it('当前密码连错 5 次 → 429；之后即使当前密码正确也要等（偷到 Cookie 不能拿它当密码校验器）', async () => {
    const cookie = await activateAndSetPassword();
    for (let i = 0; i < 5; i += 1) {
      const res = await post('/auth/student/password', { currentPassword: `guess number ${i}`, newPassword: NEW_PASSWORD }, cookie);
      expect(res.statusCode).toBe(403);
    }
    const locked = await post('/auth/student/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, cookie);
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked).code).toBe('RATE_LIMITED');
  });

  it('鉴权：无会话 401；教师 Cookie 403 wrong_app；请求体多余字段 422', async () => {
    expect((await post('/auth/student/password', { newPassword: PASSWORD })).statusCode).toBe(401);
    await createTeacherAccount(db, { username: TEACHER, password: TEACHER_PASSWORD });
    const t = await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD });
    const wrongApp = await post('/auth/student/password', { newPassword: PASSWORD }, cookieFrom(t.headers['set-cookie']).replace('pg_sid_t', 'pg_sid_s'));
    // Cookie 签名只签会话 id、不含名字：把教师会话放进 pg_sid_s，等于“教师会话打到学生接口”。
    expect(wrongApp.statusCode).toBe(403);
    expect(errorOf(wrongApp).detail).toMatchObject({ reason: 'wrong_app' });
    const cookie = await activate();
    expect((await post('/auth/student/password', { newPassword: PASSWORD, extra: 1 }, cookie)).statusCode).toBe(422);
  });

  it('Idempotency-Key：同键重放返回首次响应，不重复执行', async () => {
    const cookie = await activate();
    const key = randomUUID();
    const first = await post('/auth/student/password', { newPassword: PASSWORD }, cookie, { 'idempotency-key': key });
    expect(first.statusCode).toBe(200);
    const replay = await post('/auth/student/password', { newPassword: PASSWORD }, cookie, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBeDefined();
    expect(replay.json()).toEqual({ ok: true });
  });
});

describe('POST /auth/logout-all', () => {
  it('学生：作废该学生全部会话并清 Cookie', async () => {
    const a = await activateAndSetPassword();
    const b = cookieFrom((await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_B })).headers['set-cookie']);
    const res = await post('/auth/logout-all', {}, a);
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/pg_sid_s=;/);
    expect((await get('/me', a)).statusCode).toBe(401);
    expect((await get('/me', b)).statusCode).toBe(401);
  });

  it('同一浏览器两端互不影响：学生退出所有设备不动教师会话；教师（带 x-pg-app: teacher）只动教师会话', async () => {
    await createTeacherAccount(db, { username: TEACHER, password: TEACHER_PASSWORD });
    const t = cookieFrom((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).headers['set-cookie']);
    const s = await activate();

    expect((await post('/auth/logout-all', {}, `${s}; ${t}`)).statusCode).toBe(204);
    expect((await get('/me', `${s}; ${t}`)).statusCode).toBe(401);
    expect((await get('/me', `${s}; ${t}`, { 'x-pg-app': 'teacher' })).statusCode).toBe(200);

    const t2 = cookieFrom((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).headers['set-cookie']);
    const res = await post('/auth/logout-all', {}, t2, { 'x-pg-app': 'teacher' });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/pg_sid_t=;/);
    expect((await get('/me', t, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
    expect((await get('/me', t2, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
  });

  it('未登录 401', async () => {
    expect((await post('/auth/logout-all', {})).statusCode).toBe(401);
  });
});

describe('教师重置学生密码', () => {
  let teacherCookie: string;
  let rosterId: string;

  beforeEach(async () => {
    const teacherId = (await createTeacherAccount(db, { username: TEACHER, password: TEACHER_PASSWORD })).userId;
    await db.query('update app.classes set owner_id = $1 where id = $2', [teacherId, fx.classId]);
    teacherCookie = cookieFrom((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).headers['set-cookie']);
    rosterId = (await db.query<{ id: string }>('select id from app.roster_entries where class_id = $1', [fx.classId])).rows[0]?.id as string;
  });

  const reset = (cookie: string, classId = fx.classId, id = rosterId) =>
    post(`/teacher/classes/${classId}/roster/${id}/reset-password`, {}, cookie);
  const roster = async () => (await get(`/teacher/classes/${fx.classId}/roster`, teacherCookie)).json() as Array<Record<string, unknown>>;

  it('名单 DTO 带 passwordSet：未认领 false → 激活未设密码 false → 设密码 true → 重置后 false', async () => {
    let rows = await roster();
    for (const row of rows) contract.validate('RosterEntry', row);
    expect(rows[0]?.passwordSet).toBe(false);
    const cookie = await activate();
    expect((await roster())[0]?.passwordSet).toBe(false);
    await post('/auth/student/password', { newPassword: PASSWORD }, cookie);
    rows = await roster();
    expect(rows[0]).toMatchObject({ claimed: true, passwordSet: true });
    expect((await reset(teacherCookie)).statusCode).toBe(204);
    expect((await roster())[0]).toMatchObject({ claimed: true, passwordSet: false });
  });

  it('重置：清哈希与 set_at、作废该生全部会话、写 audit_log；之后密码登录失败，用邀请码重新激活并设新密码', async () => {
    const cookie = await activateAndSetPassword();
    const res = await reset(teacherCookie);
    expect(res.statusCode).toBe(204);

    const row = await db.query<{ password_hash: string | null; password_set_at: string | null }>('select password_hash, password_set_at from app.student_profiles');
    expect(row.rows[0]).toEqual({ password_hash: null, password_set_at: null });
    expect((await get('/me', cookie)).statusCode).toBe(401);
    expect(errorOf(await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_A })).code).toBe('INVALID_CREDENTIALS');

    const audit = await db.query<{ actor_id: string; target: string; detail: Record<string, unknown> }>(
      `select actor_id, target, detail from app.audit_log where action = 'reset_student_password'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.target).toBe(rosterId);
    expect(JSON.stringify(audit.rows[0]?.detail)).not.toContain(PASSWORD);

    const again = await login(loginBody({ deviceId: DEVICE_B }));
    expect(again.statusCode).toBe(200);
    expect(again.json().needsPassword).toBe(true);
    const fresh = cookieFrom(again.headers['set-cookie']);
    expect((await post('/auth/student/password', { newPassword: NEW_PASSWORD }, fresh)).statusCode).toBe(200);
    expect((await login({ studentNo: TEST_STUDENT_NO, password: NEW_PASSWORD, deviceId: DEVICE_A })).statusCode).toBe(200);
  });

  it('别的教师（不是这个班的）重置 → 404，学生密码原样；学生 Cookie 调用 403 wrong_app；无会话 401', async () => {
    await activateAndSetPassword();
    await createTeacherAccount(db, { username: 'other.teacher', password: TEACHER_PASSWORD });
    const other = cookieFrom((await post('/auth/teacher/login', { username: 'other.teacher', password: TEACHER_PASSWORD })).headers['set-cookie']);
    const res = await reset(other);
    expect(res.statusCode).toBe(404);
    const row = await db.query<{ password_hash: string | null }>('select password_hash from app.student_profiles');
    expect(row.rows[0]?.password_hash).not.toBeNull();

    const studentCookie = cookieFrom((await login({ studentNo: TEST_STUDENT_NO, password: PASSWORD, deviceId: DEVICE_B })).headers['set-cookie']);
    const asStudent = await reset(studentCookie);
    expect(asStudent.statusCode).toBe(403);
    expect(errorOf(asStudent).detail).toMatchObject({ reason: 'wrong_app' });
    expect((await reset('')).statusCode).toBe(401);
  });

  it('名单行未认领 → 404；名单行属于别的班 → 404；id 不是 uuid → 404', async () => {
    expect((await reset(teacherCookie)).statusCode).toBe(404);
    const secondClass = await addSecondClass(['6666666']);
    await db.query('update app.classes set owner_id = (select owner_id from app.classes where id = $1) where id = $2', [fx.classId, secondClass]);
    const otherEntry = (await db.query<{ id: string }>('select id from app.roster_entries where class_id = $1', [secondClass])).rows[0]?.id as string;
    await activateAndSetPassword();
    expect((await reset(teacherCookie, fx.classId, otherEntry)).statusCode).toBe(404);
    expect((await reset(teacherCookie, fx.classId, 'not-a-uuid')).statusCode).toBe(404);
  });

  it('解除认领会作废该生全部会话（unclaimRoster）', async () => {
    const cookie = await activateAndSetPassword();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teacher/classes/${fx.classId}/roster/${rosterId}`,
      headers: { ...WRITE_HEADERS, cookie: teacherCookie },
    });
    expect(res.statusCode).toBe(204);
    expect((await get('/me', cookie)).statusCode).toBe(401);
  });
});

describe('POST /auth/teacher/password', () => {
  let teacherCookie: string;

  beforeEach(async () => {
    await createTeacherAccount(db, { username: TEACHER, password: TEACHER_PASSWORD });
    teacherCookie = cookieFrom((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).headers['set-cookie']);
  });

  const change = (payload: Record<string, unknown>, cookie = teacherCookie) => post('/auth/teacher/password', payload, cookie);

  it('改密成功：新密码可登录、旧密码失效、其他会话作废、当前会话保留', async () => {
    const other = cookieFrom((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).headers['set-cookie']);
    const res = await change({ currentPassword: TEACHER_PASSWORD, newPassword: 'brand-new-teacher-pw' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect((await get('/me', other, { 'x-pg-app': 'teacher' })).statusCode).toBe(401);
    expect((await get('/me', teacherCookie, { 'x-pg-app': 'teacher' })).statusCode).toBe(200);
    expect((await post('/auth/teacher/login', { username: TEACHER, password: TEACHER_PASSWORD })).statusCode).toBe(401);
    expect((await post('/auth/teacher/login', { username: TEACHER, password: 'brand-new-teacher-pw' })).statusCode).toBe(200);
  });

  it('当前密码不对 → 403 INVALID_CREDENTIALS（不是 401）；新密码少于 8 位 → 422；连错 5 次 → 429', async () => {
    const wrong = await change({ currentPassword: 'nope-nope-nope', newPassword: 'brand-new-teacher-pw' });
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
    expect((await change({ currentPassword: TEACHER_PASSWORD, newPassword: 'short' })).statusCode).toBe(422);
    for (let i = 0; i < 4; i += 1) await change({ currentPassword: `guess ${i} guess`, newPassword: 'brand-new-teacher-pw' });
    expect((await change({ currentPassword: TEACHER_PASSWORD, newPassword: 'brand-new-teacher-pw' })).statusCode).toBe(429);
  });

  it('学生 Cookie 调用 403 wrong_app；无会话 401', async () => {
    const student = await activate();
    const res = await post('/auth/teacher/password', { currentPassword: 'x'.repeat(8), newPassword: 'y'.repeat(8) }, student.replace('pg_sid_s', 'pg_sid_t'));
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).detail).toMatchObject({ reason: 'wrong_app' });
    expect((await post('/auth/teacher/password', { currentPassword: 'x'.repeat(8), newPassword: 'y'.repeat(8) })).statusCode).toBe(401);
  });
});
