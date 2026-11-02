import { hash, verify, type Options } from '@node-rs/argon2';

import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { newAnonCode } from './crypto.ts';
import { createSession, TEACHER_SESSION_MS } from './session.ts';

// OWASP 密码存储指南的 Argon2id 最低配置：m=19 MiB、t=2、p=1（EXA 已核对）。
// @node-rs/argon2 的 Algorithm 是 const enum，Node 原生类型剥离不支持，因此直接写数值 2（argon2id）。
const HASH_OPTIONS: Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// 密码最短长度。产品文档没有给出密码策略，这里取 OWASP 无 MFA 时的下限 8，PO 可以改。
export const MIN_PASSWORD_LENGTH = 8;

const INVALID_CREDENTIALS = '用户名或密码不对';

// 用户名不存在时也做一次校验，让响应时间与"密码错误"接近，避免枚举账号。
const timingDummyHash = hash('timing-equalizer-not-a-real-password', HASH_OPTIONS);

export interface CreateTeacherInput {
  username: string;
  password: string;
}

// 只给运维（db/cli.ts create-teacher）使用；教师账号没有自助注册。
export async function createTeacherAccount(db: Db, input: CreateTeacherInput): Promise<string> {
  const username = input.username.trim();
  if (username === '') throw new Error('用户名不能为空');
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);

  const passwordHash = await hash(input.password, HASH_OPTIONS);
  return db.tx(async (tx) => {
    const user = await tx.query<{ id: string }>(
      `insert into app.users (role, anon_code, status) values ('teacher', $1, 'active') returning id`,
      [newAnonCode('T')],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('insert app.users 没有返回 id');
    await tx.query(`insert into app.teacher_accounts (user_id, username, password_hash) values ($1, $2, $3)`, [
      userId,
      username,
      passwordHash,
    ]);
    return userId;
  });
}

export interface TeacherLoginInput {
  username: string;
  password: string;
  ipMasked: string | null;
}

export interface TeacherLoginResult {
  userId: string;
  role: 'teacher' | 'admin';
  sessionId: string;
  expiresAt: Date;
}

export async function teacherLogin(db: Db, input: TeacherLoginInput): Promise<TeacherLoginResult> {
  const result = await db.query<{
    user_id: string;
    role: 'teacher' | 'admin';
    password_hash: string;
    totp_secret_enc: Uint8Array | null;
    status: string;
  }>(
    `select ta.user_id, u.role, ta.password_hash, ta.totp_secret_enc, u.status
       from app.teacher_accounts ta
       join app.users u on u.id = ta.user_id
      where ta.username = $1`,
    [input.username.trim()],
  );
  const row = result.rows[0];

  const passwordOk = await verify(row?.password_hash ?? (await timingDummyHash), input.password);
  if (!row || !passwordOk || row.status !== 'active') {
    throw new AppError('UNAUTHORIZED', 401, INVALID_CREDENTIALS);
  }
  // TOTP 未实现（见后续 issue）。账号开启了 TOTP 就必须拒绝，而不是忽略第二因素。
  if (row.totp_secret_enc !== null) {
    throw new AppError('UNAUTHORIZED', 401, '该账号需要两步验证，暂时无法在此登录，请联系管理员');
  }

  const session = await createSession(db, {
    userId: row.user_id,
    deviceId: null,
    ip: input.ipMasked,
    ttlMs: TEACHER_SESSION_MS,
  });
  return { userId: row.user_id, role: row.role, sessionId: session.id, expiresAt: session.expiresAt };
}
