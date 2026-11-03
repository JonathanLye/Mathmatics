import { expect, it } from 'vitest';
import { applySchema, openDb } from '../src/db/index.ts';
it('R5 schema 重复执行', async () => {
  const db = await openDb({ pgliteDir: 'memory' });
  await applySchema(db);
  await expect(applySchema(db)).rejects.toThrow();
  await db.close();
});
