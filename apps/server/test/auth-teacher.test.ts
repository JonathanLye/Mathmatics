import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount, MIN_PASSWORD_LENGTH } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';

import { buildTestApp, cookieFrom, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const contract = loadContract();
const USERNAME = 'lin.teacher';
const PASSWORD = 'correct horse battery';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

function login(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/teacher/login', headers: WRITE_HEADERS, payload: body });
}

describe('教师密码登录', () => {
  it('正确的用户名和密码：返回 Me（role=teacher，不需要同意书），下发会话 Cookie', async () => {
    const res = await login({ username: USERNAME, password: PASSWORD });

    expect(res.statusCode).toBe(200);
    const me = res.json();
    contract.validate('Me', me);
    expect(me).toMatchObject({ role: 'teacher', consentRequired: false });
    expect(me.anonCode).toMatch(/^T-/);
    expect(String(res.headers['set-cookie'])).toMatch(/^pg_sid=/);
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('教师会话 12 小时有效（05 §7）', async () => {
    const res = await login({ username: USERNAME, password: PASSWORD });
    expect(res.statusCode).toBe(200);

    const row = await db.query<{ ttl_sec: number; device_id: string | null }>(
      `select extract(epoch from (expires_at - now()))::int as ttl_sec, device_id
         from app.auth_sessions s join app.users u on u.id = s.user_id
        where u.role = 'teacher'`,
    );
    const hours = (row.rows[0]?.ttl_sec ?? 0) / 3600;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect(row.rows[0]?.device_id).toBeNull();
  });

  it('管理员账号登录：返回 role=admin（不写死为 teacher）', async () => {
    await createTeacherAccount(db, { username: 'root.admin', password: PASSWORD });
    await db.query(`update app.users set role = 'admin' where id in (select user_id from app.teacher_accounts where username = 'root.admin')`);

    const res = await login({ username: 'root.admin', password: PASSWORD });

    expect(res.statusCode).toBe(200);
    contract.validate('Me', res.json());
    expect(res.json().role).toBe('admin');
  });

  it('带教师 Cookie 访问 /me 成功', async () => {
    const cookie = cookieFrom((await login({ username: USERNAME, password: PASSWORD })).headers['set-cookie']);

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('teacher');
  });

  it('密码错误：401，错误信息与用户名不存在时完全一致（不枚举账号）', async () => {
    const wrongPassword = await login({ username: USERNAME, password: 'wrong password here' });
    const unknownUser = await login({ username: 'nobody', password: 'wrong password here' });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error).toEqual(unknownUser.json().error);
    expect(wrongPassword.json().error.code).toBe('UNAUTHORIZED');
  });

  it('账号停用后不能登录（同样返回 401）', async () => {
    await db.query(`update app.users set status = 'disabled' where id in (select user_id from app.teacher_accounts)`);

    const res = await login({ username: USERNAME, password: PASSWORD });

    expect(res.statusCode).toBe(401);
  });

  it('学生账号即使误挂在教师账号表里，也不能用教师登录（角色限定为 teacher/admin）', async () => {
    await db.query(`update app.users set role = 'student' where id in (select user_id from app.teacher_accounts)`);

    const res = await login({ username: USERNAME, password: PASSWORD });

    expect(res.statusCode).toBe(401);
  });

  it('开启了 TOTP 的账号：拒绝登录（第二因素未实现，不能忽略）', async () => {
    await db.query(`update app.teacher_accounts set totp_secret_enc = $1`, [Buffer.from('placeholder')]);

    const res = await login({ username: USERNAME, password: PASSWORD });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain('两步验证');
  });

  it('缺少密码字段：422 VALIDATION_FAILED', async () => {
    const res = await login({ username: USERNAME });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('创建教师账号（运维入口）', () => {
  it('密码少于最短长度时拒绝创建', async () => {
    await expect(
      createTeacherAccount(db, { username: 'short.pw', password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) }),
    ).rejects.toThrow(/密码至少/);
  });

  it('存储的是 argon2id 哈希，不是明文', async () => {
    const row = await db.query<{ password_hash: string }>(
      `select password_hash from app.teacher_accounts where username = $1`,
      [USERNAME],
    );
    expect(row.rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.rows[0]?.password_hash).not.toContain(PASSWORD);
  });
});
