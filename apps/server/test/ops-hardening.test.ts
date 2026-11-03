import { EventEmitter } from 'node:events';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Fastify from 'fastify';

import { trustNearestProxy } from '../src/app.ts';
import { createPgPool, PG_POOL_SETTINGS } from '../src/db/index.ts';
import { testConfig } from './support/fixtures.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

describe('pg 连接池', () => {
  it('池里空闲连接出错时触发 error 监听器，不会变成未捕获异常', async () => {
    const seen: Error[] = [];
    const pool = createPgPool('postgres://u:p@127.0.0.1:1/none', (error) => seen.push(error));
    expect(pool.listenerCount('error')).toBe(1);
    expect(() => (pool as unknown as EventEmitter).emit('error', new Error('terminating connection'))).not.toThrow();
    expect(seen.map((e) => e.message)).toEqual(['terminating connection']);
    await pool.end();
  });

  it('有连接、语句、空闲事务超时', () => {
    expect(PG_POOL_SETTINGS.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(PG_POOL_SETTINGS.statement_timeout).toBeGreaterThan(0);
    expect(PG_POOL_SETTINGS.idle_in_transaction_session_timeout).toBeGreaterThan(0);
  });
});

describe('会话级限流', () => {
  let fx: Fixture;
  let app: FastifyInstance;

  beforeEach(async () => {
    fx = await setupFixture();
    app = await buildTestApp(fx.db);
  });
  afterEach(async () => {
    await app.close();
    await fx.close();
  });

  async function sessionCookie(): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
    return cookieFrom(res.headers['set-cookie']);
  }

  it('/events/batch：超过上限的会话得到 429，另一个会话（同一 IP）不受影响', async () => {
    const heavy = await sessionCookie();
    const other = await sessionCookie();
    const send = (cookie: string) =>
      app.inject({ method: 'POST', url: '/api/v1/events/batch', headers: { cookie, ...WRITE_HEADERS }, payload: { events: [] } });

    for (let i = 0; i < testConfig.rateLimits.events; i += 1) expect((await send(heavy)).statusCode).toBe(200);
    const limited = await send(heavy);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect((await send(other)).statusCode).toBe(200);
  });

  it('默认上限：事件 120 次/分，求助 60 次/分（每会话）', () => {
    expect(testConfig.rateLimits).toEqual({ events: 120, help: 60 });
  });
});

describe('trustProxy（生产只信任最近一跳）', () => {
  it('客户端自己塞进 X-Forwarded-For 的地址不会成为 request.ip', async () => {
    const app = Fastify({ trustProxy: trustNearestProxy });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    // Caddy 会丢弃客户端自带的 XFF 再写入真实地址；这里模拟“上游没丢”的最坏情况：真实地址在最右，伪造的在左。
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '172.18.0.3',
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' },
    });
    expect(res.json().ip).toBe('203.0.113.9');
    await app.close();
  });
});
