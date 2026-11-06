#!/usr/bin/env node
// 重置教师密码（运维用；教师账号没有自助找回）。默认 TOTP 保持不变；加 --totp 会同时换一个新的 TOTP 密钥
// （原验证器里的那一项随即作废；新密钥只显示这一次，不写日志/文件）。
// 重置后会吊销该教师名下所有未过期的登录会话（旧密码泄露时，已登录的设备也要被踢下线）。
// 密码只从环境变量读取，不放命令行参数，避免进入 shell 历史与进程列表。
//   TEACHER_PASSWORD=… node tools/reset-teacher-password.mjs <用户名> [--totp]
// --totp 需要 PII_KEY（加密 totp secret），生产容器的 env_file 里已有。
// 数据库连接同 apps/server/src/db/cli.ts：DATABASE_URL（生产）或 PGLITE_DIR（本地）。
import { openDb } from '../apps/server/src/db/index.ts';
// 哈希参数与并发限制统一在 password.ts（argon2id）；这里直接用它，不再复制一份参数。
import { hashPassword } from '../apps/server/src/auth/password.ts';

const MIN_PASSWORD_LENGTH = 8;

const username = (process.argv[2] ?? '').trim();
const rotateTotp = process.argv.includes('--totp');
const password = process.env.TEACHER_PASSWORD ?? '';
if (username === '' || password.length < MIN_PASSWORD_LENGTH) {
  console.error(`用法：TEACHER_PASSWORD=… node tools/reset-teacher-password.mjs <用户名> [--totp]（密码至少 ${MIN_PASSWORD_LENGTH} 个字符）`);
  process.exit(1);
}

let newTotp;
if (rotateTotp) {
  const { generateTotpSecret } = await import('../apps/server/src/auth/totp.ts');
  const { encryptPii } = await import('../apps/server/src/auth/crypto.ts');
  const { loadConfig } = await import('../apps/server/src/config.ts');
  const secret = generateTotpSecret();
  newTotp = { secret, enc: encryptPii(loadConfig().piiKey, secret) };
}

const db = await openDb({ databaseUrl: process.env.DATABASE_URL, pgliteDir: process.env.PGLITE_DIR ?? '.data/pglite' });
try {
  const passwordHash = await hashPassword(password);
  let revoked = 0;
  await db.tx(async (tx) => {
    const result = await tx.query('update app.teacher_accounts set password_hash = $1 where username = $2 returning user_id', [
      passwordHash,
      username,
    ]);
    if (result.rows.length !== 1) throw new Error(`没有找到教师账号：${username}`);
    if (newTotp !== undefined) {
      await tx.query('update app.teacher_accounts set totp_secret_enc = $2 where username = $1', [username, newTotp.enc]);
    }
    const sessions = await tx.query(
      'update app.auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null returning id',
      [result.rows[0].user_id],
    );
    revoked = sessions.rows.length;
  });
  console.log(
    `已重置密码：${username}（${newTotp === undefined ? 'TOTP 保持不变' : 'TOTP 已换新'}；已吊销 ${revoked} 个登录会话）`,
  );
  if (newTotp !== undefined) {
    const issuer = '证明陪练场';
    console.log(`TOTP secret（只显示一次，请立即录入验证器）：${newTotp.secret}`);
    console.log(
      `或在支持的 App 里导入此链接：otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${newTotp.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
    );
  }
} finally {
  await db.close();
}
