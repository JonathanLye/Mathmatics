import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { encryptPii, newAnonCode, normalizeInviteCode, normalizeStudentNo, studentNoHash } from './crypto.ts';
import { createSession, STUDENT_SESSION_MS } from './session.ts';

export interface StudentLoginConfig {
  piiKey: Buffer;
  studentNoPepper: string;
}

export interface StudentLoginInput {
  inviteCode: string;
  studentNo: string;
  deviceId: string;
  ip: string | null;
  uaHash: string | null;
}

export interface StudentLoginResult {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

// 首次登录：邀请码 → 班级；学号 → 名单行（认领）；没有名单行返回 NOT_IN_ROSTER。
// 同一学号在任何班级只对应一个账号（student_profiles.student_no_hash 唯一）。
export async function studentLogin(
  db: Db,
  config: StudentLoginConfig,
  input: StudentLoginInput,
): Promise<StudentLoginResult> {
  const inviteCode = normalizeInviteCode(input.inviteCode);
  const hash = studentNoHash(config.studentNoPepper, input.studentNo);

  return db.tx(async (tx) => {
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
      [classId, hash],
    );
    const entry = rosterRow.rows[0];
    if (!entry) throw new AppError('NOT_IN_ROSTER', 403, '名单里没有这个学号，请联系老师');

    const userId = await findOrCreateStudent(tx, config, input.studentNo, hash);
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
  });
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
