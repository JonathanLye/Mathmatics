import { EventEmitter } from 'node:events';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import Fastify from 'fastify';

import { buildApp, trustNearestProxy } from '../src/app.ts';
import { bySession, SESSION_COOKIE } from '../src/auth/session.ts';
import type { Pool } from 'pg';

import { createPgPool, pgDbFromPool, PG_POOL_SETTINGS } from '../src/db/index.ts';
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
    expect(testConfig.rateLimits).toEqual({ events: 120, help: 60, login: 120 });
  });
});

describe('会话级限流键', () => {
  const fakeRequest = (raw: string, valid: boolean, value: string): FastifyRequest =>
    ({
      cookies: { [SESSION_COOKIE]: raw },
      unsignCookie: () => ({ valid, value, renew: false }),
      ip: '203.0.113.5',
    }) as unknown as FastifyRequest;

  it('未签名或非 UUID 的 Cookie 回退到 IP，避免伪造 Cookie 单独开桶', () => {
    expect(bySession(fakeRequest('forged', false, 'forged'))).toBe('203.0.113.5');
    expect(bySession(fakeRequest('', false, ''))).toBe('203.0.113.5');
  });

  it('签名有效且是 UUID 的会话用自己的会话 id 作为键', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(bySession(fakeRequest(`signed.${id}`, true, id))).toBe(id);
  });
});

describe('构建 app 时复用外部 logger', () => {
  it('传入 loggerInstance 后 Fastify 用它的 child 作为 app.log（池错误等日志能进同一 pino）', async () => {
    const logger = pino({ level: 'silent' });
    const childSpy = vi.spyOn(logger, 'child');
    const app = await buildApp({ config: testConfig, loggerInstance: logger });
    expect(childSpy).toHaveBeenCalled();
    expect(app.log.level).toBe('silent');
    await app.close();
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

  it('端口被直接暴露时，单条 XFF 仍会被信任（记录该限制；主防线是 compose 只 expose 不 publish）', async () => {
    const app = Fastify({ trustProxy: trustNearestProxy });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '198.51.100.7',
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    expect(res.json().ip).toBe('203.0.113.99');
    await app.close();
  });
});

describe('pg 事务里借出的连接', () => {
  // 假连接：query 按脚本返回/抛错；release 记录参数。
  function fakePool(script: (sql: string) => void) {
    const client = Object.assign(new EventEmitter(), {
      released: [] as unknown[],
      query: async (sql: string) => {
        script(sql);
        return { rows: [], rowCount: 0 };
      },
      release(arg?: unknown) {
        this.released.push(arg);
      },
    });
    const pool = { connect: async () => client, on() {}, query: async () => ({ rows: [], rowCount: 0 }), end: async () => {} } as unknown as Pool;
    return { client, pool };
  }

  it('借出期间连接触发 error 不会变成未捕获异常，且归还后监听器已移除', async () => {
    const seen: Error[] = [];
    const { client, pool } = fakePool(() => {});
    const db = pgDbFromPool(pool, (error) => seen.push(error));

    await db.tx(async () => {
      expect(client.listenerCount('error')).toBe(1);
      expect(() => client.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    });

    expect(seen.map((e) => e.message)).toEqual(['terminating connection due to administrator command']);
    expect(client.listenerCount('error')).toBe(0);
    expect(client.released).toEqual([undefined]);
  });

  it('ROLLBACK 失败：抛出的仍是原始错误，连接带错误释放（销毁而不是放回池）', async () => {
    const { client, pool } = fakePool((sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
    });
    const db = pgDbFromPool(pool, () => {});

    await expect(
      db.tx(async () => {
        throw new Error('业务错误');
      }),
    ).rejects.toThrow('业务错误');
    expect(client.released).toHaveLength(1);
    expect((client.released[0] as Error).message).toBe('connection lost');
  });
});
