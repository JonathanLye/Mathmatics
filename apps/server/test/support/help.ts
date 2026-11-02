import { gateRule, type Secret } from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

import { loadContract } from '../../src/contract.ts';
import { seedContent } from '../../src/db/seed.ts';
import type { Db } from '../../src/db/index.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS } from './fixtures.ts';

const ALL_REQUIRED = {
  service: true,
  crossBorderHosting: true,
  crossBorderModel: false,
  monitoring: true,
  research: false,
};

export interface HelpHarness {
  app: FastifyInstance;
  db: Db;
  cookie: string;
  attemptId: string;
  close(): Promise<void>;
}

// 登录、签署同意书、开始一次作答（题目 epsN）。与 attempts.test.ts 的 startedAttempt 相同的步骤。
export async function startHelpHarness(problemId = 'epsN'): Promise<HelpHarness> {
  const fx = await setupFixture();
  await seedContent(fx.db);
  const app = await buildTestApp(fx.db);
  const teacherId = (await fx.db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
  const version = (
    await fx.db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = $1`, [
      problemId,
    ])
  ).rows[0]?.version;
  const assignment = await fx.db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1, $2, $3, 'practice', now() - interval '1 hour', 'open', $4)
     returning id`,
    [fx.classId, problemId, version, teacherId],
  );
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  const cookie = cookieFrom(login.headers['set-cookie']);
  const consent = await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: ALL_REQUIRED },
  });
  expect(consent.statusCode, consent.body).toBe(200);
  const started = await app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignment.rows[0]?.id}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });
  expect(started.statusCode, started.body).toBe(200);
  return {
    app,
    db: fx.db,
    cookie,
    attemptId: started.json().state.attemptId as string,
    close: async () => {
      await app.close();
      await fx.close();
    },
  };
}

export async function stateOf(db: Db, attemptId: string): Promise<Record<string, any>> {
  return (await db.query<{ state: Record<string, any> }>(`select state from app.attempts where id = $1`, [attemptId])).rows[0]!.state;
}

// 白盒：直接改写作答状态与当前层，只用于测试 help 路径（前面各层不走真实路径）。
export async function setState(
  db: Db,
  attemptId: string,
  currentLayer: string,
  next: Record<string, unknown>,
): Promise<void> {
  await db.query(`update app.attempts set state = $2::jsonb, current_layer = $3 where id = $1`, [
    attemptId,
    JSON.stringify(next),
    currentLayer,
  ]);
}

export function postHelp(h: HelpHarness, payload: object) {
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/attempts/${h.attemptId}/help`,
    headers: { cookie: h.cookie, ...WRITE_HEADERS },
    payload,
  });
}

export function postClaim(h: HelpHarness, previewToken: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/attempts/${h.attemptId}/hints/claim`,
    headers: { cookie: h.cookie, ...WRITE_HEADERS },
    payload: { previewToken },
  });
}

export async function secretsOf(db: Db): Promise<Secret[]> {
  return (await db.query<{ secret: Secret }>(`select secret from vault.problem_secrets`)).rows.map((r) => r.secret);
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

// DoD 的泄题检查：响应里每个字符串 canon 后过闸门，未透露的关键步骤片段必须为 0 命中。
// matched 为学生已写出的关键步骤（它们的片段可以出现）。返回"关键步骤: 片段"列表，空数组即无泄露。
export function leakHits(bodies: readonly string[], secrets: readonly Secret[], matched: readonly string[]): string[] {
  const hits: string[] = [];
  for (const body of bodies) {
    for (const text of stringsIn(JSON.parse(body))) {
      for (const secret of secrets) {
        const result = gateRule(secret, text, new Set(matched), []);
        if (!result.ok) for (const hit of result.hits) hits.push(`${hit.key}: ${hit.frag}`);
      }
    }
  }
  return hits;
}

const contract = loadContract();

// 每个 /help 与 /hints/claim 的响应都必须符合 HelpResult（06 §4.2 的 schema）。不合规时直接失败。
export function assertHelpResult(res: { body: string }): void {
  contract.validate('HelpResult', JSON.parse(res.body));
}
