// 一次性复现，不进 CI 套件。R5 断言“缺陷存在”（修复后应翻红），不是回归测试；回归在 apps/server/test/migrate.test.ts。
import { expect, it } from 'vitest';
import { applySchema, openDb } from '../src/db/index.ts';
it('R5（修复前缺陷）schema 重复执行会抛错', async () => {
  const db = await openDb({ pgliteDir: 'memory' });
  await applySchema(db);
  await expect(applySchema(db)).rejects.toThrow();
  await db.close();
});
