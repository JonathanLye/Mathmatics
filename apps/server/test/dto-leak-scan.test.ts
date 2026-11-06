import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { gateRule, serializeState, type Secret } from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { createSession, SESSION_COOKIE, STUDENT_SESSION_MS } from '../src/auth/session.ts';
import { loadProblem } from '../src/attempts/problem.ts';
import { loadConfig } from '../src/config.ts';
import { seedContent } from '../src/db/seed.ts';
import type { Db } from '../src/db/index.ts';

// 引擎的测试替身：把 epsN 作答推到额度用尽（reveal 2/2）。只在测试里引用。
import { Runner } from '../../../packages/engine/test/support/runner.ts';
import { SCENARIOS } from '../../../packages/engine/test/support/scenarios.ts';

import { buildTestApp, cookieFrom, DEVICE_B, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// 12 §7 第 3 项：4 道题未透露 key 的 leak 片段，在所有学生接口响应中 0 命中（H3/H4 已透露 key 除外；逐字段 canon）。
//
// 做法：用真实种子题目包（不造假题），对两道主题各走一遍真实 HTTP 路由（含它们的迁移题子作答），记下每个响应，
// 然后对 4 道题的全部 secret 逐字段过 gateRule（运行时闸门本身，不另写匹配逻辑）。
//
// 比 support/help.ts 的 leakHits 严格的两点：
// 1. 豁免按题目隔离。key id 只在本题内有意义（每道题都有 K1），epsN 的 K1 已写出不能豁免 series 的 K1。
// 2. JSON 的键名也扫（Record 型字段的键也是发给学生的字符串）。
//
// 唯一的跨题豁免：经 /transfer 进入的迁移题子作答，豁免父作答此刻库里 hint.matched 记录的父题 key。
// 依据是引擎：finish 要求路线全部写出才离开第 3 层，所以父题 key 对这名学生已经不是"未透露"（"跨题门槛"用例验证）。
// 迁移题被教师直接布置时没有父作答，没有这条豁免（"直接布置"用例）。
//
// 白盒改状态（setHint / setLayer）只用来把作答放到某一层，不碰任何响应、闸门或题目内容；负面对照除外，那里是故意投毒。

const PROBLEMS = [
  { main: 'epsN', transfer: 'epsN-T1' },
  { main: 'series', transfer: 'series-T1' },
] as const;
const ALL_PROBLEM_IDS = ['epsN', 'epsN-T1', 'series', 'series-T1'];

// 主题走到的每个学生接口。覆盖面守卫（见下）用它和契约对账。
const MAIN_OPS = [
  'POST /auth/student/login',
  'POST /auth/student/age-band',
  'POST /auth/logout',
  'GET /me',
  'GET /consents',
  'POST /consents',
  'GET /student/home',
  'POST /student/assignments/{assignmentId}/attempt',
  'GET /attempts/{attemptId}',
  'POST /attempts/{attemptId}/layers/{layer}/skip',
  'POST /attempts/{attemptId}/definition',
  'POST /attempts/{attemptId}/framework',
  'POST /attempts/{attemptId}/framework/template',
  'POST /attempts/{attemptId}/lines',
  'POST /attempts/{attemptId}/finish',
  'POST /attempts/{attemptId}/selfcheck/{itemId}',
  'POST /attempts/{attemptId}/transfer',
  'POST /attempts/{attemptId}/summary',
  'POST /attempts/{attemptId}/park',
  'POST /attempts/{attemptId}/help',
  'POST /attempts/{attemptId}/hints/claim',
  'POST /events/batch',
  'POST /recognitions/ink',
  'POST /recognitions/photo',
  'POST /recognitions/{recogId}/confirm',
  'GET /attempts/{attemptId}/lesson/{conceptId}',
  'POST /attempts/{attemptId}/lesson/{conceptId}/check',
] as const;

// 迁移题子作答（kind=transfer，从第 3 层开始）走到的接口。
const TRANSFER_OPS = [
  'GET /attempts/{attemptId}',
  'POST /attempts/{attemptId}/lines',
  'POST /attempts/{attemptId}/finish',
  'POST /attempts/{attemptId}/help',
  'POST /attempts/{attemptId}/hints/claim',
] as const;

const ALL_REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
const SESSION_ID = '6f1b2c4e-8d3a-4b7e-9c10-2a5d7e8f9a02';
const INPUT = { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000d1' };
// 不含任何泄题片段的学生文本：响应里出现的命中只可能来自服务端。
const NEUTRAL_LINE = '由题设先写一行';

// 识别接口：模型走脚本化 fetch（不出网），识别结果固定为不含泄题片段的中性文本。
// 扫描要验证的是服务端自己拼出来的响应字段（状态、diff、提示文案、错误信封）里没有题目机密，而不是模型说了什么。
const KEYED = loadConfig({ NODE_ENV: 'test', SIMPLETEX_APP_ID: 'test-app', SIMPLETEX_APP_SECRET: 'test-secret-value', DASHSCOPE_API_KEY: 'test-dashscope-key' });
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const modelFetch = (async (url: string) => {
  if (url.includes('simpletex_ocr')) return json({ status: true, res: { content: `$\\text{${NEUTRAL_LINE}}$\n\n${NEUTRAL_LINE}二` } });
  if (url.includes('latex_ocr')) return json({ status: true, res: { latex: `\\text{${NEUTRAL_LINE}}`, conf: 0.95 } });
  if (url.includes('chat/completions')) return json({ choices: [{ message: { content: `${NEUTRAL_LINE}\n${NEUTRAL_LINE}二` } }] });
  return json({}, 404);
}) as unknown as typeof fetch;

const INK_DOC = {
  v: 1,
  w: 360,
  h: 120,
  dpr: 2,
  t0: 0,
  orientation: 'portrait',
  fullscreen: false,
  strokes: [{ id: 0, p: 'pen', pts: [[10, 40, 0, 0.5], [60, 44, 20, 0.5], [120, 40, 40, 0.5]] }],
};
const inkBase64 = (): string => gzipSync(Buffer.from(JSON.stringify(INK_DOC))).toString('base64');

// 最小的 JPEG：魔数 + 一个 SOF0 段（640×480），足够通过类型嗅探
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b08' + '01e0' + '0280' + '0100' + 'ffd9', 'hex');
function photoForm(fields: Record<string, string>): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----pgleak${randomUUID()}`;
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    JPEG,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

type VaultRow = { problem_id: string; secret: Secret };
type Tag = 'concept' | 'check_line' | 'hint' | 'chip';

interface ScanRecord {
  op: string;
  owner: string; // 响应所属题目
  exempt: Readonly<Record<string, readonly string[]>>; // 题目 → 已写出 / H3-H4 已透露的 key。只对该题生效
  status: number;
  body: string;
  tag?: Tag;
}

// 响应里每个字符串（值和键名）及其 JSON 路径。
function fields(value: unknown, path = '$'): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => fields(item, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [{ path: `${path}.<key>`, text: k }, ...fields(v, `${path}.${k}`)]);
  }
  return [];
}

function scan(records: readonly ScanRecord[], vault: readonly VaultRow[]): string[] {
  const hits: string[] = [];
  for (const record of records) {
    if (record.body === '') continue; // 204 没有响应体
    for (const { path, text } of fields(JSON.parse(record.body))) {
      for (const { problem_id: problemId, secret } of vault) {
        const exempt = new Set(record.exempt[problemId] ?? []);
        const result = gateRule(secret, text, exempt, []);
        if (!result.ok) {
          for (const hit of result.hits) {
            hits.push(`${record.op} (${record.owner}) ${path}: ${problemId}/${hit.key} 片段「${hit.frag}」 ← ${text}`);
          }
        }
      }
    }
  }
  return hits;
}

const ok = (r: ScanRecord): boolean => r.status >= 200 && r.status < 300;

interface StudentContext {
  app: FastifyInstance;
  db: Db;
  fx: Fixture;
  cookie: string;
  records: ScanRecord[];
}

async function openApp(mainId: string): Promise<Omit<StudentContext, 'cookie' | 'records'> & { assignmentId: string }> {
  const fx = await setupFixture();
  await seedContent(fx.db);
  const app = await buildTestApp(fx.db, { rateLimits: { events: 100_000, help: 100_000 }, models: KEYED.models }, { fetchImpl: modelFetch });
  await app.ready();
  const teacherId = (await fx.db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id;
  const version = (
    await fx.db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = $1`, [mainId])
  ).rows[0]?.version;
  const assignment = await fx.db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1, $2, $3, 'practice', now() - interval '1 hour', 'open', $4) returning id`,
    [fx.classId, mainId, version, teacherId],
  );
  return { app, db: fx.db, fx, assignmentId: assignment.rows[0]?.id as string };
}

async function matchedOf(db: Db, attemptId: string): Promise<string[]> {
  const row = await db.query<{ state: { hint: { matched: string[] } } }>(`select state from app.attempts where id = $1`, [attemptId]);
  return row.rows[0]?.state.hint.matched ?? [];
}

// 迁移题子作答的父题 key（读库，不是推算）。没有父作答时返回空对象。
async function parentExempt(db: Db, attemptId: string): Promise<Record<string, string[]>> {
  const row = await db.query<{ problem_id: string; state: { hint: { matched: string[] } } }>(
    `select p.problem_id, p.state from app.attempts c join app.attempts p on p.id = c.parent_attempt_id where c.id = $1`,
    [attemptId],
  );
  const parent = row.rows[0];
  return parent ? { [parent.problem_id]: parent.state.hint.matched } : {};
}

// 发一次真实请求并记录。op 形如 "POST /attempts/{attemptId}/lines"，URL 由它和 params 拼出，保证记录的接口就是真实请求的接口。
// 豁免取请求之前本题已写出的 key（与 redteam.test.ts 的证明行通道同一口径），extraExempt 只用于 H3/H4 所属的 key。
async function call(
  ctx: StudentContext,
  op: string,
  owner: string,
  opts: { params?: Record<string, string>; payload?: unknown; extraExempt?: readonly string[]; tag?: Tag; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, any>; body: string; headers: Record<string, unknown> }> {
  const [method, template] = op.split(' ') as ['GET' | 'POST', string];
  const params = opts.params ?? {};
  const url = template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
  const attemptId = params.attemptId;
  const matched = attemptId === undefined ? [] : await matchedOf(ctx.db, attemptId);
  const parent = attemptId === undefined ? {} : await parentExempt(ctx.db, attemptId);
  const res = await ctx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: ctx.cookie } : { cookie: ctx.cookie, ...WRITE_HEADERS, ...opts.headers },
    ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
  });
  ctx.records.push({
    op,
    owner,
    exempt: { ...parent, [owner]: [...matched, ...(opts.extraExempt ?? [])] },
    status: res.statusCode,
    body: res.body,
    ...(opts.tag === undefined ? {} : { tag: opts.tag }),
  });
  return { status: res.statusCode, json: res.body === '' ? {} : res.json(), body: res.body, headers: res.headers };
}

async function setState(db: Db, attemptId: string, layer: string, state: Record<string, unknown>): Promise<void> {
  await db.query(`update app.attempts set state = $2::jsonb, current_layer = $3 where id = $1`, [attemptId, JSON.stringify(state), layer]);
}

async function storedState(db: Db, attemptId: string): Promise<Record<string, any>> {
  return (await db.query<{ state: Record<string, any> }>(`select state from app.attempts where id = $1`, [attemptId])).rows[0]!.state;
}

const event = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: 'app.open',
  tsClient: '2026-11-03T04:00:00.000Z',
  sessionId: SESSION_ID,
  deviceId: loginBody().deviceId,
  clientSeq: 1,
  payload: { entry: 'direct' },
  ...overrides,
});

// 提示阶梯：按路线把每个 key 的每一级预写提示都真实下发一遍（H0/H1 直接给，H2 起 预览 + 领取）。
// 只有透露量为 1 的提示（H3/H4）才豁免它所属的 key，其余全部严格。返回实际收到的提示文本。
async function walkHintLadder(ctx: StudentContext, owner: string, attemptId: string, secret: Secret): Promise<string[]> {
  const delivered: string[] = [];
  const base = await storedState(ctx.db, attemptId);
  for (const route of secret.routes) {
    for (const [position, keyId] of route.entries()) {
      const key = secret.keys.find((k) => k.id === keyId);
      if (!key) throw new Error(`路线引用了不存在的关键步骤 ${keyId}`);
      for (const [level, hint] of key.hints.entries()) {
        await setState(ctx.db, attemptId, 'L3', {
          ...base,
          layer: 3,
          hint: { ...base.hint, matched: route.slice(0, position), hintLv: { [key.id]: level }, reveal: 0, hintTimes: [] },
        });
        const extraExempt = hint.cost === 1 ? [key.id] : [];
        const params = { attemptId };
        const asked = await call(ctx, 'POST /attempts/{attemptId}/help', owner, { params, payload: { intent: 'stuck' }, tag: 'hint' });
        if (asked.json.note !== undefined) {
          delivered.push(String(asked.json.note.text));
          continue;
        }
        const token = asked.json.preview?.previewToken;
        if (typeof token !== 'string') continue; // 没拿到令牌：下面的"每条提示都下发过"会失败并指出是哪条
        const claimed = await call(ctx, 'POST /attempts/{attemptId}/hints/claim', owner, {
          params,
          payload: { previewToken: token },
          extraExempt,
          tag: 'hint',
        });
        if (claimed.json.note !== undefined) delivered.push(String(claimed.json.note.text));
      }
    }
  }
  await setState(ctx.db, attemptId, 'L3', { ...base, layer: 3 });
  return delivered;
}

let nextIdx = 1000;
async function insertLine(
  db: Db,
  attemptId: string,
  fields_: { justification?: string; cls: string; errorId?: string },
): Promise<string> {
  nextIdx += 1;
  const row = await db.query<{ id: string }>(
    `insert into app.attempt_lines
       (attempt_id, layer, role, idx, statement, justification, statement_canon, provenance, cls, error_id)
     values ($1, 'L3', 'step', $2, $3, $4, $3, 'keyboard', $5, $6) returning id`,
    [attemptId, nextIdx, NEUTRAL_LINE, fields_.justification ?? null, fields_.cls, fields_.errorId ?? null],
  );
  return row.rows[0]?.id as string;
}

// 概念回答与行批注（#141）。记下概念回答与每条错误行得到的批注，供后面断言"下发的是真实内容"。
async function walkConceptAndCheckLine(
  ctx: StudentContext,
  owner: string,
  attemptId: string,
  secret: Secret,
): Promise<{ concept: Record<string, any>; errorNotes: Array<{ errorId: string; lineId: string; note: unknown }> }> {
  const params = { attemptId };
  const help = 'POST /attempts/{attemptId}/help';
  const concept = await call(ctx, help, owner, { params, payload: { intent: 'concept' }, tag: 'concept' });

  // 真实路径：/lines 写的一行，缺省指向最新一行。
  await call(ctx, 'POST /attempts/{attemptId}/lines', owner, { params, payload: { statement: NEUTRAL_LINE, justification: '由题设', input: INPUT } });
  await call(ctx, help, owner, { params, payload: { intent: 'check_line' }, tag: 'check_line' });

  // 种子里的每条错误都走一遍（错误行的追问是预写文本）。
  const errorNotes: Array<{ errorId: string; lineId: string; note: unknown }> = [];
  for (const error of secret.errors) {
    const lineId = await insertLine(ctx.db, attemptId, { cls: 'error', errorId: error.id, justification: '由定义' });
    const res = await call(ctx, help, owner, { params, payload: { intent: 'check_line', lineId }, tag: 'check_line' });
    errorNotes.push({ errorId: error.id, lineId, note: res.json.note });
  }

  // 其余行分类各一条。
  for (const cls of ['match', 'pass', 'demo_needs_reason', 'unknown']) {
    const justified = await insertLine(ctx.db, attemptId, { cls, justification: '由定义' });
    await call(ctx, help, owner, { params, payload: { intent: 'check_line', lineId: justified }, tag: 'check_line' });
  }
  const bare = await insertLine(ctx.db, attemptId, { cls: 'match' });
  await call(ctx, help, owner, { params, payload: { intent: 'check_line', lineId: bare }, tag: 'check_line' });

  // 低置信行的批注取"下一个 key 的 H0"：沿路线每个进度点各一条，覆盖每个 key 的 H0。
  const base = await storedState(ctx.db, attemptId);
  for (const route of secret.routes) {
    for (const position of route.keys()) {
      await setState(ctx.db, attemptId, 'L3', { ...base, layer: 3, hint: { ...base.hint, matched: route.slice(0, position) } });
      const lowconf = await insertLine(ctx.db, attemptId, { cls: 'lowconf', justification: '由定义' });
      await call(ctx, help, owner, { params, payload: { intent: 'check_line', lineId: lowconf }, tag: 'check_line' });
    }
  }
  await setState(ctx.db, attemptId, 'L3', { ...base, layer: 3 });

  return { concept: concept.json, errorNotes };
}

interface Walk {
  main: string;
  transfer: string;
  records: ScanRecord[];
  vault: VaultRow[];
  home: { todo: Record<string, any>; inProgress: Record<string, any>; done: Record<string, any> };
  publicOf: Record<string, Record<string, any>>;
  consentsUnsigned: Record<string, any>;
  meBefore: Record<string, any>;
  meAfter: Record<string, any>;
  eventsBefore: Record<string, any>;
  eventsAfter: Record<string, any>;
  eventsDuplicate: Record<string, any>;
  ladder: Record<string, { delivered: string[]; expected: string[] }>;
  concept: Record<string, Record<string, any>>;
  errorNotes: Record<string, Array<{ errorId: string; lineId: string; note: unknown }>>;
  lesson: Record<string, any>;
  recognition: { ink: Record<string, any>; photo: Record<string, any>; confirm: Record<string, any>; photoConfirm: Record<string, any> };
  app: FastifyInstance;
  close(): Promise<void>;
}

// 一名学生从登录到完成一道主题（含迁移题）的全程。
async function walkProblem(main: string, transfer: string): Promise<Walk> {
  const { app, db, fx, assignmentId } = await openApp(main);
  const ctx: StudentContext = { app, db, fx, cookie: '', records: [] };
  const vault = (await db.query<VaultRow>(`select problem_id, secret from vault.problem_secrets`)).rows;
  const secretOf = (id: string): Secret => vault.find((v) => v.problem_id === id)?.secret as Secret;
  const publicOf: Record<string, Record<string, any>> = {};
  for (const id of [main, transfer]) {
    publicOf[id] = (await db.query<{ public: Record<string, any> }>(`select public from content.problem_versions where problem_id = $1`, [id])).rows[0]!.public;
  }
  const secret = secretOf(main);
  const fragment = secret.keys.find((k) => k.leak.length > 0)?.leak[0] as string;

  // —— 登录、年龄分档（14–17 岁的同意书多一段，取文本最多的一档）、同意前的只读接口
  await call(ctx, 'GET /me', main); // 未登录：错误信封也是学生接口响应
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  ctx.records.push({ op: 'POST /auth/student/login', owner: main, exempt: {}, status: login.statusCode, body: login.body });
  ctx.cookie = cookieFrom(login.headers['set-cookie']);
  await call(ctx, 'POST /auth/student/age-band', main, { payload: { ageBand: '14to17' } });
  const meBefore = (await call(ctx, 'GET /me', main)).json;
  const consentsUnsigned = (await call(ctx, 'GET /consents', main)).json;
  const todo = (await call(ctx, 'GET /student/home', main)).json;

  // —— 同意前的事件：接受、以及每种被拒原因。负载里夹带真实泄题片段，响应不能把它回显出来。
  const eventsBefore = (
    await call(ctx, 'POST /events/batch', main, {
      payload: {
        events: [
          event(),
          event({ type: 'sys.error', payload: { code: fragment, where: fragment } }),
          event({ type: 'nav.page', payload: { page: fragment } }),
          event({ type: 'help.open', attemptId: randomUUID(), layer: 'L3', payload: { from: 'dock' } }), // consent_required
          event({ type: 'hint.deliver' }), // not_client_type（服务端事件）
          event({ type: 't.view' }), // wrong_role
          event({ payload: { entry: 123 } }), // schema
          'not-an-object', // malformed
        ],
      },
    })
  ).json;

  // —— 同意书
  await call(ctx, 'POST /consents', main, { payload: { version: consentsUnsigned.version, items: ALL_REQUIRED } });
  await call(ctx, 'GET /consents', main);
  const meAfter = (await call(ctx, 'GET /me', main)).json;

  // —— 开始作答、首页进行中
  const started = await call(ctx, 'POST /student/assignments/{assignmentId}/attempt', main, { params: { assignmentId } });
  const attemptId = started.json.state.attemptId as string;
  const params = { attemptId };
  const inProgress = (await call(ctx, 'GET /student/home', main)).json;

  // —— 学习路径与练习区（Task 11 / 16）：此刻作答未完成、没有任何查看记录，这些响应里不得出现题目机密。
  // 解题思路（secret.walkthrough）在未查看前同样不能出现在任何一个响应里。
  await call(ctx, 'GET /student/path', main);
  await call(ctx, 'POST /student/path/items/{problemId}/start', main, { params: { problemId: main } });
  await call(ctx, 'GET /student/practice', main);
  await call(ctx, 'POST /student/practice/random', main, { payload: {} });
  await call(ctx, 'POST /student/practice/{problemId}/start', main, { params: { problemId: main } });
  await call(ctx, 'GET /student/practice/{problemId}/solution', main, { params: { problemId: main } });
  await call(ctx, 'GET /attempts/{attemptId}', main, { params });

  // —— 同意后的事件：带作答 ID 接受、不存在的作答被拒、同批重发算重复。
  const acceptedEvent = event({ type: 'help.open', attemptId, layer: 'L1', payload: { from: 'dock' } });
  const eventsAfter = (
    await call(ctx, 'POST /events/batch', main, {
      params,
      payload: {
        events: [
          acceptedEvent,
          event({ type: 'integ.visibility', attemptId, layer: 'L1', payload: { state: 'hidden' } }),
          event({ type: 'help.open', attemptId: randomUUID(), layer: 'L1', payload: { from: 'dock' } }), // attempt_not_found
          event({ type: 'sys.error', payload: { code: fragment, where: fragment } }),
        ],
      },
    })
  ).json;
  const eventsDuplicate = (await call(ctx, 'POST /events/batch', main, { params, payload: { events: [acceptedEvent] } })).json;

  // —— /recognitions：手写 → 确认；拍照 → 确认。模型走脚本化 fetch。
  const ink = await call(ctx, 'POST /recognitions/ink', main, {
    payload: { attemptId, draftId: randomUUID(), target: 'line_statement', ink: inkBase64() },
  });
  const confirmed = await call(ctx, 'POST /recognitions/{recogId}/confirm', main, {
    params: { recogId: ink.json.recogId as string },
    payload: { text: ink.json.text as string },
  });
  const form = photoForm({ attemptId, draftId: randomUUID(), target: 'line_statement', source: 'camera' });
  const photo = await call(ctx, 'POST /recognitions/photo', main, { payload: form.payload, headers: form.headers });
  const photoConfirmed = await call(ctx, 'POST /recognitions/{recogId}/confirm', main, {
    params: { recogId: photo.json.recogId as string },
    payload: { text: (photo.json.lines as Array<{ text: string }>).map((l) => l.text).join('\n'), lines: (photo.json.lines as Array<{ text: string }>).map((l) => l.text) },
  });

  // —— 预写微课：整份讲义与每一步的小核验（答对、答错各一次）都过扫描。
  const conceptId = (publicOf[main]?.def as { conceptId: string }).conceptId;
  const lessonParams = { attemptId, conceptId };
  const lesson = (await call(ctx, 'GET /attempts/{attemptId}/lesson/{conceptId}', main, { params: lessonParams })).json;
  for (const step of lesson.steps as Array<{ id: string; check?: { options: string[] } }>) {
    if (!step.check) continue;
    for (let choice = 0; choice < step.check.options.length; choice++) {
      await call(ctx, 'POST /attempts/{attemptId}/lesson/{conceptId}/check', main, { params: lessonParams, payload: { stepId: step.id, choice } });
    }
  }

  // —— 第 1、2 层
  await call(ctx, 'POST /attempts/{attemptId}/definition', main, { params, payload: { text: NEUTRAL_LINE, input: INPUT } });
  await call(ctx, 'POST /attempts/{attemptId}/layers/{layer}/skip', main, { params: { attemptId, layer: 'L1' } });
  await call(ctx, 'POST /attempts/{attemptId}/framework', main, { params, payload: { text: NEUTRAL_LINE, input: INPUT } });
  await call(ctx, 'POST /attempts/{attemptId}/framework/template', main, { params });
  await call(ctx, 'POST /attempts/{attemptId}/layers/{layer}/skip', main, { params: { attemptId, layer: 'L2' } });

  // —— 第 3 层：写一行、求助（概念 / 行批注 / 题目自带的提问芯片 / 提示阶梯）、finish、搁置再恢复
  const ladder: Walk['ladder'] = {};
  const concept: Walk['concept'] = {};
  const errorNotes: Walk['errorNotes'] = {};
  const hintsOf = (s: Secret): string[] => s.routes.flatMap((route) => route.flatMap((id) => s.keys.find((k) => k.id === id)?.hints.map((h) => h.text) ?? []));

  const mainNotes = await walkConceptAndCheckLine(ctx, main, attemptId, secret);
  concept[main] = mainNotes.concept;
  errorNotes[main] = mainNotes.errorNotes;
  for (const text of (publicOf[main]?.askChips ?? []) as string[]) {
    await call(ctx, 'POST /attempts/{attemptId}/help', main, { params, payload: { intent: 'free', text }, tag: 'chip' });
  }
  ladder[main] = { delivered: await walkHintLadder(ctx, main, attemptId, secret), expected: hintsOf(secret) };
  await call(ctx, 'POST /attempts/{attemptId}/finish', main, { params });
  await call(ctx, 'POST /attempts/{attemptId}/park', main, { params });
  await call(ctx, 'POST /student/assignments/{assignmentId}/attempt', main, { params: { assignmentId } });

  // —— 第 4 层：真实走到这里的学生已写出整条路线，所以豁免本题路线上的 key（leak.ts 的 (c) 同一口径）。
  // 题库里的自检题全部放进 items，DTO 会把每道题的 question 都下发一次。
  const route = secret.routes[0] as string[];
  const base = await storedState(db, attemptId);
  const hintAllWritten = { ...base.hint, matched: route };
  await setState(db, attemptId, 'L4', {
    ...base,
    layer: 4,
    status: { 1: 'skip', 2: 'skip', 3: 'done' },
    hint: hintAllWritten,
    lines: route.length,
    keyLine: Object.fromEntries(route.map((id, i) => [id, i + 1])),
    selfcheck: { items: secret.selfcheckBank.map((q) => q.id), passed: {} },
  });
  for (const item of secret.selfcheckBank) {
    await call(ctx, 'POST /attempts/{attemptId}/selfcheck/{itemId}', main, {
      params: { attemptId, itemId: item.id },
      payload: { text: '第1行和第2行', input: INPUT },
    });
  }

  // —— 第 5 层：真实路由创建迁移题子作答，在子作答上重复第 3 层的全部求助路径。
  const atL5 = await storedState(db, attemptId);
  await setState(db, attemptId, 'L5', { ...atL5, layer: 5, status: { 1: 'skip', 2: 'skip', 3: 'done', 4: 'done' }, hint: hintAllWritten });
  const child = await call(ctx, 'POST /attempts/{attemptId}/transfer', main, { params });
  const childId = child.json.state.attemptId as string;
  const childParams = { attemptId: childId };
  const childSecret = secretOf(transfer);
  await call(ctx, 'GET /attempts/{attemptId}', transfer, { params: childParams });
  const childNotes = await walkConceptAndCheckLine(ctx, transfer, childId, childSecret);
  concept[transfer] = childNotes.concept;
  errorNotes[transfer] = childNotes.errorNotes;
  for (const text of (publicOf[transfer]?.askChips ?? []) as string[]) {
    await call(ctx, 'POST /attempts/{attemptId}/help', transfer, { params: childParams, payload: { intent: 'free', text }, tag: 'chip' });
  }
  ladder[transfer] = { delivered: await walkHintLadder(ctx, transfer, childId, childSecret), expected: hintsOf(childSecret) };
  await call(ctx, 'POST /attempts/{attemptId}/finish', transfer, { params: childParams });

  // —— 第 6 层：完成、首页已完成、完成后的状态
  const atL6 = await storedState(db, attemptId);
  await setState(db, attemptId, 'L6', {
    ...atL6,
    layer: 6,
    status: { 1: 'skip', 2: 'skip', 3: 'done', 4: 'done', 5: 'skip' },
    hint: hintAllWritten,
    summary: { asked: true },
  });
  await call(ctx, 'POST /attempts/{attemptId}/summary', main, {
    params,
    payload: { answers: ['第一问的回答', '第二问的回答', '第三问的回答', '第四问的回答', '第五问的回答'], input: INPUT },
  });
  await call(ctx, 'GET /attempts/{attemptId}', main, { params });
  const done = (await call(ctx, 'GET /student/home', main)).json;

  await call(ctx, 'POST /auth/logout', main);

  return {
    main,
    transfer,
    records: ctx.records,
    vault,
    home: { todo, inProgress, done },
    publicOf,
    consentsUnsigned,
    meBefore,
    meAfter,
    eventsBefore,
    eventsAfter,
    eventsDuplicate,
    ladder,
    concept,
    errorNotes,
    lesson,
    recognition: { ink: ink.json, photo: photo.json, confirm: confirmed.json, photoConfirm: photoConfirmed.json },
    app,
    close: async () => {
      await app.close();
      await fx.close();
    },
  };
}

// 契约里全部学生接口（不含教师端、健康检查）。
function contractStudentOps(): string[] {
  const openapi = parseYaml(readFileSync(fileURLToPath(import.meta.resolve('@proof-gym/contracts/openapi.yaml')), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  return Object.entries(openapi.paths)
    .filter(([path]) => !path.startsWith('/teacher') && !path.startsWith('/auth/teacher') && path !== '/health')
    .flatMap(([path, item]) => methods.filter((m) => m in item).map((m) => `${m.toUpperCase()} ${path}`));
}

function implemented(app: FastifyInstance, op: string): boolean {
  const [method, path] = op.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
  return app.hasRoute({ method, url: `/api/v1${path.replace(/\{(\w+)\}/g, ':$1')}` });
}

describe('DTO 泄露扫描（12 §7 第 3 项）', { timeout: 120_000 }, () => {
  const walks = new Map<string, Walk>();

  beforeAll(async () => {
    for (const { main, transfer } of PROBLEMS) walks.set(main, await walkProblem(main, transfer));
  }, 180_000);

  afterAll(async () => {
    for (const walk of walks.values()) await walk.close();
  });

  const walkOf = (main: string): Walk => walks.get(main) as Walk;
  const scanOp = (walk: Walk, owner: string, op: string): { records: ScanRecord[]; hits: string[] } => {
    const records = walk.records.filter((r) => r.owner === owner && r.op === op);
    return { records, hits: scan(records, walk.vault) };
  };

  it('金库里正好是真实种子的 4 道题，每道题都有可匹配的泄题片段（否则扫描没有意义）', () => {
    for (const { main } of PROBLEMS) {
      const { vault } = walkOf(main);
      expect(vault.map((v) => v.problem_id).sort()).toEqual(ALL_PROBLEM_IDS);
      for (const { secret } of vault) expect(secret.keys.flatMap((k) => k.leak).length).toBeGreaterThan(0);
    }
  });

  describe.each(PROBLEMS)('$main：主题全程', ({ main }) => {
    it.each(MAIN_OPS)('%s：至少一次成功响应，且 0 命中', (op) => {
      const { records, hits } = scanOp(walkOf(main), main, op);
      expect(records.filter(ok).length, `${op} 没有成功响应：${records.map((r) => `${r.status} ${r.body.slice(0, 200)}`).join(' | ')}`).toBeGreaterThan(0);
      expect(hits).toEqual([]);
    });
  });

  describe.each(PROBLEMS)('$transfer：迁移题子作答', ({ main, transfer }) => {
    it.each(TRANSFER_OPS)('%s：至少一次成功响应，且 0 命中', (op) => {
      const { records, hits } = scanOp(walkOf(main), transfer, op);
      expect(records.filter(ok).length, `${op} 没有成功响应：${records.map((r) => `${r.status} ${r.body.slice(0, 200)}`).join(' | ')}`).toBeGreaterThan(0);
      expect(hits).toEqual([]);
    });
  });

  describe.each(PROBLEMS)('$main：响应确实带着真实内容（防止空响应假绿）', ({ main }) => {
    // Task 11：首页卡片不再带整段题面（题多时体积大）；题面预览改由学习路径 / 练习区条目携带，见下一条。
    it('/student/home：待做 / 进行中 / 已完成三态都下发真实标题，且不带整段题面', () => {
      const walk = walkOf(main);
      const pub = walk.publicOf[main] as Record<string, any>;
      const card = { title: pub.title };
      expect(walk.home.todo.todo).toEqual([expect.objectContaining(card)]);
      expect(walk.home.inProgress.inProgress).toEqual([expect.objectContaining(card)]);
      expect(walk.home.done.done).toEqual([expect.objectContaining(card)]);
      for (const cards of [walk.home.todo.todo, walk.home.inProgress.inProgress, walk.home.done.done]) {
        expect((cards as Record<string, unknown>[])[0]).not.toHaveProperty('stem');
      }
    });

    it('/student/path 与 /student/practice：条目下发真实标题与截断的题面预览', () => {
      const walk = walkOf(main);
      const pub = walk.publicOf[main] as Record<string, any>;
      const path = walk.records.find((r) => r.owner === main && r.op === 'GET /student/path' && r.status === 200);
      const practice = walk.records.find((r) => r.owner === main && r.op === 'GET /student/practice' && r.status === 200);
      expect(path).toBeDefined();
      expect(practice).toBeDefined();
      // 路径只展开当前单元（第一个没做完的），另一道主题在别的单元里，只有摘要。
      const body = JSON.parse(path!.body) as { current: { items: Record<string, any>[] }; units: unknown[] };
      const item = body.current.items.find((i) => i.problemId === main);
      if (item) {
        expect(item).toMatchObject({ title: pub.title });
        expect(String(pub.stem).startsWith(String(item.stemPreview).replace(/…$/, ''))).toBe(true);
      } else {
        expect(body.units).toHaveLength(2);
      }
      const listed = (JSON.parse(practice!.body).items as Record<string, any>[]).find((i) => i.problemId === main);
      expect(listed).toMatchObject({ title: pub.title });
    });

    it('/consents：14–17 岁档的全部段落（含监护人告知）都被扫描', () => {
      const { consentsUnsigned } = walkOf(main);
      expect(consentsUnsigned.sections.length).toBeGreaterThan(5);
      const hits = fields(consentsUnsigned).filter((f) => f.text.includes('监护人'));
      expect(hits.length).toBeGreaterThan(0);
    });

    it('/me：同意前后都返回班级与匿名码', () => {
      const { meBefore, meAfter } = walkOf(main);
      for (const me of [meBefore, meAfter]) {
        expect(me.classes).toEqual([expect.objectContaining({ name: '高数 A 班' })]);
        expect(me.anonCode.length).toBeGreaterThan(0);
      }
      expect(meBefore.consentRequired).toBe(true);
      expect(meAfter.consentRequired).toBe(false);
    });

    it('/events/batch：接受、重复与五种拒绝都走到了；负载里的真实泄题片段不被回显', () => {
      const { eventsBefore, eventsAfter, eventsDuplicate } = walkOf(main);
      expect(eventsBefore.accepted).toBe(3);
      expect(eventsBefore.rejected.map((r: { reason: string }) => r.reason).sort()).toEqual(
        ['consent_required', 'malformed', 'not_client_type', 'schema', 'wrong_role'].sort(),
      );
      expect(eventsAfter.accepted).toBe(3);
      expect(eventsAfter.rejected.map((r: { reason: string }) => r.reason)).toEqual(['attempt_not_found']);
      expect(eventsDuplicate).toMatchObject({ accepted: 0, duplicates: 1 });
    });

    it('提示阶梯：路线上每个 key 的每一级预写提示都真实下发过（H3/H4 只豁免所属 key）', () => {
      const walk = walkOf(main);
      for (const id of [walk.main, walk.transfer]) {
        const { delivered, expected } = walk.ladder[id] as { delivered: string[]; expected: string[] };
        expect(expected.length).toBeGreaterThan(0);
        expect(delivered.sort()).toEqual([...expected].sort());
      }
    });
  });

  // 概念回答与行批注（PR #141）。
  describe.each(PROBLEMS)('$main：概念回答与行批注（#141）', ({ main, transfer }) => {
    it('concept / check_line 的响应 0 命中', () => {
      const walk = walkOf(main);
      const records = walk.records.filter((r) => r.tag === 'concept' || r.tag === 'check_line');
      expect(records.filter((r) => r.owner === main && r.tag === 'concept').length).toBe(1);
      expect(records.filter((r) => r.owner === transfer && r.tag === 'check_line').length).toBeGreaterThan(5);
      for (const record of records) expect(record.status, record.body).toBe(200);
      expect(scan(records, walk.vault)).toEqual([]);
    });

    it('题目自带的提问芯片（自由提问通道）0 命中', () => {
      const walk = walkOf(main);
      const records = walk.records.filter((r) => r.tag === 'chip');
      expect(records.length).toBeGreaterThan(0);
      expect(scan(records, walk.vault)).toEqual([]);
    });

    it('概念 note：下发的是真实词条，不是闸门回退文案', () => {
      const walk = walkOf(main);
      const note = walk.concept[main]?.note as Record<string, any>;
      const conceptId = (walk.publicOf[main]?.def as { conceptId: string }).conceptId;
      expect(note).toMatchObject({ kind: 'concept', level: 'H0', lessonConceptId: conceptId });
      expect(String(note.text)).not.toContain('我先不说这一点');
    });

    it('行批注：种子里每条错误都得到它预写的追问（主题与迁移题），不是闸门回退文案', () => {
      const walk = walkOf(main);
      for (const id of [main, transfer]) {
        const secret = walk.vault.find((v) => v.problem_id === id)?.secret as Secret;
        const notes = walk.errorNotes[id] as Array<{ errorId: string; lineId: string; note: unknown }>;
        expect(notes.map((n) => n.errorId)).toEqual(secret.errors.map((e) => e.id));
        for (const { errorId, lineId, note } of notes) {
          expect(note).toMatchObject({ kind: 'annotation', lineId, text: secret.errors.find((e) => e.id === errorId)?.question });
        }
      }
    });
  });

  describe.each(PROBLEMS)('$main：预写微课', ({ main }) => {
    it('下发真实讲义（不是空响应假绿）；答对答错两种反馈都被扫描', () => {
      const walk = walkOf(main);
      expect(walk.lesson.steps.length).toBeGreaterThan(1);
      expect(walk.lesson.steps.some((s: { check?: unknown }) => s.check !== undefined)).toBe(true);
      const checks = walk.records.filter((r) => r.op === 'POST /attempts/{attemptId}/lesson/{conceptId}/check');
      expect(checks.filter((r) => ok(r) && JSON.parse(r.body).correct === true).length).toBeGreaterThan(0);
      expect(checks.filter((r) => ok(r) && JSON.parse(r.body).correct === false).length).toBeGreaterThan(0);
    });
  });

  describe.each(PROBLEMS)('$main：/recognitions/*（#21）', ({ main }) => {
    it('手写 / 拍照 / 确认都返回真实识别内容（不是空响应假绿），且 0 命中', () => {
      const walk = walkOf(main);
      const { ink, photo, confirm, photoConfirm } = walk.recognition;
      expect(ink).toMatchObject({ status: 'ok' });
      expect(typeof ink.agree).toBe('boolean'); // 两路是否一致由脚本化 fetch 决定；字段本身与 diff 照样被扫描
      expect(String(ink.text)).toContain(NEUTRAL_LINE);
      expect(photo).toMatchObject({ status: 'ok' });
      expect((photo.lines as unknown[]).length).toBeGreaterThan(1);
      expect(confirm).toMatchObject({ recogId: ink.recogId });
      expect(photoConfirm).toMatchObject({ recogId: photo.recogId });
      for (const op of ['POST /recognitions/ink', 'POST /recognitions/photo', 'POST /recognitions/{recogId}/confirm']) {
        const { records, hits } = scanOp(walk, main, op);
        expect(records.length, op).toBeGreaterThan(0);
        for (const record of records) expect(record.status, `${op} ${record.body}`).toBe(200);
        expect(hits, op).toEqual([]);
      }
    });
  });

  it('覆盖面守卫：契约里已实现的学生接口都被本文件真实走到并扫描（新接口落地必须加进来）', () => {
    const walk = walkOf('epsN');
    expect(implemented(walk.app, 'POST /events/batch')).toBe(true); // 守卫自身有效：路由匹配能命中已有接口
    const ops = contractStudentOps();
    expect(ops).toContain('GET /student/home');
    const scanned = new Set<string>(walk.records.filter(ok).map((r) => r.op));
    // 这两个接口的响应按设计就含参考证明 / 解题思路，由 path-practice.test.ts 专门验证它们的放行条件，不适用“0 命中”。
    const BY_DESIGN_SECRET = new Set(['POST /student/practice/{problemId}/solution/reveal', 'GET /attempts/{attemptId}/review']);
    const unscanned = ops
      .filter((op) => implemented(walk.app, op) && !BY_DESIGN_SECRET.has(op))
      .filter((op) => !scanned.has(op));
    expect(unscanned, '这些学生接口已实现但没有泄露扫描：加进 walkProblem 与 MAIN_OPS').toEqual([]);
  });
});

// 跨题门槛：父题还有 key 没写出时走不到迁移题。这是上面"经 /transfer 进入时豁免父题 key"的依据。
describe.each(PROBLEMS)('跨题门槛：$main 缺任一 key 都到不了 $transfer', ({ main }) => {
  it('finish 不放行（停在第 3 层），/transfer 返回 409', { timeout: 60_000 }, async () => {
    const { app, db, fx, assignmentId } = await openApp(main);
    try {
      const ctx: StudentContext = { app, db, fx, cookie: '', records: [] };
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
      ctx.cookie = cookieFrom(login.headers['set-cookie']);
      await call(ctx, 'POST /auth/student/age-band', main, { payload: { ageBand: 'ge18' } });
      await call(ctx, 'POST /consents', main, { payload: { version: 'p0-v1', items: ALL_REQUIRED } });
      const started = await call(ctx, 'POST /student/assignments/{assignmentId}/attempt', main, { params: { assignmentId } });
      const attemptId = started.json.state.attemptId as string;
      const params = { attemptId };
      const secret = (await db.query<VaultRow>(`select problem_id, secret from vault.problem_secrets where problem_id = $1`, [main])).rows[0]?.secret as Secret;
      const route = secret.routes[0] as string[];
      const base = await storedState(db, attemptId);
      for (const missing of route) {
        await setState(db, attemptId, 'L3', {
          ...base,
          layer: 3,
          status: { 1: 'skip', 2: 'skip' },
          hint: { ...base.hint, matched: route.filter((id) => id !== missing) },
        });
        const finish = await call(ctx, 'POST /attempts/{attemptId}/finish', main, { params });
        expect(finish.status, `缺 ${missing}：${finish.body}`).toBe(200);
        expect(finish.json.state.currentLayer, `缺 ${missing}`).toBe('L3');
        const transfer = await call(ctx, 'POST /attempts/{attemptId}/transfer', main, { params });
        expect(transfer.status, `缺 ${missing}：${transfer.body}`).toBe(409);
      }
    } finally {
      await app.close();
      await fx.close();
    }
  });
});

// 迁移题不能被教师直接布置（#185/#186）：这是此前"没有父作答，父题 key 对学生是真正的未透露"那条泄露路径的根因。
// 根因已在布置入口消除，所以这里断言入口确实拒绝、没有留下任何作答入口；不再有可扫描的直布学生响应。
describe.each(PROBLEMS)('$transfer 不能被教师直接布置（#186）', ({ main, transfer }) => {
  let result: { status: number; body: Record<string, any>; assignments: number };
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { app, db, fx } = await openApp(main);
    close = async () => {
      await app.close();
      await fx.close();
    };
    const teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
    await db.query(`insert into app.devices (id, user_id) values ($1, $2)`, [DEVICE_B, teacherId]);
    const session = await createSession(db, { userId: teacherId, deviceId: DEVICE_B, ip: null, ttlMs: STUDENT_SESSION_MS });
    const teacher = { cookie: `${SESSION_COOKIE}=${app.signCookie(session.id)}`, ...WRITE_HEADERS };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: teacher,
      payload: { classId: fx.classId, problemId: transfer, version: 1, mode: 'practice', openAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    const assignments = (await db.query<{ n: string }>(`select count(*) as n from app.assignments where problem_id = $1`, [transfer])).rows[0]?.n;
    result = { status: created.statusCode, body: created.json(), assignments: Number(assignments) };
  }, 120_000);

  afterAll(async () => {
    await close();
  });

  it('POST /teacher/assignments 返回 422，且没有创建布置', () => {
    expect(result.status, JSON.stringify(result.body)).toBe(422);
    expect(String(result.body.error?.message)).toContain('迁移题不能直接布置');
    expect(result.assignments).toBe(0);
  });
});

// 软着陆（12 §7 第 5 项）：教师补发的 H4 会作为批注下发给学生。它是已透露的 key（和 H3/H4 同口径，只豁免所属的 K3），
// 其余 key 的片段仍然 0 命中。
describe('教师补发 H4（grantH4）后的学生响应', { timeout: 60_000 }, () => {
  it('只豁免被补发的 key；其余 key 0 命中，且补发的 H4 真的出现在响应里', async () => {
    const { app, db, fx, assignmentId } = await openApp('epsN');
    try {
      const ctx: StudentContext = { app, db, fx, cookie: '', records: [] };
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
      ctx.cookie = cookieFrom(login.headers['set-cookie']);
      await call(ctx, 'POST /auth/student/age-band', 'epsN', { payload: { ageBand: 'ge18' } });
      await call(ctx, 'POST /consents', 'epsN', { payload: { version: 'p0-v1', items: ALL_REQUIRED } });
      const started = await call(ctx, 'POST /student/assignments/{assignmentId}/attempt', 'epsN', { params: { assignmentId } });
      const attemptId = started.json.state.attemptId as string;

      const { ctx: engineCtx } = await loadProblem(db, 'epsN', 1);
      const runner = new Runner(engineCtx);
      for (const action of SCENARIOS.weak.slice(0, 25)) action(runner);
      expect(runner.state.hint.exhausted).toBe(true);
      await db.query(`update app.attempts set state = $2::jsonb, current_layer = 'L3', reveal = $3 where id = $1`, [
        attemptId,
        JSON.stringify(serializeState(runner.state)),
        runner.state.hint.reveal,
      ]);

      const teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
      await db.query(`insert into app.devices (id, user_id) values ($1, $2)`, [DEVICE_B, teacherId]);
      const session = await createSession(db, { userId: teacherId, deviceId: DEVICE_B, ip: null, ttlMs: STUDENT_SESSION_MS });
      const granted = await app.inject({
        method: 'POST',
        url: `/api/v1/teacher/attempts/${attemptId}/unlock`,
        headers: { cookie: `${SESSION_COOKIE}=${app.signCookie(session.id)}`, ...WRITE_HEADERS },
        payload: { grantH4: 'K3' },
      });
      expect(granted.statusCode, granted.body).toBe(200);

      const vault = (await db.query<VaultRow>(`select problem_id, secret from vault.problem_secrets`)).rows;
      const view = await call(ctx, 'GET /attempts/{attemptId}', 'epsN', { params: { attemptId }, extraExempt: ['K3'] });
      expect(view.json.state.notes).toEqual([expect.objectContaining({ kind: 'hint', level: 'H4' })]);
      expect(scan(ctx.records.slice(-1), vault)).toEqual([]);
      // 对照：不豁免 K3 时，补发的 H4 确实包含 K3 的片段（豁免是必要的，而不是扫描漏扫）
      const strict = ctx.records.slice(-1).map((r) => ({ ...r, exempt: {} }));
      expect(scan(strict, vault).some((hit) => hit.includes('epsN/K3'))).toBe(true);
    } finally {
      await app.close();
      await fx.close();
    }
  });
});

// 负面对照：真的把片段放进响应（改库里的内容，走真实路由），扫描必须报出来。否则上面的 0 命中说明不了什么。
describe('负面对照：扫描真的能报出泄露', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let db: Db;
  let fx: Fixture;
  let ctx: StudentContext;
  let attemptId: string;
  let vault: VaultRow[];

  const fragmentOf = (problemId: string): string =>
    vault.find((v) => v.problem_id === problemId)?.secret.keys.find((k) => k.leak.length > 0)?.leak[0] as string;
  const newRecords = (from: number): ScanRecord[] => ctx.records.slice(from);
  // 已发布内容有不可变触发器。投毒时临时关掉，用完恢复原值与触发器，只影响本文件自己的内存库。
  async function poisoned(table: string, set: () => Promise<unknown>, restore: () => Promise<unknown>, run: () => Promise<void>): Promise<void> {
    await db.query(`alter table ${table} disable trigger user`);
    await set();
    try {
      await run();
    } finally {
      await restore();
      await db.query(`alter table ${table} enable trigger user`);
    }
  }

  beforeAll(async () => {
    const opened = await openApp('epsN');
    ({ app, db, fx } = opened);
    ctx = { app, db, fx, cookie: '', records: [] };
    vault = (await db.query<VaultRow>(`select problem_id, secret from vault.problem_secrets`)).rows;
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
    ctx.cookie = cookieFrom(login.headers['set-cookie']);
    await call(ctx, 'POST /auth/student/age-band', 'epsN', { payload: { ageBand: 'ge18' } });
    await call(ctx, 'POST /consents', 'epsN', { payload: { version: 'p0-v1', items: ALL_REQUIRED } });
    const started = await call(ctx, 'POST /student/assignments/{assignmentId}/attempt', 'epsN', { params: { assignmentId: opened.assignmentId } });
    attemptId = started.json.state.attemptId as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await fx.close();
  });

  it('4 道题每个 key 的每个片段放进响应字符串都能命中', () => {
    const total = vault.flatMap((v) => v.secret.keys.flatMap((k) => k.leak.map((frag) => ({ id: v.problem_id, key: k.id, frag }))));
    expect(total.length).toBeGreaterThan(20);
    for (const { id, key, frag } of total) {
      const record = { op: 'control', owner: 'none', exempt: {}, status: 200, body: JSON.stringify({ a: { b: [`示例 ${frag}`] } }) };
      expect(scan([record], vault).some((hit) => hit.includes(`${id}/${key}`)), `${id}/${key} ${frag}`).toBe(true);
    }
  });

  it('键名里的片段也能命中', () => {
    const body = JSON.stringify({ [fragmentOf('series')]: 1 });
    expect(scan([{ op: 'control', owner: 'none', exempt: {}, status: 200, body }], vault).length).toBeGreaterThan(0);
  });

  it('豁免只在本题内：epsN 的 K1 已写出，不能豁免其它题的 K1', () => {
    const own = vault.find((v) => v.problem_id === 'epsN')?.secret.keys.find((k) => k.id === 'K1')?.leak[0] as string;
    const other = vault.find((v) => v.problem_id === 'series')?.secret.keys.find((k) => k.id === 'K1')?.leak[0] as string;
    const record = (frag: string): ScanRecord => ({ op: 'control', owner: 'epsN', exempt: { epsN: ['K1'] }, status: 200, body: JSON.stringify({ text: frag }) });
    expect(scan([record(own)], vault)).toEqual([]);
    expect(scan([record(other)], vault).length).toBeGreaterThan(0);
  });

  it('/student/home 与 /student/path：标题 / 题面被投毒时，真实路由的响应被报出', async () => {
    const original = (await db.query<{ public: object }>(`select public from content.problem_versions where problem_id = 'epsN'`)).rows[0]?.public;
    const from = ctx.records.length;
    await poisoned(
      'content.problem_versions',
      () =>
        db.query(
          `update content.problem_versions
              set public = jsonb_set(jsonb_set(public, '{stem}', to_jsonb($1::text)), '{title}', to_jsonb($2::text))
            where problem_id = 'epsN'`,
          [`题面 ${fragmentOf('epsN')}`, `标题 ${fragmentOf('epsN')}`],
        ),
      () => db.query(`update content.problem_versions set public = $1::jsonb where problem_id = 'epsN'`, [JSON.stringify(original)]),
      async () => {
        await call(ctx, 'GET /student/home', 'epsN');
        await call(ctx, 'GET /student/path', 'epsN');
      },
    );
    const hits = scan(newRecords(from), vault);
    expect(hits.some((hit) => hit.includes('$.inProgress[0].title'))).toBe(true);
    expect(hits.some((hit) => hit.includes('stemPreview'))).toBe(true);
  });

  it('/me：显示名被投毒时，真实路由的响应被报出', async () => {
    await db.query(`update app.users set display_name = $1 where role = 'student'`, [fragmentOf('series')]);
    const from = ctx.records.length;
    await call(ctx, 'GET /me', 'epsN');
    await db.query(`update app.users set display_name = null where role = 'student'`);
    expect(scan(newRecords(from), vault).some((hit) => hit.includes('$.displayName'))).toBe(true);
  });

  it('/events/batch：响应里回显的事件 id 也在扫描范围内', async () => {
    const from = ctx.records.length;
    await call(ctx, 'POST /events/batch', 'epsN', { payload: { events: [{ id: fragmentOf('epsN'), type: 'no.such.type' }] } });
    expect(scan(newRecords(from), vault).some((hit) => hit.includes('$.rejected[0].id'))).toBe(true);
  });

  // #141 的两条路径有自己的闸门，投毒不会泄出去：这里验证闸门确实接住了，而不是扫描漏掉了。
  // #141 的两条路径有自己的闸门，投毒不会泄出去：这里验证闸门确实接住了，而不是扫描漏掉了。
  it('#141 概念：词条被投毒时闸门接住，学生只看到回退文案，扫描 0 命中', async () => {
    const params = { attemptId };
    const original = (await db.query<{ body: Record<string, any> }>(`select body from content.concepts where id = 'seq-limit'`)).rows[0]?.body as Record<string, any>;
    const bad = { ...original, card: { ...original.card, plain: `示例 ${fragmentOf('epsN')}` } };
    const from = ctx.records.length;
    let text = '';
    await poisoned(
      'content.concepts',
      () => db.query(`update content.concepts set body = $1::jsonb where id = 'seq-limit'`, [JSON.stringify(bad)]),
      () => db.query(`update content.concepts set body = $1::jsonb where id = 'seq-limit'`, [JSON.stringify(original)]),
      async () => {
        text = (await call(ctx, 'POST /attempts/{attemptId}/help', 'epsN', { params, payload: { intent: 'concept' } })).json.note.text;
      },
    );
    expect(text).toContain('我先不说这一点');
    expect(scan(newRecords(from), vault)).toEqual([]);
  });

  it('#141 行批注：错误追问被投毒时闸门接住，学生看不到片段，扫描 0 命中', async () => {
    const params = { attemptId };
    const original = vault.find((v) => v.problem_id === 'epsN')?.secret as Secret;
    const error = original.errors[0] as Secret['errors'][number];
    const lineId = await insertLine(db, attemptId, { cls: 'error', errorId: error.id, justification: '由定义' });
    const bad = { ...original, errors: original.errors.map((e) => (e.id === error.id ? { ...e, question: `追问 ${fragmentOf('epsN')}` } : e)) };
    const from = ctx.records.length;
    let text = '';
    await poisoned(
      'vault.problem_secrets',
      () => db.query(`update vault.problem_secrets set secret = $1::jsonb where problem_id = 'epsN'`, [JSON.stringify(bad)]),
      () => db.query(`update vault.problem_secrets set secret = $1::jsonb where problem_id = 'epsN'`, [JSON.stringify(original)]),
      async () => {
        text = (await call(ctx, 'POST /attempts/{attemptId}/help', 'epsN', { params, payload: { intent: 'check_line', lineId } })).json.note.text;
      },
    );
    expect(text).not.toContain(fragmentOf('epsN'));
    expect(scan(newRecords(from), vault)).toEqual([]);
  });
});
