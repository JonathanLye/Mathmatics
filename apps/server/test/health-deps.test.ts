import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const DEPS = ['ok', 'degraded', 'down', 'disabled'];
const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function health(env: NodeJS.ProcessEnv) {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', ...env }), logger: false });
  apps.push(app);
  return app.inject({ method: 'GET', url: '/health' });
}

describe('GET /health 依赖状态', () => {
  it('没有 key：HTTP 仍为 200，status 仍为 ok，typesafe 显示 degraded', async () => {
    const res = await health({});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: 'ok', deps: { typesafe: 'degraded' } });
  });

  it('配好 key：typesafe 为 ok', async () => {
    const res = await health({ JEV_BASE_URL: 'https://jev.test', JEV_API_KEY: 'test-key-not-real' });
    expect(res.json().deps.typesafe).toBe('ok');
  });

  it('deps 的值都在 openapi 枚举内，flags 只含布尔值', async () => {
    const body = (await health({})).json() as { deps: Record<string, string>; flags: Record<string, unknown> };
    for (const state of Object.values(body.deps)) expect(DEPS).toContain(state);
    for (const value of Object.values(body.flags)) expect(typeof value).toBe('boolean');
    expect(body.flags['jev.shadowOnly']).toBe(true);
    expect(body.flags).not.toHaveProperty('ocr.primary');
  });
});
