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
    void app
      .close()
      .then(() => db.close())
      .finally(() => process.exit(0));
  });
}
