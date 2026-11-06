import { CONSENT_VERSION } from '../src/auth/consent.ts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import { difficultyBand, stemPreview } from '../src/path/common.ts';
import { unitLocked } from '../src/path/service.ts';
import { revealLevelFor } from '../src/practice/service.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// Task 11 学习路径 + Task 16 练习区：服务端行为。
const PASSWORD = 'correct horse battery';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherCookie: string;
let classId: string;
let ownerId: string;
let s1: string;
let s2: string;
let inviteCode: string;

const call = (cookie: string, method: 'GET' | 'POST', path: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: method === 'GET' ? { cookie } : { cookie, ...WRITE_HEADERS },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const get = async (cookie: string, path: string) => {
  const res = await call(cookie, 'GET', path);
  return { status: res.statusCode, body: res.json() as any, res };
};
const post = async (cookie: string, path: string, payload?: unknown) => {
  const res = await call(cookie, 'POST', path, payload ?? {});
  return { status: res.statusCode, body: res.json() as any, res };
};

async function joinStudent(studentNo: string): Promise<string> {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody({ inviteCode, studentNo }) });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, cookie);
  await call(cookie, 'POST', '/consents', { version: CONSENT_VERSION, items: REQUIRED });
  return cookie;
}

// 复制 epsN 成一道新题（public/secret/参考证明），用来造章节、难度、下架、不完整等情形。
async function addProblem(
  id: string,
  opts: {
    chapter?: string;
    difficulty?: number;
    role?: string;
    kind?: 'main' | 'transfer';
    proofs?: boolean;
    hidden?: boolean;
    reviewSource?: 'teacher' | 'auto';
    status?: string;
    layers?: Record<string, boolean>;
    conceptId?: string;
    title?: string;
    stem?: string;
    unit?: { chapterNo: number; unitNo: number; title: string; sort?: number };
  } = {},
): Promise<void> {
  const base = (await db.query<{ public: Record<string, any> }>(`select public from content.problem_versions where problem_id = 'epsN'`)).rows[0]!.public;
  const secret = (await db.query<{ secret: unknown }>(`select secret from vault.problem_secrets where problem_id = 'epsN'`)).rows[0]!.secret;
  const pub: Record<string, any> = {
    ...base,
    title: opts.title ?? `题 ${id}`,
    chapter: opts.chapter ?? '第二章 数列极限',
    difficulty: opts.difficulty ?? 2,
    role: opts.role ?? 'required',
  };
  if (opts.stem) pub.stem = opts.stem;
  delete pub.transferProblemId;
  if (opts.conceptId) {
    pub.def = { ...pub.def, conceptId: opts.conceptId };
    pub.concepts = [];
  }
  if (opts.layers) {
    pub.layers = Object.fromEntries(Object.entries(pub.layers).map(([k, v]) => [k, { ...(v as object), enabled: opts.layers![k] ?? false }]));
  }
  await db.query(`insert into content.problems (id, kind, title, chapter, current_version, hidden_at) values ($1, $2, $3, $4, 1, $5)`, [
    id, opts.kind ?? 'main', pub.title, pub.chapter, opts.hidden ? new Date().toISOString() : null,
  ]);
  await db.query(
    `insert into content.problem_versions (problem_id, version, public, review_status, review_source, published_at) values ($1, 1, $2::jsonb, $3, $4, now())`,
    [id, JSON.stringify(pub), opts.status ?? 'published', opts.reviewSource ?? 'teacher'],
  );
  await db.query(`insert into vault.problem_secrets (problem_id, version, secret) values ($1, 1, $2::jsonb)`, [id, JSON.stringify(secret)]);
  if (opts.proofs !== false) {
    await db.query(`insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable) values ($1, 1, 'R1', 0, $2, true)`, [id, `参考证明 ${id}`]);
  }
  if (opts.unit) {
    const u = opts.unit;
    const unit = (
      await db.query<{ id: string }>(
        `insert into content.course_units (course_id, chapter_no, unit_no, title, sort) values ('math-analysis', $1, $2, $3, $4)
         on conflict (course_id, chapter_no, unit_no) do update set title = excluded.title returning id`,
        [u.chapterNo, u.unitNo, u.title, u.sort ?? u.chapterNo * 10 + u.unitNo],
      )
    ).rows[0]!.id;
    const n = (await db.query<{ n: string }>(`select count(*)::text as n from content.unit_items where unit_id = $1`, [unit])).rows[0]!.n;
    await db.query(`insert into content.unit_items (unit_id, problem_id, sort) values ($1, $2, $3)`, [unit, id, Number(n) + 10]);
  }
}

async function addAssignment(problemId: string, mode: 'practice' | 'test', opts: { status?: string; closeIn?: string | null; openedAgo?: string } = {}): Promise<string> {
  const version = (await db.query<{ v: number }>(`select max(version) as v from content.problem_versions where problem_id = $1`, [problemId])).rows[0]!.v;
  const closeAt = opts.closeIn === undefined ? null : opts.closeIn;
  return (
    await db.query<{ id: string }>(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, close_at, status, created_by)
       values ($1, $2, $3, $4, now() - $5::interval, ${closeAt === null ? 'null' : `now() + interval '${closeAt}'`}, $6, $7) returning id`,
      [classId, problemId, version, mode, opts.openedAgo ?? '1 hour', opts.status ?? 'open', ownerId],
    )
  ).rows[0]!.id;
}

const completeAttempt = (attemptId: string) =>
  db.query(`update app.attempts set status = 'completed', completed_at = now() where id = $1`, [attemptId]);

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: 'path.teacher', password: PASSWORD });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/teacher/login', headers: WRITE_HEADERS, payload: { username: 'path.teacher', password: PASSWORD } });
  teacherCookie = cookieFrom(login.headers['set-cookie']);
  const created = await call(teacherCookie, 'POST', '/teacher/classes', { name: '路径班', term: '2026 秋' });
  classId = created.json().classId as string;
  inviteCode = created.json().inviteCode as string;
  ownerId = (await db.query<{ o: string }>(`select owner_id as o from app.classes where id = $1`, [classId])).rows[0]!.o;
  const roster = await app.inject({
    method: 'POST',
    url: `/api/v1/teacher/classes/${classId}/roster`,
    headers: { cookie: teacherCookie, ...WRITE_HEADERS, 'content-type': 'text/csv' },
    payload: '2026201,甲\n2026202,乙\n',
  });
  expect(roster.statusCode, roster.body).toBe(200);
  s1 = await joinStudent('2026201');
  s2 = await joinStudent('2026202');
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('纯函数', () => {
  it('难度档：1–2 入门，3 进阶，4–5 挑战；缺值按入门', () => {
    expect([1, 2, 3, 4, 5].map(difficultyBand)).toEqual(['easy', 'easy', 'medium', 'hard', 'hard']);
    expect(difficultyBand(null)).toBe('easy');
  });

  it('题面预览不会把 $…$ 公式切成两半，转义的 \\$ 不算公式边界', () => {
    const stem = `证明 ${'数列'.repeat(10)} $\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$ 并说明理由`;
    for (let max = 5; max < stem.length; max += 1) {
      const out = stemPreview(stem, max);
      const body = out.replace(/…$/, '');
      const dollars = [...body.matchAll(/(?<!\\)\$/g)].length;
      expect(dollars % 2, `max=${max}: ${out}`).toBe(0);
    }
    expect(stemPreview('价格是 \\$5 和 \\$6，很便宜很便宜很便宜', 14)).not.toContain('$ ');
    expect(stemPreview('短题面', 100)).toBe('短题面');
  });

  it('单元软锁：上一个有题的单元完成不到 60% 才锁', () => {
    expect(unitLocked(null)).toBe(false);
    expect(unitLocked({ total: 10, done: 5 })).toBe(true);
    expect(unitLocked({ total: 10, done: 6 })).toBe(false);
    expect(unitLocked({ total: 5, done: 3 })).toBe(false);
  });
});

describe('GET /student/path', () => {
  it('种子安装就有路径：每章一个单元，第二单元软锁；条目带难度档与预览，且不含解题思路', async () => {
    const { status, body } = await get(s1, '/student/path');
    expect(status).toBe(200);
    expect(body.course).toEqual({ id: 'math-analysis', title: '数学分析' });
    expect(body.units.map((u: any) => [u.chapterNo, u.total, u.locked])).toEqual([[2, 1, false], [12, 1, true]]);
    expect(body.current.items).toHaveLength(1);
    expect(body.current.items[0]).toMatchObject({
      problemId: 'epsN', state: 'todo', difficulty: 'easy', layersDone: 0, layersTotal: 6, attemptId: null,
      reviewPublished: false, autoImported: false, softLocked: false,
    });
    expect(body.chapters.map((c: any) => c.chapterNo)).toEqual([2, 12]);
    expect(body.chapters[0].chapter).toBe('第二章 数列极限');
    expect(body.current.concepts.length).toBeGreaterThan(0);

    const walk = (await db.query<{ w: any }>(`select secret->'walkthrough' as w from vault.problem_secrets where problem_id = 'epsN'`)).rows[0]!.w;
    expect(JSON.stringify(body)).not.toContain(walk.approach);
    expect(JSON.stringify(body)).not.toContain(walk.keyIdeas[0]);
  });

  it('?unit= 只展开指定单元，其它单元只有摘要；未知单元 404', async () => {
    const all = (await get(s1, '/student/path')).body;
    const second = all.units[1];
    const { body } = await get(s1, `/student/path?unit=${second.id}`);
    expect(body.current.id).toBe(second.id);
    expect(body.current.items.map((i: any) => i.problemId)).toEqual(['series']);
    expect(body.units.every((u: any) => u.items === undefined)).toBe(true);
    expect((await get(s1, '/student/path?unit=00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get(s1, '/student/path?unit=nope')).status).toBe(422);
  });

  it('下架、没有参考证明、测试卷、迁移题的题不出现在路径里', async () => {
    const unit = { chapterNo: 2, unitNo: 1, title: '数列极限' };
    await addProblem('hid', { hidden: true, unit });
    await addProblem('noproof', { proofs: false, unit });
    await addProblem('exam', { role: 'test', unit });
    await addProblem('draftp', { status: 'draft', unit });
    await addProblem('okp', { unit, difficulty: 4, reviewSource: 'auto' });
    const { body } = await get(s1, '/student/path');
    expect(body.current.items.map((i: any) => i.problemId).sort()).toEqual(['epsN', 'okp']);
    const okp = body.current.items.find((i: any) => i.problemId === 'okp');
    expect(okp).toMatchObject({ difficulty: 'hard', autoImported: true });
  });

  it('单元完成 60% 开放下一单元；软锁只提示：未完成的前序题之后的题 softLocked', async () => {
    const unit = { chapterNo: 2, unitNo: 1, title: '数列极限' };
    for (const id of ['p1', 'p2', 'p3', 'p4']) await addProblem(id, { unit });
    // 第二章单元现有 epsN + p1..p4（5 题）。做完 3 题 = 60%。
    const first = (await get(s1, '/student/path')).body;
    expect(first.current.items.map((i: any) => i.softLocked)).toEqual([false, true, true, true, true]);
    expect(first.units[1].locked).toBe(true);
    for (const id of ['epsN', 'p1', 'p2']) {
      const started = await post(s1, `/student/path/items/${id}/start`);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      await completeAttempt(started.body.state.attemptId);
    }
    const after = (await get(s1, '/student/path')).body;
    expect(after.units[0]).toMatchObject({ total: 5, done: 3, state: 'active' });
    expect(after.units[1].locked).toBe(false);
    expect(after.current.items.map((i: any) => i.state)).toEqual(['done', 'done', 'done', 'todo', 'todo']);
  });
});

describe('POST /student/path/items/{problemId}/start', () => {
  it('懒创建本班自学布置：origin=path、开放、创建人=班主任；再点复用同一作答', async () => {
    const first = await post(s1, '/student/path/items/epsN/start');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await post(s1, '/student/path/items/epsN/start');
    expect(again.body.state.attemptId).toBe(first.body.state.attemptId);
    const rows = (await db.query<any>(`select origin, status, created_by, mode from app.assignments where origin = 'path'`)).rows;
    expect(rows).toEqual([{ origin: 'path', status: 'open', created_by: ownerId, mode: 'practice' }]);
    const item = (await get(s1, '/student/path')).body.current.items[0];
    expect(item).toMatchObject({ state: 'active', attemptId: first.body.state.attemptId, currentLayer: 'L1' });
  });

  it('同班两人共用一份自学布置，互相看不到对方的首页卡片', async () => {
    const a = await post(s1, '/student/path/items/epsN/start');
    const b = await post(s2, '/student/path/items/epsN/start');
    expect(a.body.state.attemptId).not.toBe(b.body.state.attemptId);
    expect((await db.query(`select 1 from app.assignments where origin = 'path'`)).rows).toHaveLength(1);
    for (const cookie of [s1, s2]) {
      const home = (await get(cookie, '/student/home')).body;
      expect([...home.inProgress, ...home.todo, ...home.done]).toEqual([]);
    }
  });

  it('并发点同一题：只创建一份布置、一份作答', async () => {
    const results = await Promise.all([1, 2, 3].map(() => post(s1, '/student/path/items/epsN/start')));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(new Set(results.map((r) => r.body.state.attemptId)).size).toBe(1);
    expect((await db.query(`select 1 from app.assignments where origin = 'path'`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from app.attempts`)).rows).toHaveLength(1);
  });

  it('班里这题有没结束的测验（进行中、未开始、无截止）→ 409 TEST_IN_PROGRESS，且不创建布置；已关闭的测验不拦', async () => {
    const test = await addAssignment('epsN', 'test', { closeIn: '1 hour' });
    for (const url of ['/student/path/items/epsN/start', '/student/practice/epsN/start']) {
      const r = await post(s1, url);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('TEST_IN_PROGRESS');
    }
    expect((await db.query(`select 1 from app.assignments where origin = 'path'`)).rows).toHaveLength(0);

    await db.query(`update app.assignments set status = 'scheduled', open_at = now() + interval '1 day' where id = $1`, [test]);
    expect((await post(s1, '/student/path/items/epsN/start')).status).toBe(409);
    await db.query(`update app.assignments set status = 'closed' where id = $1`, [test]);
    expect((await post(s1, '/student/path/items/epsN/start')).status).toBe(200);
  });

  it('班里有开放的教师练习布置 → 直接复用，不创建自学布置', async () => {
    const teacherAssignment = await addAssignment('epsN', 'practice');
    const r = await post(s1, '/student/path/items/epsN/start');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (await db.query<any>(`select assignment_id from app.attempts where id = $1`, [r.body.state.attemptId])).rows[0];
    expect(row.assignment_id).toBe(teacherAssignment);
    expect((await db.query(`select 1 from app.assignments where origin = 'path'`)).rows).toHaveLength(0);
  });

  it('已做完的题再点开始 → 返回只读回看（同一作答），不新建', async () => {
    const first = await post(s1, '/student/path/items/epsN/start');
    await completeAttempt(first.body.state.attemptId);
    const again = await post(s1, '/student/path/items/epsN/start');
    expect(again.status).toBe(200);
    expect(again.body.state.attemptId).toBe(first.body.state.attemptId);
    expect((await db.query(`select 1 from app.attempts`)).rows).toHaveLength(1);
  });

  it('不存在 / 已下架 / 迁移题 → 404；不在任何班级 → 404', async () => {
    await addProblem('hid2', { hidden: true });
    for (const id of ['nope', 'hid2', 'epsN-T1']) expect((await post(s1, `/student/path/items/${id}/start`)).status, id).toBe(404);
    await db.query(`update app.class_members set left_at = now() where user_id <> $1 and role = 'student'`, [ownerId]);
    expect((await post(s1, '/student/path/items/epsN/start')).status).toBe(404);
  });

  it('导入题只启用 L3 与 L6：开始即落在写证明层，其余层 disabled，微课入口随概念缺失隐藏', async () => {
    // 概念指向不存在的概念：lessonAvailable=false，界面据此隐藏微课入口（GET lesson 对它是 404）。
    await addProblem('imp', { layers: { L3: true, L6: true }, reviewSource: 'auto', conceptId: 'no-such-concept', unit: { chapterNo: 2, unitNo: 1, title: '数列极限' } });
    const r = await post(s1, '/student/practice/imp/start');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const state = r.body.state;
    expect(state.currentLayer).toBe('L3');
    expect(state.layers.map((l: any) => l.status)).toEqual(['disabled', 'disabled', 'active', 'disabled', 'disabled', 'locked']);
    expect(state.def.lessonAvailable).toBe(false);
    const seed = await post(s1, '/student/practice/epsN/start');
    expect(seed.body.state.def.lessonAvailable).toBe(true);
    expect(seed.body.state.currentLayer).toBe('L1');
    const item = (await get(s1, '/student/path')).body.current.items.find((i: any) => i.problemId === 'imp');
    expect(item).toMatchObject({ layersTotal: 2, lessonAvailable: false, autoImported: true });
  });
});

describe('GET /attempts/{id}/review', () => {
  it('自学作答：完成前 403，完成后返回可发布的参考证明；别人的作答 404', async () => {
    const started = await post(s1, '/student/path/items/epsN/start');
    const attemptId = started.body.state.attemptId as string;
    expect((await get(s1, `/attempts/${attemptId}/review`)).status).toBe(403);
    await completeAttempt(attemptId);
    const ok = await get(s1, `/attempts/${attemptId}/review`);
    expect(ok.status).toBe(200);
    expect(ok.body.proofs.length).toBe(1);
    expect((await get(s2, `/attempts/${attemptId}/review`)).status).toBe(404);
    const log = (await db.query(`select 1 from vault.reference_access_log where purpose = 'review'`)).rows;
    expect(log.length).toBe(1);
  });

  it('教师布置：布置没关闭 / 教师没发布前 403；关闭并发布后可看', async () => {
    const asg = await addAssignment('epsN', 'practice', { closeIn: '1 hour' });
    const started = await post(s1, `/student/assignments/${asg}/attempt`);
    const attemptId = started.body.state.attemptId as string;
    await completeAttempt(attemptId);
    expect((await get(s1, `/attempts/${attemptId}/review`)).status).toBe(403);
    await db.query(`update app.assignments set review_published_at = now(), review_note = '注意放缩方向', status = 'closed' where id = $1`, [asg]);
    const ok = await get(s1, `/attempts/${attemptId}/review`);
    expect(ok.status).toBe(200);
    expect(ok.body.note).toBe('注意放缩方向');
  });

  it('班里这题有没结束的测验时，即使自学完成也不给讲评', async () => {
    const started = await post(s1, '/student/path/items/epsN/start');
    const attemptId = started.body.state.attemptId as string;
    await completeAttempt(attemptId);
    await addAssignment('epsN', 'test', { closeIn: '1 hour' });
    expect((await get(s1, `/attempts/${attemptId}/review`)).status).toBe(403);
  });
});

describe('练习区列表', () => {
  beforeEach(async () => {
    // 章 2：epsN(2) + a1(1) a2(3) a3(5)；章 12：series(2) + b1(4)；章 10 无单元，排在有单元的章之后。
    await addProblem('a1', { difficulty: 1, unit: { chapterNo: 2, unitNo: 1, title: '数列极限' } });
    await addProblem('a2', { difficulty: 3, unit: { chapterNo: 2, unitNo: 1, title: '数列极限' }, title: '夹逼准则' });
    await addProblem('a3', { difficulty: 5, unit: { chapterNo: 2, unitNo: 1, title: '数列极限' } });
    await addProblem('b1', { difficulty: 4, chapter: '第十二章 数项级数', unit: { chapterNo: 12, unitNo: 1, title: '数项级数' } });
    await addProblem('free', { difficulty: 2, chapter: '第十章 其他', reviewSource: 'auto' });
    // 不应出现：
    await addProblem('hid', { hidden: true });
    await addProblem('tr', { kind: 'transfer' });
    await addProblem('exam', { role: 'test' });
    await addProblem('spare', { role: 'spare' });
    await addProblem('nop', { proofs: false });
    await addProblem('drf', { status: 'draft' });
  });

  it('只列完整、可证明、未下架的主题，顺序 = 章 → 难度 → ID，分面与筛选一致', async () => {
    const { body } = await get(s1, '/student/practice?limit=50');
    expect(body.items.map((i: any) => i.problemId)).toEqual(['a1', 'epsN', 'a2', 'a3', 'series', 'b1', 'free']);
    expect(body.nextCursor).toBeNull();
    expect(body.facets.difficulty).toEqual({ easy: 4, medium: 1, hard: 2 });
    expect(body.facets.chapters).toEqual([
      { chapter: '第二章 数列极限', total: 4, done: 0 },
      { chapter: '第十二章 数项级数', total: 2, done: 0 },
      { chapter: '第十章 其他', total: 1, done: 0 },
    ]);
    expect(body.items[0]).toMatchObject({ problemId: 'a1', difficulty: 'easy', status: 'todo', attemptId: null, keyCount: 4, autoImported: false });
    expect(body.items.at(-1)).toMatchObject({ problemId: 'free', autoImported: true });

    const hard = (await get(s1, '/student/practice?difficulty=hard')).body;
    expect(hard.items.map((i: any) => i.problemId)).toEqual(['a3', 'b1']);
    expect(hard.facets.difficulty).toEqual({ easy: 4, medium: 1, hard: 2 }); // 难度分面不受难度筛选影响
    expect(hard.facets.chapters.map((c: any) => c.total)).toEqual([1, 1]); // 章分面受难度筛选影响
    const ch = (await get(s1, `/student/practice?chapter=${encodeURIComponent('第二章 数列极限')}`)).body;
    expect(ch.items.map((i: any) => i.problemId)).toEqual(['a1', 'epsN', 'a2', 'a3']);
    expect(ch.facets.chapters).toHaveLength(3); // 章分面不受章筛选影响
    const q = (await get(s1, `/student/practice?q=${encodeURIComponent('夹逼')}`)).body;
    expect(q.items.map((i: any) => i.problemId)).toEqual(['a2']);
  });

  it('分页：游标稳定、不重不漏；坏游标 422；limit 越界被夹到上限', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const url: string = `/student/practice?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await get(s1, url);
      seen.push(...body.items.map((it: any) => it.problemId));
      cursor = body.nextCursor;
      if (cursor === null) break;
      expect(body.items).toHaveLength(3);
    }
    expect(seen).toEqual(['a1', 'epsN', 'a2', 'a3', 'series', 'b1', 'free']);
    expect((await get(s1, '/student/practice?cursor=garbage')).status).toBe(422);
    expect((await get(s1, '/student/practice?limit=0')).status).toBe(422);
    expect((await get(s1, '/student/practice?difficulty=extreme')).status).toBe(422);
    expect((await get(s1, '/student/practice?limit=9999')).body.items.length).toBe(7);
  });

  it('状态按学生算：甲做完的题，乙看到的仍是 todo；status 筛选与章分面的 done 随之变化', async () => {
    const started = await post(s1, '/student/practice/a2/start');
    expect((await get(s1, '/student/practice?q=夹逼')).body.items[0].status).toBe('active');
    await completeAttempt(started.body.state.attemptId);
    const mine = (await get(s1, '/student/practice')).body;
    expect(mine.items.find((i: any) => i.problemId === 'a2')).toMatchObject({ status: 'done', attemptId: started.body.state.attemptId });
    expect(mine.facets.chapters[0]).toMatchObject({ total: 4, done: 1 });
    expect((await get(s1, '/student/practice?status=done')).body.items.map((i: any) => i.problemId)).toEqual(['a2']);
    const theirs = (await get(s2, '/student/practice')).body;
    expect(theirs.items.find((i: any) => i.problemId === 'a2')).toMatchObject({ status: 'todo', attemptId: null });
    expect(theirs.facets.chapters[0].done).toBe(0);
  });

  it('测验期间（含未开放）这道题不在列表和随机里，结束后回来', async () => {
    const test = await addAssignment('a1', 'test', { closeIn: '1 hour' });
    expect((await get(s1, '/student/practice')).body.items.map((i: any) => i.problemId)).not.toContain('a1');
    await db.query(`update app.assignments set status = 'closed' where id = $1`, [test]);
    expect((await get(s1, '/student/practice')).body.items.map((i: any) => i.problemId)).toContain('a1');
  });

  it('列表里没有解题思路与参考证明', async () => {
    const text = JSON.stringify((await get(s1, '/student/practice?limit=50')).body);
    const walk = (await db.query<{ w: any }>(`select secret->'walkthrough' as w from vault.problem_secrets where problem_id = 'epsN'`)).rows[0]!.w;
    expect(text).not.toContain(walk.approach);
    expect(text).not.toContain('参考证明');
    expect(text).not.toContain('walkthrough');
  });

  it('随机：只给没做完的题；范围内都做完了 404；尊重章节与难度', async () => {
    for (let i = 0; i < 12; i += 1) {
      const r = await post(s1, '/student/practice/random', { difficulty: 'hard' });
      expect(r.status).toBe(200);
      expect(['a3', 'b1']).toContain(r.body.problemId);
    }
    const a3 = await post(s1, '/student/practice/a3/start');
    await completeAttempt(a3.body.state.attemptId);
    for (let i = 0; i < 8; i += 1) expect((await post(s1, '/student/practice/random', { difficulty: 'hard' })).body.problemId).toBe('b1');
    const b1 = await post(s1, '/student/practice/b1/start');
    await completeAttempt(b1.body.state.attemptId);
    const none = await post(s1, '/student/practice/random', { difficulty: 'hard' });
    expect(none.status).toBe(404);
    expect(none.body.error.message).toContain('做过了');
    // 乙没做过，仍能随机到。
    expect((await post(s2, '/student/practice/random', { difficulty: 'hard' })).status).toBe(200);
  });
});

describe('解答：查看与放行', () => {
  const walk = async () => (await db.query<{ w: any }>(`select secret->'walkthrough' as w from vault.problem_secrets where problem_id = 'epsN'`)).rows[0]!.w;
  const reveal = (cookie: string, level: string) => post(cookie, '/student/practice/epsN/solution/reveal', { level });

  it('没开始做之前：看不到，也不能查看（409）；解答接口只告诉有无', async () => {
    const sol = await get(s1, '/student/practice/epsN/solution');
    expect(sol.body).toEqual({ level: 'none', canReveal: false, hasApproach: true, hasFull: true });
    expect((await reveal(s1, 'approach')).status).toBe(409);
    expect((await reveal(s1, 'bogus')).status).toBe(422);
  });

  it('自学作答里：先看思路 → 只含思路与关键点；再看完整解答 → 含易错点与参考证明；记事件、审计、不重复记', async () => {
    const started = await post(s1, '/student/practice/epsN/start');
    const attemptId = started.body.state.attemptId as string;
    expect((await get(s1, '/student/practice/epsN/solution')).body).toMatchObject({ level: 'none', canReveal: true });
    const w = await walk();

    const approach = await reveal(s1, 'approach');
    expect(approach.status, JSON.stringify(approach.body)).toBe(200);
    expect(approach.body).toMatchObject({ level: 'approach', approach: w.approach, keyIdeas: w.keyIdeas, canReveal: true });
    expect(approach.body.pitfalls).toBeUndefined();
    expect(approach.body.referenceProof).toBeUndefined();
    expect(await revealLevelFor(db, attemptId)).toBe('approach');

    const full = await reveal(s1, 'full');
    expect(full.body).toMatchObject({ level: 'full', pitfalls: w.pitfalls, canReveal: false });
    expect(full.body.referenceProof).toContain('任取');
    expect(await revealLevelFor(db, attemptId)).toBe('full');

    await reveal(s1, 'full');
    await reveal(s1, 'approach');
    const events = (await db.query<any>(`select payload from ev.events where attempt_id = $1 and type = 'solution.revealed' order by seq`, [attemptId])).rows;
    expect(events.map((e: any) => e.payload.level)).toEqual(['approach', 'full']);
    const logs = (await db.query(`select 1 from vault.reference_access_log where purpose = 'review'`)).rows;
    expect(logs).toHaveLength(1);
    // 另一位同学不受影响。
    expect((await get(s2, '/student/practice/epsN/solution')).body.level).toBe('none');
    // 作答状态 DTO 里仍没有思路。
    expect(JSON.stringify((await get(s1, `/attempts/${attemptId}`)).body)).not.toContain(w.approach);
  });

  it('完成后自动给完整解答（不记查看）；完成前不给', async () => {
    const started = await post(s1, '/student/practice/epsN/start');
    await completeAttempt(started.body.state.attemptId);
    const sol = await get(s1, '/student/practice/epsN/solution');
    expect(sol.body.level).toBe('full');
    expect(sol.body.referenceProof).toBeTruthy();
    expect((await reveal(s1, 'full')).status).toBe(200);
    expect((await db.query(`select 1 from app.solution_reveals`)).rows).toHaveLength(0);
  });

  it('老师布置的作答（练习或测验）一律不能查看 → 403；别人的作答不算我的', async () => {
    const asg = await addAssignment('epsN', 'practice');
    await post(s1, `/student/assignments/${asg}/attempt`);
    const refused = await reveal(s1, 'approach');
    expect(refused.status).toBe(403);
    expect((await db.query(`select 1 from app.solution_reveals`)).rows).toHaveLength(0);
    expect((await get(s1, '/student/practice/epsN/solution')).body).toMatchObject({ level: 'none', canReveal: false });
    // 乙没有任何作答：不能借甲的作答。
    expect((await reveal(s2, 'full')).status).toBe(409);
  });

  it('测验模式的作答、以及班里还有没结束的测验时 → 403，且不泄露已有查看记录', async () => {
    const started = await post(s1, '/student/practice/epsN/start');
    await reveal(s1, 'approach');
    const test = await addAssignment('epsN', 'test', { closeIn: '1 hour' });
    const r = await reveal(s1, 'full');
    expect(r.status).toBe(403);
    expect((await get(s1, '/student/practice/epsN/solution')).body).toMatchObject({ level: 'none', canReveal: false });
    // 即使作答已完成，测验没结束也不给。
    await completeAttempt(started.body.state.attemptId);
    expect((await get(s1, '/student/practice/epsN/solution')).body.level).toBe('none');
    await db.query(`update app.assignments set status = 'closed' where id = $1`, [test]);
    expect((await get(s1, '/student/practice/epsN/solution')).body.level).toBe('full');
  });

  it('没有解题思路的题（旧题）不能看 approach；没有可发布参考证明时 full 只给思路', async () => {
    await addProblem('old');
    await db.query(`update vault.problem_secrets set secret = secret - 'walkthrough' where problem_id = 'old'`);
    await post(s1, '/student/practice/old/start');
    expect((await post(s1, '/student/practice/old/solution/reveal', { level: 'approach' })).status).toBe(404);
    const full = await post(s1, '/student/practice/old/solution/reveal', { level: 'full' });
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ level: 'full', hasApproach: false });
    expect(full.body.referenceProof).toContain('参考证明 old');
  });

  it('解题思路不出现在作答状态、路径、首页、练习列表里（未查看时）', async () => {
    const w = await walk();
    const started = await post(s1, '/student/practice/epsN/start');
    const texts = [
      JSON.stringify(started.body),
      JSON.stringify((await get(s1, '/student/path')).body),
      JSON.stringify((await get(s1, '/student/home')).body),
      JSON.stringify((await get(s1, '/student/practice')).body),
      JSON.stringify((await get(s1, '/student/practice/epsN/solution')).body),
    ];
    for (const text of texts) {
      expect(text).not.toContain(w.approach);
      for (const idea of w.keyIdeas) expect(text).not.toContain(idea);
    }
  });
});

describe('教师端：自学进度与题库分页', () => {
  it('self-study：只给班主任/本班教师；进度按单元；看过解答的计数；不影响看板', async () => {
    const a = await post(s1, '/student/practice/epsN/start');
    await post(s1, '/student/practice/epsN/solution/reveal', { level: 'approach' });
    await completeAttempt(a.body.state.attemptId);
    const view = await get(teacherCookie, `/teacher/classes/${classId}/self-study`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.units.map((u: any) => [u.chapterNo, u.total])).toEqual([[2, 1], [12, 1]]);
    const row = view.body.students.find((s: any) => s.displayName === '甲');
    expect(row).toMatchObject({ doneTotal: 1, active: 0, revealed: 1 });
    expect(row.byUnit[0].done).toBe(1);
    expect(view.body.students.map((s: any) => s.revealed).sort()).toEqual([0, 1]);
    await createTeacherAccount(db, { username: 'other.t', password: PASSWORD });
    const other = await app.inject({ method: 'POST', url: '/api/v1/auth/teacher/login', headers: WRITE_HEADERS, payload: { username: 'other.t', password: PASSWORD } });
    expect((await get(cookieFrom(other.headers['set-cookie']), `/teacher/classes/${classId}/self-study`)).status).toBe(404);
    const live = await get(teacherCookie, `/teacher/classes/${classId}/live`);
    expect(live.body.assignmentId).toBeNull();
  });

  it('/teacher/problems：不传 limit 照旧返回数组；传 limit 分页，游标在 X-Next-Cursor；q 搜索；带 reviewSource', async () => {
    for (const id of ['z1', 'z2', 'z3']) await addProblem(id, { title: `搜索题 ${id}`, reviewSource: id === 'z2' ? 'auto' : 'teacher' });
    const all = await get(teacherCookie, '/teacher/problems');
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBeGreaterThanOrEqual(7);
    expect(all.res.headers['x-next-cursor']).toBeUndefined();

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      const res = await get(teacherCookie, `/teacher/problems?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(3);
      seen.push(...res.body.map((p: any) => `${p.problemId}@${p.version}`));
      cursor = res.res.headers['x-next-cursor'] as string | undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual(all.body.map((p: any) => `${p.problemId}@${p.version}`));

    const found = await get(teacherCookie, `/teacher/problems?q=${encodeURIComponent('搜索题')}&limit=10`);
    expect(found.body.map((p: any) => p.problemId)).toEqual(['z1', 'z2', 'z3']);
    expect(found.body.find((p: any) => p.problemId === 'z2').reviewSource).toBe('auto');
    expect((await get(teacherCookie, '/teacher/problems?limit=0')).status).toBe(422);
    expect((await get(teacherCookie, '/teacher/problems?limit=5&cursor=bad')).status).toBe(422);
  });
});
