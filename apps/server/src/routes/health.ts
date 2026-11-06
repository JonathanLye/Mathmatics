import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import type { ModelGateway } from '../ai/gateway.ts';
import type { AppConfig } from '../config.ts';

export interface HealthRoutesOptions {
  config: AppConfig;
  gateway: ModelGateway;
}

function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  // 先做摘要再比较：长度固定，timingSafeEqual 不会因长度不同抛错，也不泄露令牌长度。
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

// openapi /health（公开）：只说明服务在运行，不含依赖与开关（tools/smoke.mjs、compose 健康检查、值守探活用）。
// /health/details（x-health-token）：env、uptime、各外部依赖状态（ok / degraded / down / disabled）与布尔开关。
// 依赖降级不改变 HTTP 200，也不改变 status（tools/smoke.mjs 要求 status === 'ok'）。
export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health', async () => ({ ok: true, status: 'ok', service: 'proof-gym-server' }));

  app.get('/health/details', async (request, reply) => {
    const expected = options.config.healthToken;
    // 未配置或令牌不符都走框架的 404（与未知路由完全一样）：不暴露明细接口存在，也不区分两种情况。
    if (expected === undefined || !tokenMatches(expected, request.headers['x-health-token'])) {
      return reply.callNotFound();
    }
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
