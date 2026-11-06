// 上线时对已有作答补一次经验与徽章（幂等，可重复运行）。
// 用法：DATABASE_URL=postgres://… node tools/backfill-progress.mjs      （开发库：PGLITE_DIR=.data/pglite）
import { openDb } from '../apps/server/src/db/index.ts';
import { backfillProgress } from '../apps/server/src/progress/backfill.ts';

const databaseUrl = process.env.DATABASE_URL;
const pgliteDir = process.env.PGLITE_DIR ?? '.data/pglite';

const db = await openDb({ databaseUrl, pgliteDir });
try {
  const result = await backfillProgress(db);
  console.log(JSON.stringify(result));
} finally {
  await db.close();
}
