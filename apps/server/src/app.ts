import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig, type AppConfig } from './config.ts';
import { registerErrorHandler } from './errors.ts';
import { healthRoutes } from './routes/health.ts';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    trustProxy: config.env === 'production',
  });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });
  await app.register(healthRoutes, { config });

  return app;
}
