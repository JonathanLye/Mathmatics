import type { Queryable } from '../db/index.ts';

import { hasValidConsent } from './consent.ts';
import type { AuthContext } from './session.ts';

// 06 §3.1 的 Me：只返回 OpenAPI 里列出的字段（DTO 白名单，06 §2）。
export interface MeView {
  userId: string;
  role: AuthContext['role'];
  anonCode: string;
  displayName: string | null;
  classes: Array<{ id: string; name: string }>;
  consentRequired: boolean;
  features: Record<string, boolean>;
}

export async function buildMe(db: Queryable, auth: AuthContext): Promise<MeView> {
  const user = await db.query<{ anon_code: string; display_name: string | null }>(
    `select anon_code, display_name from app.users where id = $1`,
    [auth.userId],
  );
  const row = user.rows[0];
  if (!row) throw new Error(`用户不存在：${auth.userId}`);

  const classes = await db.query<{ id: string; name: string }>(
    `select c.id, c.name
       from app.class_members m
       join app.classes c on c.id = m.class_id
      where m.user_id = $1 and m.left_at is null and c.archived_at is null
      order by c.created_at, c.id`,
    [auth.userId],
  );

  const consentRequired = auth.role === 'student' ? !(await hasValidConsent(db, auth.userId)) : false;

  return {
    userId: auth.userId,
    role: auth.role,
    anonCode: row.anon_code,
    displayName: row.display_name,
    classes: classes.rows,
    consentRequired,
    features: {},
  };
}
