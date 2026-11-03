import { buildApp } from '../../src/app.ts';
import { studentNoHash } from '../../src/auth/crypto.ts';
import { loadConfig, type AppConfig } from '../../src/config.ts';
import { applySchema, openDb, type Db } from '../../src/db/index.ts';

export const testConfig = loadConfig({ NODE_ENV: 'test' });

export const TEST_INVITE = 'K7Q2MX';
export const TEST_STUDENT_NO = '2026001';
export const DEVICE_A = '6f1b2c4e-8d3a-4b7e-9c10-2a5d7e8f9a01';
export const DEVICE_B = '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f';
export const WRITE_HEADERS = { 'x-requested-with': 'proof-gym' };

export interface Fixture {
  db: Db;
  classId: string;
  close(): Promise<void>;
}

// 一个空库 + 一位教师 + 一个班（邀请码 TEST_INVITE）+ 名单里一位学生（TEST_STUDENT_NO）。
export async function setupFixture(): Promise<Fixture> {
  const db = await openDb({ pgliteDir: 'memory' });
  await applySchema(db);

  const teacher = await db.query<{ id: string }>(
    `insert into app.users (role, anon_code) values ('teacher', 'T-AB12CD') returning id`,
  );
  const classRow = await db.query<{ id: string }>(
    `insert into app.classes (name, term, owner_id, invite_code)
     values ('高数 A 班', '2026 秋', $1, $2) returning id`,
    [teacher.rows[0]?.id, TEST_INVITE],
  );
  const classId = classRow.rows[0]?.id as string;
  await db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [
    classId,
    studentNoHash(testConfig.studentNoPepper, TEST_STUDENT_NO),
  ]);

  return { db, classId, close: () => db.close() };
}

export async function buildTestApp(db: Db, overrides: Partial<AppConfig> = {}) {
  return buildApp({ config: { ...testConfig, ...overrides }, logger: false, db });
}

export function loginBody(overrides: Record<string, unknown> = {}) {
  return { inviteCode: TEST_INVITE, studentNo: TEST_STUDENT_NO, deviceId: DEVICE_A, ...overrides };
}

// 取 Set-Cookie 的 name=value 部分（不含属性）。
export function cookieFrom(setCookie: string | string[] | number | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(raw ?? '').split(';')[0] ?? '';
}
