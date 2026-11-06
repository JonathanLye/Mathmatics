import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { createModelGateway } from './ai/gateway.ts';
import { loadConfig, type AppConfig } from './config.ts';
import { requestSerializer } from './logging.ts';
import { loadContract } from './contract.ts';
import type { Db } from './db/index.ts';
import { AppError, registerErrorHandler } from './errors.ts';
import { healthRoutes } from './routes/health.ts';
import { apiRoutes } from './routes/api.ts';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: boolean;
  // server.ts 已经建好 pino 实例时传进来，让池错误等生命周期日志与 Fastify 共用同一个结构化 logger。
  loggerInstance?: FastifyBaseLogger;
  // 不传则不挂载 /api/v1（只有 /health），便于不依赖数据库的测试。
  db?: Db;
  // 测试注入：模型网关的 HTTP 实现（不传则用全局 fetch）。
  fetchImpl?: typeof fetch;
}

// 生产只经过 Caddy 一跳（infra/Caddyfile），所以信任 hop 0（与服务直接相连的 Caddy）写入的 X-Forwarded-For。
// 注意：hop 数本身不能验证对端身份。主防线是 compose 只 expose、不 publish，外部无法直连 server；
// 若端口被直接暴露，客户端把想伪造的地址放在 XFF 最后一项仍会生效（见 test/ops-hardening.test.ts）。
// 要彻底防住，需要按 Caddy 所在网段做 CIDR 信任；当前部署不暴露端口，暂不引入固定子网。
export const trustNearestProxy = (_address: string, hop: number): boolean => hop < 1;

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : { logger: options.logger === false ? false : { level: config.logLevel, serializers: { req: requestSerializer } } }),
    trustProxy: config.env === 'production' ? trustNearestProxy : false,
  });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 429, '操作太频繁，请稍后再试'),
  });
  // 网关只在有数据库时才能调用（审计写 app.model_calls）；/health 不需要数据库，两种情况都能报告依赖状态。
  const gateway = createModelGateway({ registry: config.models, db: options.db, fetchImpl: options.fetchImpl });
  await app.register(healthRoutes, { config, gateway });

  if (options.db) {
    await app.register(apiRoutes, { prefix: '/api/v1', db: options.db, config, contract: loadContract(), gateway });
  }

  return app;
}
