import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { totpCode } from '../src/auth/totp.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';

import { buildTestApp, cookieFrom, setupFixture, testConfig, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// #60：教师登录 TOTP 二次验证（RFC 6238）。密码错与验证码错返回同一 401 文案，不泄露密码是否正确。
const contract = loadContract();
const USERNAME = 'totp.teacher';
const PASSWORD = 'correct horse battery';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let totpSecret: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  app = await buildTestApp(db);
  const created = await createTeacherAccount(db, {
    username: USERNAME,
    password: PASSWORD,
    enableTotp: true,
    piiKey: testConfig.piiKey,
  });
  expect(created.totpSecret).toBeDefined();
  totpSecret = created.totpSecret as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

const login = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/teacher/login', headers: WRITE_HEADERS, payload });

describe('教师登录 TOTP 二次验证（#60）', () => {
  it('启用 TOTP：缺验证码/错验证码 401，正确验证码登录成功', async () => {
    const missing = await login({ username: USERNAME, password: PASSWORD });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('UNAUTHORIZED');

    const wrong = await login({ username: USERNAME, password: PASSWORD, totp: '000000' });
    expect(wrong.statusCode).toBe(401);

    const ok = await login({ username: USERNAME, password: PASSWORD, totp: totpCode(totpSecret, Date.now()) });
    expect(ok.statusCode, JSON.stringify(ok.json())).toBe(200);
    contract.validate('Me', ok.json());
    expect(ok.json().role).toBe('teacher');
    expect(cookieFrom(ok.headers['set-cookie'])).toContain('pg_sid=');
  });

  it('密码错误时不验证 TOTP：同一 401 文案（不泄露密码是否正确）', async () => {
    const res = await login({
      username: USERNAME,
      password: 'wrong password',
      totp: totpCode(totpSecret, Date.now()),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('用户名或密码不对');
  });

  it('未启用 TOTP 的账号：不带验证码可登录', async () => {
    await createTeacherAccount(db, { username: 'plain.teacher', password: PASSWORD, piiKey: testConfig.piiKey });
    const ok = await login({ username: 'plain.teacher', password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe('teacher');
  });

  it('验证码非 6 位数字：契约校验 422，不进入密码校验', async () => {
    const res = await login({ username: USERNAME, password: PASSWORD, totp: 'abc' });
    expect(res.statusCode).toBe(422);
  });
});
