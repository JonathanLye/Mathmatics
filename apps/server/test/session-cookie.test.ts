import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// #67-1 / #58 评审 P2-2：会话 Cookie 的 Secure 属性只在生产/测试下强制；
// 开发环境要允许 http://内网IP 演示（Chrome 只对 localhost 接受 Secure Cookie）。
let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function loginSetCookie(instance: FastifyInstance): Promise<string> {
  const res = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody(),
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  expect(raw).toBeDefined();
  return String(Array.isArray(raw) ? raw[0] : raw);
}

describe('会话 Cookie 的 Secure 属性（#67）', () => {
  it('test（默认）环境带 Secure', async () => {
    expect(await loginSetCookie(app)).toMatch(/;\s*Secure/i);
  });

  it('development 环境不带 Secure（允许内网 http 演示），HttpOnly/SameSite 保留', async () => {
    const devApp = await buildTestApp(db, { env: 'development' });
    try {
      const cookie = await loginSetCookie(devApp);
      expect(cookie).not.toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      // 会话仍可用：登出应成功（清 Cookie 的属性与服务端一致）。
      const logout = await devApp.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { ...WRITE_HEADERS, cookie: cookie.split(';')[0] ?? '' },
      });
      expect(logout.statusCode).toBe(204);
      // 清 Cookie 的 Set-Cookie 属性须与登录一致：dev 下不带 Secure，否则浏览器会拒绝覆盖。
      const cleared = String([logout.headers['set-cookie']].flat()[0]);
      expect(cleared).toMatch(/pg_sid_s=;|pg_sid_s=\s*;|Expires=Thu, 01 Jan 1970|Max-Age=0/i);
      expect(cleared).not.toMatch(/;\s*Secure/i);
    } finally {
      await devApp.close();
    }
  });

  it('production 登出的清 Cookie 也带 Secure', async () => {
    const prodApp = await buildTestApp(db, { env: 'production' });
    try {
      const cookie = await loginSetCookie(prodApp);
      const logout = await prodApp.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { ...WRITE_HEADERS, cookie: cookie.split(';')[0] ?? '' },
      });
      expect(logout.statusCode).toBe(204);
      expect(String([logout.headers['set-cookie']].flat()[0])).toMatch(/;\s*Secure/i);
    } finally {
      await prodApp.close();
    }
  });

  it('production 环境带 Secure', async () => {
    const prodApp = await buildTestApp(db, { env: 'production' });
    try {
      expect(await loginSetCookie(prodApp)).toMatch(/;\s*Secure/i);
    } finally {
      await prodApp.close();
    }
  });
});
