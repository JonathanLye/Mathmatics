import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';

const config = loadConfig();
const db = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const app = await buildApp({ config, db });

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
