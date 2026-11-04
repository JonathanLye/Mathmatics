import pino from 'pino';

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { cleanupExpiredIdempotencyKeys } from './idempotency.ts';
import { requestSerializer } from './logging.ts';

const config = loadConfig();
// 先建 pino 实例：池里空闲连接的错误发生在 app 建立之后，但只有共用同一个 logger 才能进结构化日志。
const logger = pino({ level: config.logLevel, serializers: { req: requestSerializer } });
const db = await openDb({
  databaseUrl: config.databaseUrl,
  pgliteDir: config.pgliteDir,
  onPoolError: (error) => logger.error({ err: error }, 'pg pool idle client error'),
});
const app = await buildApp({ config, db, loggerInstance: logger });

// 24h 过期的幂等键：不只靠带键请求“顺手清理”，低频时也要有人删。unref 不阻止进程退出。
const cleanupTimer = setInterval(
  () => {
    cleanupExpiredIdempotencyKeys(db).catch((error: unknown) => {
      app.log.error({ err: error }, 'idempotency: 清理过期键失败');
    });
  },
  60 * 60 * 1000,
);
cleanupTimer.unref();

const address = await app.listen({ host: config.host, port: config.port });
if (process.env.SMOKE === '1') {
  console.log(`LISTENING ${address}`);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(cleanupTimer);
    app
      .close()
      .then(() => db.close())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}
