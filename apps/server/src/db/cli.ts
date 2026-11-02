import { rm } from 'node:fs/promises';

import { createTeacherAccount } from '../auth/teacher-login.ts';

import { applySchema, openDb, seedContent } from './index.ts';

const [command, ...rest] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
const pgliteDir = process.env.PGLITE_DIR ?? '.data/pglite';

async function main(): Promise<void> {
  if (!['reset', 'migrate', 'seed', 'query', 'create-teacher'].includes(command ?? '')) {
    console.error('用法：node apps/server/src/db/cli.ts <reset|migrate|seed|query|create-teacher> [SQL | 用户名]');
    process.exit(1);
  }

  if (command === 'reset') {
    if (databaseUrl !== undefined && databaseUrl !== '') {
      if (process.env.NODE_ENV === 'production') throw new Error('拒绝在 production 重置数据库');
      const db = await openDb({ databaseUrl });
      await db.exec('drop schema if exists app, content, vault, ev cascade');
      await db.close();
    } else if (pgliteDir !== 'memory') {
      await rm(pgliteDir, { recursive: true, force: true });
    }
  }

  const db = await openDb({ databaseUrl, pgliteDir });
  try {
    if (command === 'reset' || command === 'migrate') await applySchema(db);
    if (command === 'reset' || command === 'seed') {
      const summary = await seedContent(db);
      console.log(JSON.stringify(summary));
    }
    if (command === 'query') {
      const sql = rest.join(' ').trim();
      if (sql === '') throw new Error('用法：pnpm db:query "<SQL>"');
      const result = await db.query(sql);
      console.log(JSON.stringify(result.rows, null, 2));
    }
    if (command === 'create-teacher') {
      // 密码只从环境变量读取，不放在命令行参数里，避免进入 shell 历史与进程列表。
      const username = rest[0]?.trim() ?? '';
      const password = process.env.TEACHER_PASSWORD ?? '';
      if (username === '' || password === '') {
        throw new Error('用法：TEACHER_PASSWORD=… node apps/server/src/db/cli.ts create-teacher <用户名>');
      }
      await createTeacherAccount(db, { username, password });
      console.log(`已创建教师账号：${username}`);
    }
  } finally {
    await db.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
