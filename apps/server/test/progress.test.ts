import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';
import { buildAttemptsCsv } from '../src/export/attempts-csv.ts';
import { setStudentAgeBand } from './support/fixtures.ts';
import { backfillProgress } from '../src/progress/backfill.ts';
import { buildProgress } from '../src/progress/service.ts';

import {
  ALL_REQUIRED,
  forceComplete,
  get,
  input,
  leaks,
  login,
  makeEnv,
  openAssignment,
  patch,
  post,
  startAttempt,
  type Env,
} from './support/flow.ts';

const contract = loadContract();
let env: Env;
beforeEach(async () => {
  env = await makeEnv();
});
afterEach(async () => {
  await env.close();
});

const K1_LINE = { statement: '|a_n-3|=5/(n+2)', justification: '通分化简得到这一步', input };

async function userIdOf(): Promise<string> {
  return (await env.db.query<{ id: string }>(`select id from app.users where role = 'student'`)).rows[0]?.id as string;
}
const ledger = async () =>
  (await env.db.query<{ source_key: string; kind: string; amount: number }>(`select source_key, kind, amount from app.xp_ledger order by id`)).rows;

async function toL3(cookie: string, id: string): Promise<void> {
  await post(env, cookie, `/attempts/${id}/layers/L1/skip`);
  await post(env, cookie, `/attempts/${id}/layers/L2/skip`);
}

describe('作答响应的 rewards 与台账', () => {
  it('独立写出关键步骤 +10、今天第一次 +5，徽章第一步/独立写出；响应带 rewards，库里有台账', async () => {
    const cookie = await login(env);
    const id = await startAttempt(env, cookie, await openAssignment(env));
    await toL3(cookie, id);
    const res = await post(env, cookie, `/attempts/${id}/lines`, K1_LINE);
    expect(res.statusCode, res.body).toBe(200);
    const { rewards } = res.json();
    expect(rewards.xp).toBe(15);
    expect(rewards.items.map((i: { kind: string; amount: number }) => [i.kind, i.amount])).toEqual([
      ['key_own', 10],
      ['daily', 5],
    ]);
    expect(rewards.badges.map((b: { id: string }) => b.id)).toEqual(['first_step', 'own_write']);
    expect(rewards.streak).toEqual({ current: 1, extended: true });
    contract.validate('Rewards', rewards);
    expect((await ledger()).map((r) => r.source_key)).toEqual(['key:epsN:K1', expect.stringMatching(/^daily:\d{4}-\d{2}-\d{2}$/)]);
  });

  it('没有新进展的提交不带 rewards；同一 Idempotency-Key 重放返回首次响应且不重复入账', async () => {
    const cookie = await login(env);
    const id = await startAttempt(env, cookie, await openAssignment(env));
    await toL3(cookie, id);
    const key = randomUUID();
    const first = await post(env, cookie, `/attempts/${id}/lines`, K1_LINE, { 'idempotency-key': key });
    const replay = await post(env, cookie, `/attempts/${id}/lines`, K1_LINE, { 'idempotency-key': key });
    expect(replay.json().rewards).toEqual(first.json().rewards);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    // 同一步骤再写一遍（新请求）：不再得分
    const again = await post(env, cookie, `/attempts/${id}/lines`, K1_LINE);
    expect(again.statusCode).toBe(200);
    expect(again.json().rewards).toBeUndefined();
    expect(await ledger()).toHaveLength(2);
  });

  it('重做不重复发经验：同一题同一步骤的来源键已存在；重做完成发「重做成功」', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);
    await toL3(cookie, id);
    await post(env, cookie, `/attempts/${id}/lines`, K1_LINE);
    await forceComplete(env, id, (st) => ({ ...st, status: { 1: 'skip', 2: 'skip', 3: 'done', 4: 'skip', 5: 'skip', 6: 'done' } }));
    // 回填 CLI 的核心：补上主作答完成的层与整题经验；重复运行不重复入账
    const filled = await backfillProgress(env.db);
    expect(filled.xpRows).toBeGreaterThan(0);
    expect(await backfillProgress(env.db)).toMatchObject({ xpRows: 0, badges: 0 });
    const before = await ledger();
    expect(before.map((r) => r.source_key)).toEqual(
      expect.arrayContaining(['key:epsN:K1', 'layer:epsN:L3', 'layer:epsN:L6', 'done:epsN']),
    );

    const redoId = (await post(env, cookie, `/student/attempts/${id}/redo`)).json().state.attemptId as string;
    await toL3(cookie, redoId);
    const res = await post(env, cookie, `/attempts/${redoId}/lines`, K1_LINE);
    expect(res.statusCode).toBe(200);
    expect(res.json().rewards).toBeUndefined();
    expect(await ledger()).toEqual(before);

    // 把重做推到最后一步并完成
    await env.db.query(
      `update app.attempts set state = state || '{"layer":6,"status":{"1":"skip","2":"skip","3":"done","4":"done","5":"disabled"},"summary":{"asked":true}}'::jsonb,
              current_layer = 'L6' where id = $1`,
      [redoId],
    );
    const done = await post(env, cookie, `/attempts/${redoId}/summary`, {
      answers: ['这是第一问的答案', '这是第二问的答案', '这是第三问的答案', '这是第四问的答案', '这是第五问的答案'],
      input,
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().state.status).toBe('completed');
    expect(done.json().rewards.xp).toBe(0); // 经验都已发过
    expect(done.json().rewards.badges.map((b: { id: string }) => b.id)).toContain('redo_success');
    expect(await ledger()).toEqual(before);
  });

  it('测验：进行中不发（响应没有 rewards、台账为空）；完成时一次结算入账，响应仍不显示', async () => {
    const cookie = await login(env);
    const id = await startAttempt(env, cookie, await openAssignment(env, 'epsN', { mode: 'test' }));
    await toL3(cookie, id);
    const line = await post(env, cookie, `/attempts/${id}/lines`, K1_LINE);
    expect(line.json().rewards).toBeUndefined();
    expect(await ledger()).toEqual([]);

    await env.db.query(
      `update app.attempts set state = state || '{"layer":6,"status":{"1":"skip","2":"skip","3":"done","4":"skip","5":"skip"},"summary":{"asked":true}}'::jsonb,
              current_layer = 'L6' where id = $1`,
      [id],
    );
    const done = await post(env, cookie, `/attempts/${id}/summary`, {
      answers: ['这是第一问的答案', '这是第二问的答案', '这是第三问的答案', '这是第四问的答案', '这是第五问的答案'],
      input,
    });
    expect(done.json().state.status).toBe('completed');
    expect(done.json().rewards).toBeUndefined();
    const kinds = (await ledger()).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['key_own', 'layer', 'problem', 'daily']));
  });
});

describe('GET /student/progress', () => {
  it('未登录 401；新学生全是 0，徽章目录完整且未获得', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/student/progress' })).statusCode).toBe(401);
    const cookie = await login(env);
    const body = (await get(env, cookie, '/student/progress')).json();
    expect(body).toMatchObject({ xpTotal: 0, xpToday: 0, keysToday: 0, dailyGoal: 3, daysLearned: 0 });
    expect(body.streak).toEqual({ current: 0, best: 0, freezeAvailable: true, usedFreezeDays: [] });
    expect(body.week).toHaveLength(7);
    expect(body.badges).toHaveLength(10);
    expect(body.badges.every((b: { earnedAt: unknown }) => b.earnedAt === null)).toBe(true);
  });

  it('经验、今日关键步骤、连胜、徽章来自台账', async () => {
    const cookie = await login(env);
    const id = await startAttempt(env, cookie, await openAssignment(env));
    await toL3(cookie, id);
    await post(env, cookie, `/attempts/${id}/lines`, K1_LINE);
    env.seen = []; // 作答响应里有学生自己写的行，不在泄露扫描范围；进度与设置响应要扫
    const body = (await get(env, cookie, '/student/progress')).json();
    await get(env, cookie, '/student/settings');
    expect(await leaks(env)).toEqual([]);
    expect(body).toMatchObject({ xpTotal: 15, xpToday: 15, keysToday: 1, daysLearned: 1 });
    expect(body.streak).toMatchObject({ current: 1, best: 1 });
    expect(body.badges.filter((b: { earnedAt: string | null }) => b.earnedAt).map((b: { id: string }) => b.id).sort()).toEqual(['first_step', 'own_write']);
    expect(body.badges.find((b: { id: string }) => b.id === 'streak_3').progress).toEqual({ current: 1, target: 3 });
  });

  it('上海午夜边界：UTC 15:59 与 16:00 记入不同的自然日，连胜按日算', async () => {
    await login(env);
    const userId = await userIdOf();
    const row = (day: string, key: string) =>
      env.db.query(`insert into app.xp_ledger (user_id, source_key, kind, amount, day) values ($1, $2, 'key_own', 10, $3::date)`, [userId, key, day]);
    await row('2026-11-05', 'k:a');
    await row('2026-11-06', 'k:b');
    const before = await buildProgress(env.db, contract, userId, Date.parse('2026-11-05T15:59:00Z')); // 上海 11-05 23:59
    const after = await buildProgress(env.db, contract, userId, Date.parse('2026-11-05T16:00:00Z')); // 上海 11-06 00:00
    expect(before.xpToday).toBe(10);
    expect(after.xpToday).toBe(10);
    expect((before.streak as { current: number }).current).toBe(1); // 11-06 的记录还在「明天」，不计
    expect((after.streak as { current: number }).current).toBe(2);
    const later = await buildProgress(env.db, contract, userId, Date.parse('2026-11-06T16:00:00Z')); // 上海 11-07：昨天有记录，今天还没练
    expect((later.streak as { current: number }).current).toBe(2);
    const gap = await buildProgress(env.db, contract, userId, Date.parse('2026-11-08T16:00:00Z')); // 上海 11-09：漏了 11-07、11-08
    expect((gap.streak as { current: number }).current).toBe(0);
  });
});

describe('设置、昵称与反馈', () => {
  it('未签同意书：设置/反馈 403 CONSENT_REQUIRED（已选年龄段）；签署后读到默认值', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: { 'x-requested-with': 'proof-gym' }, payload: { inviteCode: 'K7Q2MX', studentNo: '2026001', deviceId: '6f1b2c4e-8d3a-4b7e-9c10-2a5d7e8f9a01' } });
    const cookie = String(res.headers['set-cookie']).split(';')[0] as string;
    await setStudentAgeBand(env.app, cookie);
    for (const denied of [
      await get(env, cookie, '/student/settings'),
      await patch(env, cookie, '/student/settings', { theme: 'dark' }),
      await post(env, cookie, '/student/feedback', { kind: 'bug', body: 'x' }),
    ]) {
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('CONSENT_REQUIRED');
    }
    const signed = await login(env);
    const settings = (await get(env, signed, '/student/settings')).json();
    expect(settings).toEqual({
      nickname: null,
      dailyGoal: 3,
      defaultInput: 'hand',
      theme: 'system',
      sound: true,
      motion: true,
      haptics: true,
      onboarding: {},
    });
  });

  it('PATCH：只改传入的字段；昵称 trim 后 1–16 字并写入 /me 的 displayName；非法值 422', async () => {
    const cookie = await login(env);
    const ok = await patch(env, cookie, '/student/settings', { nickname: '  小明  ', theme: 'dark', dailyGoal: 5, onboarding: { seen: ['home'] } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ nickname: '小明', theme: 'dark', dailyGoal: 5, sound: true, onboarding: { seen: ['home'] } });
    expect((await get(env, cookie, '/me')).json().displayName).toBe('小明');
    const only = await patch(env, cookie, '/student/settings', { sound: false });
    expect(only.json()).toMatchObject({ nickname: '小明', theme: 'dark', sound: false });

    for (const bad of [{ nickname: '   ' }, { nickname: '一二三四五六七八九十一二三四五六七' }, { theme: 'pink' }, { dailyGoal: 0 }, { unknown: 1 }]) {
      expect((await patch(env, cookie, '/student/settings', bad)).statusCode, JSON.stringify(bad)).toBe(422);
    }
  });

  it('反馈：204 并落库；空内容 422', async () => {
    const cookie = await login(env);
    expect((await post(env, cookie, '/student/feedback', { kind: 'bug', body: '键盘打不出分数线', page: '/pages/practice/index' })).statusCode).toBe(204);
    expect((await post(env, cookie, '/student/feedback', { kind: 'bug', body: '   ' })).statusCode).toBe(422);
    const rows = await env.db.query<{ kind: string; body: string; page: string }>(`select kind, body, page from app.student_feedback`);
    expect(rows.rows).toEqual([{ kind: 'bug', body: '键盘打不出分数线', page: '/pages/practice/index' }]);
  });
});

describe('撤回教研同意：导出过滤', () => {
  it('曾同意 research、之后撤回的学生不进导出；重新同意后回来；重做作答从不进导出', async () => {
    const cookie = await login(env, undefined, { research: true });
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);
    await forceComplete(env, id);
    const exported = async () => (await buildAttemptsCsv(env.db, env.fx.classId)).trim().split('\n').length - 1;
    expect(await exported()).toBe(1);

    // 撤回：重新提交同意书，research=false
    const withdraw = await post(env, cookie, '/consents', { version: 'p0-v1', items: { ...ALL_REQUIRED, research: false } });
    expect(withdraw.statusCode).toBe(200);
    expect(await exported()).toBe(0);

    const again = await post(env, cookie, '/consents', { version: 'p0-v1', items: { ...ALL_REQUIRED, research: true } });
    expect(again.statusCode).toBe(200);
    expect(await exported()).toBe(1);

    await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(await exported()).toBe(1);
  });
});
