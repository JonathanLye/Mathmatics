import { rm } from 'node:fs/promises';

import { migrate, openDb, seedContent } from './index.ts';

const [command, ...rest] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
const pgliteDir = process.env.PGLITE_DIR ?? '.data/pglite';

async function main(): Promise<void> {
  if (!['reset', 'migrate', 'seed', 'query', 'create-teacher', 'import-bundle'].includes(command ?? '')) {
    console.error('用法：node apps/server/src/db/cli.ts <reset|migrate|seed|query|create-teacher|import-bundle> [SQL | 用户名]');
    process.exit(1);
  }

  if (command === 'reset') {
    if (databaseUrl !== undefined && databaseUrl !== '') {
      if (process.env.NODE_ENV === 'production') throw new Error('拒绝在 production 重置数据库');
      const db = await openDb({ databaseUrl });
      await db.exec('drop schema if exists app, content, vault, ev cascade; drop table if exists public.schema_migrations');
      await db.close();
    } else if (pgliteDir !== 'memory') {
      await rm(pgliteDir, { recursive: true, force: true });
    }
  }

  const db = await openDb({ databaseUrl, pgliteDir });
  try {
    if (command === 'reset' || command === 'migrate') {
      const result = await migrate(db);
      console.log(JSON.stringify(result));
    }
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
    if (command === 'import-bundle') {
      // 动态导入：只有这条命令需要题目门禁（ajv、katex），其它 db:* 命令不加载。
      const { importBundle, parseBundle, readStdin } = await import('./import-bundle.ts');
      const summary = await importBundle(db, parseBundle(await readStdin()));
      console.log(JSON.stringify(summary, null, 2));
      if (summary.rejected.length > 0) process.exitCode = 2;
    }
    if (command === 'create-teacher') {
      // 密码只从环境变量读取，不放在命令行参数里，避免进入 shell 历史与进程列表。
      const username = rest[0]?.trim() ?? '';
      const password = process.env.TEACHER_PASSWORD ?? '';
      if (username === '' || password === '') {
        throw new Error('用法：TEACHER_PASSWORD=… node apps/server/src/db/cli.ts create-teacher <用户名> [--totp] [--admin]');
      }
      const enableTotp = rest.includes('--totp');
      const role = rest.includes('--admin') ? ('admin' as const) : ('teacher' as const);
      // 动态导入：只有 create-teacher 需要 argon2 原生模块，其它 db:* 命令不加载它。
      const { createTeacherAccount } = await import('../auth/teacher-login.ts');
      const { loadConfig } = await import('../config.ts');
      const config = loadConfig();
      const created = await createTeacherAccount(db, { username, password, enableTotp, piiKey: config.piiKey, role });
      console.log(`已创建${role === 'admin' ? '管理员（开发者）' : '教师'}账号：${username}`);
      if (created.totpSecret !== undefined) {
        // 只显示一次；不写日志/文件。录入验证器 App（Google Authenticator / 1Password 等）。
        console.log(`TOTP secret（只显示一次，请立即录入验证器）：${created.totpSecret}`);
      }
    }
  } finally {
    await db.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
