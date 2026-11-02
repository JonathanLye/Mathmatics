import type { FastifyPluginAsync } from 'fastify';

import type { AppConfig } from '../config.ts';

export interface HealthRoutesOptions {
  config: AppConfig;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'proof-gym-server',
    env: options.config.env,
    uptimeSec: Math.round(process.uptime()),
  }));
};
