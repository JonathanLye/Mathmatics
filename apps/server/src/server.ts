import pino from 'pino';

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';

const config = loadConfig();
// 先建 pino 实例：池里空闲连接的错误发生在 app 建立之后，但只有共用同一个 logger 才能进结构化日志。
const logger = pino({ level: config.logLevel });
const db = await openDb({
  databaseUrl: config.databaseUrl,
  pgliteDir: config.pgliteDir,
  onPoolError: (error) => logger.error({ err: error }, 'pg pool idle client error'),
});
const app = await buildApp({ config, db, loggerInstance: logger });

const address = await app.listen({ host: config.host, port: config.port });
if (process.env.SMOKE === '1') {
  console.log(`LISTENING ${address}`);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
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
