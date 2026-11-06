import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { decryptPii } from './crypto.ts';
import type { LoginThrottle } from './login-throttle.ts';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.ts';
import { revokeUserSessions, type AuthContext } from './session.ts';
import { MIN_PASSWORD_LENGTH } from './teacher-login.ts';

// 设置 / 修改密码（学生、教师共用的流程）：
// 1. 先做廉价的策略检查；2. 已有密码时校验当前密码（argon2，事务之外；按用户累计失败、满 5 次锁定）；
// 3. 哈希新密码（事务之外）；4. 一个事务里写新哈希并作废其他会话（当前会话保留）。
// 当前密码错返回 403 INVALID_CREDENTIALS 而不是 401：两端客户端把 401 当作“会话失效、回登录页”，会把正在改密码的人踢出去。
export const WRONG_CURRENT_PASSWORD = '当前密码不对';

async function assertCurrentPassword(
  throttle: LoginThrottle,
  throttleKey: string,
  currentHash: string,
  currentPassword: string | undefined,
): Promise<void> {
  if (currentPassword === undefined || currentPassword === '') throw new AppError('VALIDATION_FAILED', 422, '请输入当前密码');
  const locked = throttle.check(throttleKey);
  if (locked.locked) {
    throw new AppError('RATE_LIMITED', 429, '尝试次数过多，请稍后再试', { retryAfterSec: locked.retryAfterSec });
  }
  if (!(await verifyPassword(currentHash, currentPassword))) {
    throttle.recordFailure(throttleKey);
    throw new AppError('INVALID_CREDENTIALS', 403, WRONG_CURRENT_PASSWORD);
  }
  throttle.reset(throttleKey);
}

export interface PasswordChangeInput {
  currentPassword?: string;
  newPassword: string;
}

export async function setStudentPassword(
  db: Db,
  piiKey: Buffer,
  throttle: LoginThrottle,
  auth: AuthContext,
  input: PasswordChangeInput,
): Promise<void> {
  const profile = (
    await db.query<{ student_no_enc: Uint8Array; password_hash: string | null }>(
      `select student_no_enc, password_hash from app.student_profiles where user_id = $1`,
      [auth.userId],
    )
  ).rows[0];
  if (!profile) throw new AppError('NOT_FOUND', 404, '账号不存在');

  const issue = checkPasswordPolicy(input.newPassword, decryptPii(piiKey, Buffer.from(profile.student_no_enc)));
  if (issue !== null) throw new AppError('VALIDATION_FAILED', 422, issue);

  if (profile.password_hash !== null) {
    await assertCurrentPassword(throttle, `pwchange:${auth.userId}`, profile.password_hash, input.currentPassword);
    if (input.newPassword === input.currentPassword) throw new AppError('VALIDATION_FAILED', 422, '新密码不能和当前密码一样');
  }

  const newHash = await hashPassword(input.newPassword);
  await db.tx(async (tx) => {
    await tx.query(`update app.student_profiles set password_hash = $2, password_set_at = now() where user_id = $1`, [auth.userId, newHash]);
    await revokeUserSessions(tx, auth.userId, auth.sessionId);
  });
}

export async function changeTeacherPassword(
  db: Db,
  throttle: LoginThrottle,
  auth: AuthContext,
  input: Required<PasswordChangeInput>,
): Promise<void> {
  if ([...input.newPassword].length < MIN_PASSWORD_LENGTH) {
    throw new AppError('VALIDATION_FAILED', 422, `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
  }
  const account = (
    await db.query<{ password_hash: string }>(`select password_hash from app.teacher_accounts where user_id = $1`, [auth.userId])
  ).rows[0];
  if (!account) throw new AppError('NOT_FOUND', 404, '账号不存在');

  await assertCurrentPassword(throttle, `pwchange:${auth.userId}`, account.password_hash, input.currentPassword);
  if (input.newPassword === input.currentPassword) throw new AppError('VALIDATION_FAILED', 422, '新密码不能和当前密码一样');

  const newHash = await hashPassword(input.newPassword);
  await db.tx(async (tx) => {
    await tx.query(`update app.teacher_accounts set password_hash = $2 where user_id = $1`, [auth.userId, newHash]);
    await revokeUserSessions(tx, auth.userId, auth.sessionId);
  });
}
