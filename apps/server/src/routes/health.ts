import type { FastifyPluginAsync } from 'fastify';

import type { ModelGateway } from '../ai/gateway.ts';
import type { AppConfig } from '../config.ts';

export interface HealthRoutesOptions {
  config: AppConfig;
  gateway: ModelGateway;
}

// openapi /health：deps 是各外部依赖的状态（ok / degraded / down / disabled），flags 只含布尔开关。
// status 表示服务本身是否在运行。依赖降级不改变 HTTP 200，也不改变 status（tools/smoke.mjs 要求 status === 'ok'）。
export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health', async () => {
    const { deps } = options.gateway.health();
    const flags = Object.fromEntries(
      Object.entries(options.config.models.flags).filter(([, value]) => typeof value === 'boolean'),
    );
    return {
      ok: true,
      status: 'ok',
      service: 'proof-gym-server',
      env: options.config.env,
      uptimeSec: Math.round(process.uptime()),
      deps,
      flags,
    };
  });
};
