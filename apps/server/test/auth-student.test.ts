import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptPii } from '../src/auth/crypto.ts';
import { loadContract } from '../src/contract.ts';
import { LOGIN_MAX_PER_MINUTE } from '../src/routes/auth.ts';
import type { Db } from '../src/db/index.ts';

import {
  buildTestApp,
  cookieFrom,
  DEVICE_A,
  DEVICE_B,
  loginBody,
  setupFixture,
  TEST_INVITE,
  TEST_STUDENT_NO,
  testConfig,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  app = await buildTestApp(db);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

function login(body: Record<string, unknown> = loginBody(), headers: Record<string, string> = WRITE_HEADERS) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers, payload: body });
}

describe('学生登录（邀请码 + 学号，认领名单）', () => {
  it('首次登录成功：返回 Me（符合契约）并下发 HttpOnly/Secure/SameSite=Lax 的签名 Cookie', async () => {
    const res = await login();

    expect(res.statusCode).toBe(200);
    const me = res.json();
    contract.validate('Me', me);
    expect(me).toMatchObject({ role: 'student', consentRequired: true });
    expect(me.anonCode).toMatch(/^S-[2-9A-HJKMNP-Z]{6}$/);
    expect(me.classes).toEqual([{ id: fx.classId, name: '高数 A 班' }]);

    const setCookie = String(res.headers['set-cookie']);
    // @fastify/cookie 的签名格式：<值>.<HMAC>，值是会话 uuid。
    expect(setCookie).toMatch(/^pg_sid_s=[0-9a-f-]{36}\.[A-Za-z0-9+/_-]+;/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('学号只存哈希与密文：明文学号不出现在库里，且能用 PII_KEY 解密', async () => {
    await login();

    const row = await db.query<{ student_no_enc: Uint8Array; student_no_hash: string }>(
      'select student_no_enc, student_no_hash from app.student_profiles',
    );
    const stored = row.rows[0];
    expect(stored?.student_no_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(stored?.student_no_enc ?? []).includes(TEST_STUDENT_NO)).toBe(false);
    expect(decryptPii(testConfig.piiKey, Buffer.from(stored?.student_no_enc ?? []))).toBe(TEST_STUDENT_NO);
  });

  it('学号按 NFKC 归一：全角数字与半角登录得到同一账号', async () => {
    const first = await login(loginBody({ studentNo: '２０２６００１' }));
    const second = await login(loginBody({ deviceId: DEVICE_B }));

    expect(first.statusCode).toBe(200);
    expect(second.json().userId).toBe(first.json().userId);
  });

  it('同一学号换设备再登录：仍是同一账号，名单行记录认领人', async () => {
    const first = await login();
    const second = await login(loginBody({ deviceId: DEVICE_B }));

    expect(second.statusCode).toBe(200);
    expect(second.json().userId).toBe(first.json().userId);

    const counts = await db.query<{ n: number }>('select count(*)::int as n from app.users where role = $1', [
      'student',
    ]);
    expect(counts.rows[0]?.n).toBe(1);
    const roster = await db.query<{ claimed_by: string | null }>('select claimed_by from app.roster_entries');
    expect(roster.rows[0]?.claimed_by).toBe(first.json().userId);
  });

  it('邀请码错误：401 INVALID_INVITE', async () => {
    const res = await login(loginBody({ inviteCode: 'ZZZZZZ' }));

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_INVITE');
  });

  it('学号不在名单：403 NOT_IN_ROSTER，且不创建账号', async () => {
    const res = await login(loginBody({ studentNo: '2099999' }));

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_IN_ROSTER');
    const counts = await db.query<{ n: number }>('select count(*)::int as n from app.users');
    expect(counts.rows[0]?.n).toBe(1);
  });

  it('已归档的班级邀请码无效', async () => {
    await db.query('update app.classes set archived_at = now()');

    const res = await login();

    expect(res.json().error.code).toBe('INVALID_INVITE');
  });

  it('账号被停用后不能登录：403 FORBIDDEN', async () => {
    await login();
    await db.query(`update app.users set status = 'disabled' where role = 'student'`);

    const res = await login(loginBody({ deviceId: DEVICE_B }));

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('请求体缺字段：422 VALIDATION_FAILED', async () => {
    const res = await login({ inviteCode: TEST_INVITE, studentNo: TEST_STUDENT_NO });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('写请求缺少 X-Requested-With：403 FORBIDDEN（防登录 CSRF）', async () => {
    const res = await login(loginBody(), {});

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('同一 IP（校园出口）一分钟内 120 次登录都不被限流；超过上限后 429 RATE_LIMITED', async () => {
    // 用成功登录凑满配额：失败尝试会先触发「登录失败锁定」（#61，5 次/10 分钟），
    // 那是另一层保护（login-protection.test.ts 覆盖），这里只验证同 IP 的 rateLimit。
    for (let i = 0; i < LOGIN_MAX_PER_MINUTE; i += 1) {
      const res = await login(loginBody());
      expect(res.statusCode).toBe(200);
    }

    const res = await login(loginBody());
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('会话：/me、登出、过期与篡改', () => {
  it('带 Cookie 访问 /me 返回当前用户；无 Cookie 为 401', async () => {
    const cookie = cookieFrom((await login()).headers['set-cookie']);

    const ok = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    contract.validate('Me', ok.json());

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe('UNAUTHORIZED');
  });

  it('篡改签名的 Cookie 被拒绝：401', async () => {
    const cookie = cookieFrom((await login()).headers['set-cookie']);
    const forged = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: forged } });

    expect(res.statusCode).toBe(401);
  });

  it('登出后旧 Cookie 立即失效（服务端吊销）', async () => {
    const cookie = cookieFrom((await login()).headers['set-cookie']);

    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, ...WRITE_HEADERS },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^pg_sid_s=;/);

    const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('会话过期后 /me 为 401', async () => {
    const cookie = cookieFrom((await login()).headers['set-cookie']);
    await db.query(`update app.auth_sessions set expires_at = now() - interval '1 minute'`);

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

    expect(res.statusCode).toBe(401);
  });

  it('账号停用后，已有会话也失效', async () => {
    const cookie = cookieFrom((await login()).headers['set-cookie']);
    await db.query(`update app.users set status = 'disabled'`);

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

    expect(res.statusCode).toBe(401);
  });

  it('未登录调用登出：401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: WRITE_HEADERS });

    expect(res.statusCode).toBe(401);
  });
});
