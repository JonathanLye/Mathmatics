import type { Queryable } from '../db/index.ts';

// 13 §2：同意书改文案必须升版本；旧版本的签署不再满足练习条件，学生需重新确认。
export const CONSENT_VERSION = 'p0-v1';

// 练习前必选的三段：服务所需、香港服务器存储、过程监测。
export const REQUIRED_CONSENT_KEYS = ['service', 'crossBorderHosting', 'monitoring'] as const;

export type ConsentKey = 'service' | 'crossBorderHosting' | 'crossBorderModel' | 'monitoring' | 'research';
export type ConsentItems = Record<ConsentKey, boolean>;

export function meetsRequiredConsent(items: Partial<Record<ConsentKey, boolean>>): boolean {
  return REQUIRED_CONSENT_KEYS.every((key) => items[key] === true);
}

export async function hasValidConsent(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query<{ items: Partial<Record<ConsentKey, boolean>> }>(
    `select items
       from app.consents
      where user_id = $1 and version = $2 and revoked_at is null
      order by created_at desc
      limit 1`,
    [userId, CONSENT_VERSION],
  );
  const row = result.rows[0];
  return row !== undefined && meetsRequiredConsent(row.items);
}
