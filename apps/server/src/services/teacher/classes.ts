import { randomInt } from 'node:crypto';

import type { AuthContext } from '../../auth/session.ts';
import type { Db, Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { assertClassTeacher } from './auth.ts';
import { toClassSummary, type ClassSummaryRow } from './view.ts';

// 04 §10：邀请码 6 位，去掉易混字符 0/O/1/I（与学生匿名码同一套字母表）。
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const INVITE_LENGTH = 6;

// openapi ClassSettings 的五个键；只存白名单，避免把客户端塞进来的任意 JSON 写进 classes.settings。
const SETTINGS_DEFAULTS = {
  photoEnabled: true,
  lessonGenerated: false, // 09 §2：P0 默认关（fail-closed）
  revealBudget: 2,
  integrityPractice: 'log_and_notice',
  testMaxSwitches: 3,
} as const;
const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof typeof SETTINGS_DEFAULTS)[];

export interface CreateClassInput {
  name: string;
  term: string;
  settings?: unknown;
}

export function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i += 1) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

export function normalizeClassSettings(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  if (input !== null && typeof input === 'object') {
    for (const key of SETTINGS_KEYS) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

const CLASS_SUMMARY_SELECT = `
  select c.id as class_id, c.name, c.term, c.invite_code, c.settings,
         (select count(*)::int from app.roster_entries r where r.class_id = c.id) as students,
         (select count(*)::int from app.roster_entries r where r.class_id = c.id and r.claimed_by is not null) as claimed
    from app.classes c`;

async function classSummaryById(q: Queryable, classId: string): Promise<Record<string, unknown>> {
  const row = (await q.query<ClassSummaryRow>(`${CLASS_SUMMARY_SELECT} where c.id = $1`, [classId])).rows[0];
  if (!row) throw new Error(`班级缺失：${classId}`);
  return toClassSummary(row);
}

// 我的班级（04 §1）：教师只看 owner/班内教师成员；管理员看全部未归档班级。
export async function listClasses(db: Queryable, auth: AuthContext): Promise<Record<string, unknown>[]> {
  const rows =
    auth.role === 'admin'
      ? (
          await db.query<ClassSummaryRow>(
            `${CLASS_SUMMARY_SELECT}
              where c.archived_at is null
              order by c.created_at desc`,
          )
        ).rows
      : (
          await db.query<ClassSummaryRow>(
            `${CLASS_SUMMARY_SELECT}
              where c.archived_at is null
                and (c.owner_id = $1
                     or exists (select 1 from app.class_members m
                                where m.class_id = c.id and m.user_id = $1 and m.role = 'teacher'))
              order by c.created_at desc`,
            [auth.userId],
          )
        ).rows;
  return rows.map((row) => toClassSummary(row));
}

export async function createClass(db: Db, auth: AuthContext, input: CreateClassInput): Promise<Record<string, unknown>> {
  // 契约没有 minLength；空班级名/学期没有产品意义，服务端直接 422（不新增契约字段）。
  if (input.name.trim() === '' || input.term.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 422, '班级名和学期不能为空');
  }
  const settings = normalizeClassSettings(input.settings);
  // invite_code 全局 unique；冲突时换一个码重试（6 位 32 字符表，冲突概率极低但必须处理）。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.tx(async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `insert into app.classes (name, term, owner_id, invite_code, settings)
           values ($1, $2, $3, $4, $5::jsonb) returning id`,
          [input.name.trim(), input.term.trim(), auth.userId, newInviteCode(), JSON.stringify(settings)],
        );
        const classId = inserted.rows[0]?.id;
        if (!classId) throw new Error('insert app.classes 没有返回 id');
        // auth/me.ts 的 Me.classes 只查 class_members；不插这一行教师看不到自己的班。
        await tx.query(
          `insert into app.class_members (class_id, user_id, role) values ($1, $2, 'teacher')
           on conflict (class_id, user_id) do nothing`,
          [classId, auth.userId],
        );
        return classSummaryById(tx, classId);
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('邀请码生成失败：连续冲突');
}

// 04 §10：重置后旧码立即失效（单列更新），已登录学生不受影响（会话独立）。
export async function rotateInviteCode(
  db: Db,
  auth: AuthContext,
  classId: string,
): Promise<Record<string, unknown>> {
  await assertClassTeacher(db, auth, classId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await db.query(`update app.classes set invite_code = $2 where id = $1`, [classId, newInviteCode()]);
      return await classSummaryById(db, classId);
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('邀请码生成失败：连续冲突');
}


// 04 §1/§7：班级默认设置（只存白名单键；未知键忽略）。写 audit_log。
export async function updateClassSettings(
  db: Db,
  auth: AuthContext,
  classId: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  await assertClassTeacher(db, auth, classId);
  const settings = normalizeClassSettings(input);
  await db.tx(async (tx) => {
    await tx.query(`update app.classes set settings = $2::jsonb where id = $1`, [classId, JSON.stringify(settings)]);
    await tx.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'update_class_settings', $2, $3::jsonb)`,
      [auth.userId, classId, JSON.stringify({ classId, settings })],
    );
  });
  return classSummaryById(db, classId);
}
