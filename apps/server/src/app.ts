import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

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

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    trustProxy: config.env === 'production',
  });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 429, '操作太频繁，请稍后再试'),
  });
  await app.register(healthRoutes, { config });

  if (options.db) {
    await app.register(apiRoutes, { prefix: '/api/v1', db: options.db, config, contract: loadContract() });
  }

  return app;
}
