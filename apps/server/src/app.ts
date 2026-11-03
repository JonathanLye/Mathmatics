import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { createModelGateway } from './ai/gateway.ts';
import { loadConfig, type AppConfig } from './config.ts';
import { loadContract } from './contract.ts';
import type { Db } from './db/index.ts';
import { AppError, registerErrorHandler } from './errors.ts';
import { healthRoutes } from './routes/health.ts';
import { apiRoutes } from './routes/api.ts';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: boolean;
  // 不传则不挂载 /api/v1（只有 /health），便于不依赖数据库的测试。
  db?: Db;
}

// 只信任最近的一跳（hop 0 = 与服务直接相连的 Caddy）；更远的 X-Forwarded-For 条目一律不信。
export const trustNearestProxy = (_address: string, hop: number): boolean => hop < 1;

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    // 生产只经过 Caddy 一跳（infra/Caddyfile），所以只信任最近的一跳（hop 0）。不用 true：true 会信任任意长度的 X-Forwarded-For，
    // 一旦端口被直接暴露或前面再加一层代理，客户端就能伪造 IP 绕过限流。
    trustProxy: config.env === 'production' ? trustNearestProxy : false,
  });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 429, '操作太频繁，请稍后再试'),
  });
  // 网关只在有数据库时才能调用（审计写 app.model_calls）；/health 不需要数据库，两种情况都能报告依赖状态。
  const gateway = createModelGateway({ registry: config.models, db: options.db });
  await app.register(healthRoutes, { config, gateway });

  if (options.db) {
    await app.register(apiRoutes, { prefix: '/api/v1', db: options.db, config, contract: loadContract() });
  }

  return app;
}
