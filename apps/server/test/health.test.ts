import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const apps: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(env: NodeJS.ProcessEnv = {}) {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', ...env }), logger: false });
  apps.push(app);
  return app;
}

describe('GET /health（公开）', () => {
  it('只返回 ok / status / service，不含依赖、开关、环境或运行时长', async () => {
    const app = await appWith({ HEALTH_TOKEN: 'secret-health-token' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: 'ok', service: 'proof-gym-server' });
  });
});

describe('GET /health/details（x-health-token）', () => {
  const TOKEN = 'secret-health-token';
  const details = (app: Awaited<ReturnType<typeof appWith>>, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: '/health/details', headers });

  it('未配置 HEALTH_TOKEN：一律 404，即使带了任意令牌', async () => {
    const app = await appWith();
    expect((await details(app)).statusCode).toBe(404);
    expect((await details(app, { 'x-health-token': '' })).statusCode).toBe(404);
    expect((await details(app, { 'x-health-token': 'anything' })).statusCode).toBe(404);
  });

  it('令牌缺失或不符：404，且响应体与未知路由一致', async () => {
    const app = await appWith({ HEALTH_TOKEN: TOKEN });
    const unknown = await app.inject({ method: 'GET', url: '/no-such-route' });
    for (const headers of [{}, { 'x-health-token': 'wrong' }, { 'x-health-token': `${TOKEN}x` }, { 'x-health-token': TOKEN.slice(1) }]) {
      const res = await details(app, headers);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ...unknown.json(), message: res.json().message });
      expect(res.body).not.toContain('deps');
    }
  });

  it('令牌正确：返回 env、uptimeSec、deps、flags', async () => {
    const app = await appWith({ HEALTH_TOKEN: TOKEN });
    const res = await details(app, { 'x-health-token': TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'ok', service: 'proof-gym-server', env: 'test' });
    expect(typeof res.json().uptimeSec).toBe('number');
    expect(res.json().deps).toBeTypeOf('object');
    expect(res.json().flags).toBeTypeOf('object');
  });
});
