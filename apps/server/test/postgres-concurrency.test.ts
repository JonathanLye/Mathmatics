import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { applySchema, openDb, seedContent, type Db } from '../src/db/index.ts';
import { ingestBatch } from '../src/events/ingest.ts';

// #74 / 复审报告 P1-4：真实 PostgreSQL 上的并发写入。
// 「两批事件以相反顺序引用同一批作答」是为了验证 events/ingest.ts 的按-id-排序加锁不会死锁。
// - 本地未设 DATABASE_URL：PGlite 验证逻辑（单连接、串行执行）；
// - CI 的 postgres job 设 DATABASE_URL 后是真并发（库已 migrate + seed）。
const DATABASE_URL = process.env.DATABASE_URL;

async function openTestDb(): Promise<Db> {
  if (DATABASE_URL !== undefined && DATABASE_URL !== '') {
    return openDb({ databaseUrl: DATABASE_URL });
  }
  const db = await openDb({ pgliteDir: 'memory' });
  await applySchema(db);
  await seedContent(db);
  return db;
}

// 两批使用同一 deviceId：避免触发 multi_device 诚信规则（它会写额外的服务端事件，干扰 seq 断言）。
const DEVICE_ID = randomUUID();
const clientEvent = (attemptId: string) => ({
  id: randomUUID(),
  type: 'app.open' as const,
  tsClient: new Date().toISOString(),
  sessionId: randomUUID(),
  deviceId: DEVICE_ID,
  clientSeq: 1,
  attemptId,
  payload: { entry: 'direct' },
});

describe('并发事件写入（#74 / P1-4）', () => {
  it('两批事件以相反顺序引用同一批作答：不死锁、seq 不重不漏、last_event_seq 正确', async () => {
    const db = await openTestDb();
    try {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
      const teacher = await db.query<{ id: string }>(
        `insert into app.users (role, anon_code) values ('teacher', $1) returning id`,
        [`T-CON${suffix}`],
      );
      const teacherId = teacher.rows[0]?.id as string;
      const cls = await db.query<{ id: string }>(
        `insert into app.classes (name, term, owner_id, invite_code) values ('并发班', '2026 秋', $1, $2) returning id`,
        [teacherId, `C${suffix}`.slice(0, 6).padEnd(6, 'X')],
      );
      const classId = cls.rows[0]?.id as string;
      const version = (
        await db.query<{ version: number }>(
          `select max(version) as version from content.problem_versions where problem_id = 'epsN'`,
        )
      ).rows[0]?.version as number;
      const assignment = await db.query<{ id: string }>(
        `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
         values ($1, 'epsN', $2, 'practice', now() - interval '1 hour', 'open', $3) returning id`,
        [classId, version, teacherId],
      );
      const assignmentId = assignment.rows[0]?.id as string;

      const makeAttempt = async (n: number): Promise<string> => {
        const user = await db.query<{ id: string }>(
          `insert into app.users (role, anon_code) values ('student', $1) returning id`,
          [`S-C${suffix}${n}`],
        );
        const userId = user.rows[0]?.id as string;
        const attempt = await db.query<{ id: string }>(
          `insert into app.attempts (assignment_id, user_id, problem_id, problem_version, mode, keys_total, state)
           values ($1, $2, 'epsN', $3, 'practice', 3, '{}'::jsonb) returning id`,
          [assignmentId, userId, version],
        );
        return attempt.rows[0]?.id as string;
      };
      const attemptA = await makeAttempt(1);
      const attemptB = await makeAttempt(2);

      // 两批反向顺序：A→B 与 B→A，并发提交。按 id 排序加锁的实现不应死锁。
      const actor = { userId: teacherId, role: 'teacher' as const };
      const [first, second] = await Promise.all([
        ingestBatch(db, actor, [clientEvent(attemptA), clientEvent(attemptB)]),
        ingestBatch(db, actor, [clientEvent(attemptB), clientEvent(attemptA)]),
      ]);
      expect(first.accepted + second.accepted).toBe(4);
      expect(first.rejected.length + second.rejected.length).toBe(0);

      for (const attemptId of [attemptA, attemptB]) {
        const seqs = (
          await db.query<{ seq: string | number }>(`select seq from ev.events where attempt_id = $1 order by seq`, [attemptId])
        ).rows.map((row) => Number(row.seq));
        expect(seqs).toEqual([1, 2]);
        const last = (
          await db.query<{ last_event_seq: string | number }>(`select last_event_seq from app.attempts where id = $1`, [attemptId])
        ).rows[0]?.last_event_seq;
        expect(Number(last)).toBe(2);
      }
    } finally {
      await db.close();
    }
  }, 60_000);
});
