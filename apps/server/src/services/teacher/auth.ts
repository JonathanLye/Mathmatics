import type { FastifyRequest } from 'fastify';

import { requireAuth, type AuthContext } from '../../auth/session.ts';
import type { Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 04 §1 权限：教师只看自己的班级；管理员看全部并审批实名导出。教师接口一律先过这里。
export async function requireTeacher(db: Queryable, request: FastifyRequest): Promise<AuthContext> {
  const auth = await requireAuth(db, request);
  if (auth.role !== 'teacher' && auth.role !== 'admin') {
    throw new AppError('FORBIDDEN', 403, '需要教师账号');
  }
  return auth;
}

// 班级归属（04 §1）：
// - 教师：class.owner_id 或 class_members.role='teacher'；
// - 管理员：任意未归档班级（04 §1「管理员看全部」）。
// 不属于 / 已归档一律 404（不泄露班级是否存在）。
export async function assertClassTeacher(db: Queryable, auth: AuthContext, classId: string): Promise<void> {
  if (auth.role === 'admin') {
    const found = await db.query(`select 1 from app.classes where id = $1 and archived_at is null`, [classId]);
    if (found.rows.length === 0) throw new AppError('NOT_FOUND', 404, '班级不存在');
    return;
  }

  const found = await db.query(
    `select 1 from app.classes c
      where c.id = $1 and c.owner_id = $2 and c.archived_at is null
     union all
     select 1 from app.class_members m
       join app.classes c2 on c2.id = m.class_id
      where m.class_id = $1 and m.user_id = $2 and m.role = 'teacher' and c2.archived_at is null
     limit 1`,
    [classId, auth.userId],
  );
  if (found.rows.length === 0) throw new AppError('NOT_FOUND', 404, '班级不存在');
}

export function uuidParam(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new AppError('NOT_FOUND', 404, `${label}不存在`);
  return value;
}
