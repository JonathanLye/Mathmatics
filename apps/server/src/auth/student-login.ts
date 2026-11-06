import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { encryptPii, newAnonCode, normalizeInviteCode, normalizeStudentNo, studentNoHash } from './crypto.ts';
import { verifyAgainstDummy, verifyPassword } from './password.ts';
import { createSession, STUDENT_SESSION_MS } from './session.ts';

export interface StudentLoginConfig {
  piiKey: Buffer;
  studentNoPepper: string;
}

export interface StudentLoginInput {
  /** 激活 / 加入第二个班时才需要；已设密码的账号用学号 + 密码登录，不用邀请码。 */
  inviteCode?: string;
  studentNo: string;
  password?: string;
  deviceId: string;
  ip: string | null;
  uaHash: string | null;
}

export interface StudentLoginResult {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

// 统一文案：学号不存在、密码错、没设密码也没带邀请码，对外都是这一句，不让人探出“哪个学号存在”。
export const STUDENT_INVALID_CREDENTIALS = '学号或密码不对';
export const PASSWORD_REQUIRED_LOGIN_MESSAGE = '这个学号已设置密码，请用密码登录';

type ProfileRow = {
  user_id: string;
  status: string;
  password_hash: string | null;
};

// 登录三种情形（06 §3.1 / openapi /auth/student/login）：
// 1. 学号已设密码：必须带 password，校验通过才算数（argon2 在事务之外）；若同时带有效 inviteCode，顺带加入该班（第二个班）。
//    只带邀请码 → PASSWORD_REQUIRED_LOGIN，不会因为知道班级邀请码就能冒登同学。
// 2. 学号没设密码或还没有账号：必须带 inviteCode，邀请码 → 班级；学号 → 名单行（认领）；没有名单行 NOT_IN_ROSTER。
//    账号随后靠 Me.needsPassword 引导去设密码。同一学号在任何班级只对应一个账号（student_profiles.student_no_hash 唯一）。
// 3. 其余（没设密码又没带邀请码、学号不存在）：校验一次占位哈希拉齐耗时，统一回 INVALID_CREDENTIALS。
export async function studentLogin(
  db: Db,
  config: StudentLoginConfig,
  input: StudentLoginInput,
): Promise<StudentLoginResult> {
  const hash = studentNoHash(config.studentNoPepper, input.studentNo);
  const inviteCode = input.inviteCode === undefined ? undefined : normalizeInviteCode(input.inviteCode);

  const profile = (
    await db.query<ProfileRow>(
      `select p.user_id, u.status, p.password_hash
         from app.student_profiles p
         join app.users u on u.id = p.user_id
        where p.student_no_hash = $1`,
      [hash],
    )
  ).rows[0];

  if (profile?.password_hash) {
    if (input.password === undefined) {
      throw new AppError('PASSWORD_REQUIRED_LOGIN', 401, PASSWORD_REQUIRED_LOGIN_MESSAGE);
    }
    if (!(await verifyPassword(profile.password_hash, input.password))) {
      throw new AppError('INVALID_CREDENTIALS', 401, STUDENT_INVALID_CREDENTIALS);
    }
    if (profile.status !== 'active') throw new AppError('FORBIDDEN', 403, '账号已停用，请联系老师');
    const userId = profile.user_id;
    return db.tx(async (tx) => {
      if (inviteCode !== undefined) await joinClassByInvite(tx, inviteCode, hash, async () => userId);
      return openSession(tx, userId, input);
    });
  }

  if (inviteCode === undefined) {
    await verifyAgainstDummy(input.password ?? '');
    throw new AppError('INVALID_CREDENTIALS', 401, STUDENT_INVALID_CREDENTIALS);
  }

  return db.tx(async (tx) => {
    const userId = await joinClassByInvite(tx, inviteCode, hash, () => findOrCreateStudent(tx, config, input.studentNo, hash));
    return openSession(tx, userId, input);
  });
}

// 邀请码 → 班级，学号 → 名单行，认领并入班。resolveUser 在确认“名单里有这个学号”之后才调用
// （首次激活时才创建账号，不会因为邀请码对、名单里没有而留下孤儿账号）。
async function joinClassByInvite(
  tx: Queryable,
  inviteCode: string,
  studentNoHashValue: string,
  resolveUser: () => Promise<string>,
): Promise<string> {
  const classRow = await tx.query<{ id: string }>(
    `select id from app.classes
      where invite_code = $1
        and archived_at is null
        and (invite_expires_at is null or invite_expires_at > now())`,
    [inviteCode],
  );
  const classId = classRow.rows[0]?.id;
  if (!classId) throw new AppError('INVALID_INVITE', 401, '邀请码不对，请向老师确认');

  const rosterRow = await tx.query<{ id: string; claimed_by: string | null }>(
    `select id, claimed_by from app.roster_entries where class_id = $1 and student_no_hash = $2`,
    [classId, studentNoHashValue],
  );
  const entry = rosterRow.rows[0];
  if (!entry) throw new AppError('NOT_IN_ROSTER', 403, '名单里没有这个学号，请联系老师');

  const userId = await resolveUser();
  if (entry.claimed_by !== null && entry.claimed_by !== userId) {
    throw new AppError('FORBIDDEN', 403, '这个名单行已被其他账号认领，请联系老师');
  }

  await tx.query(
    `update app.roster_entries set claimed_by = $2, claimed_at = coalesce(claimed_at, now()) where id = $1`,
    [entry.id, userId],
  );
  await tx.query(
    `insert into app.class_members (class_id, user_id, role) values ($1, $2, 'student')
     on conflict (class_id, user_id) do nothing`,
    [classId, userId],
  );
  return userId;
}

async function openSession(tx: Queryable, userId: string, input: StudentLoginInput): Promise<StudentLoginResult> {
  await tx.query(
    `insert into app.devices (id, user_id, ua_hash) values ($1, $2, $3)
     on conflict (id) do update set user_id = excluded.user_id, last_seen = now()`,
    [input.deviceId, userId, input.uaHash],
  );
  const session = await createSession(tx, {
    userId,
    deviceId: input.deviceId,
    ip: input.ip,
    ttlMs: STUDENT_SESSION_MS,
  });
  return { userId, sessionId: session.id, expiresAt: session.expiresAt };
}

async function findOrCreateStudent(
  tx: Queryable,
  config: StudentLoginConfig,
  studentNo: string,
  hash: string,
): Promise<string> {
  const existing = await tx.query<{ user_id: string; status: string }>(
    `select p.user_id, u.status
       from app.student_profiles p
       join app.users u on u.id = p.user_id
      where p.student_no_hash = $1`,
    [hash],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.status !== 'active') throw new AppError('FORBIDDEN', 403, '账号已停用，请联系老师');
    return row.user_id;
  }

  const created = await tx.query<{ id: string }>(
    `insert into app.users (role, anon_code, status) values ('student', $1, 'active') returning id`,
    [newAnonCode('S')],
  );
  const userId = created.rows[0]?.id;
  if (!userId) throw new Error('insert app.users 没有返回 id');

  await tx.query(
    `insert into app.student_profiles (user_id, student_no_enc, student_no_hash) values ($1, $2, $3)`,
    [userId, encryptPii(config.piiKey, normalizeStudentNo(studentNo)), hash],
  );
  return userId;
}
