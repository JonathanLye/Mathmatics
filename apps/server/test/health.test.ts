import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const config = loadConfig({ NODE_ENV: 'test' });

describe('GET /health', () => {
  it('returns ok with service identity', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', service: 'proof-gym-server' });
    } finally {
      await app.close();
    }
  });
});
