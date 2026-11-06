import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';
import { excerpt } from '../src/attempts/notebook.ts';

import {
  addStudent,
  forceComplete,
  get,
  insertLine,
  leaks,
  login,
  makeEnv,
  openAssignment,
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
  try {
    expect(await leaks(env)).toEqual([]);
  } finally {
    await env.close();
  }
});

describe('GET /student/notebook', () => {
  it('未登录 401；没有作答时是空证明本', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/student/notebook' })).statusCode).toBe(401);
    const cookie = await login(env);
    const res = await get(env, cookie, '/student/notebook');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: [], toRedo: [] });
  });

  it('只返回本人已完成的作答：行、总结、标准定义（通过核验才有）、讲评（发布后才有）', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);
    await insertLine(env, id, { idx: 1, statement: '学生第一行ZQX', justification: '依据甲乙丙丁戊己', cls: 'unknown' });
    await insertLine(env, id, { layer: 'L6', role: 'summary', idx: 1, slot: '1', statement: '总结的第一问答案ZQX' });

    // 进行中的作答不出现
    expect((await get(env, cookie, '/student/notebook')).json().cards).toEqual([]);

    await forceComplete(env, id, (s) => ({ ...s, def: { ...s.def, passed: false, attempts: 0 } }));
    const first = (await get(env, cookie, '/student/notebook')).json();
    contract.validate('Notebook', first);
    expect(first.cards).toHaveLength(1);
    expect(first.cards[0]).toMatchObject({
      attemptId: id,
      kind: 'main',
      title: '数列极限 · ε-N',
      proof: ['学生第一行ZQX'],
      lines: [{ n: 1, statement: '学生第一行ZQX', justification: '依据甲乙丙丁戊己' }],
      summary: ['总结的第一问答案ZQX'],
      reviewPublished: false,
      canRedo: true,
    });
    expect(first.cards[0].definition).toBeUndefined();
    expect(first.cards[0].teacherNote).toBeUndefined();

    // 通过第 1 层核验后给标准定义；讲评发布后给教师讲评
    await forceComplete(env, id, (s) => ({ ...s, def: { ...s.def, passed: true, attempts: 1 } }));
    await env.db.query(`update app.assignments set review_published_at = now(), review_note = '老师讲评ZQX' where id = $1`, [asg]);
    const second = (await get(env, cookie, '/student/notebook')).json();
    expect(second.cards[0].definition).toContain('\\forall\\varepsilon>0');
    expect(second.cards[0]).toMatchObject({ teacherNote: '老师讲评ZQX', reviewPublished: true });
  });

  it('不含他人的作答；不含任何保密内容（泄露扫描在 afterEach）', async () => {
    const mine = await login(env);
    const other = await addStudent(env, '2026002');
    const asg = await openAssignment(env);
    const otherId = await startAttempt(env, other, asg);
    await insertLine(env, otherId, { statement: '别人的行QQQ' });
    await forceComplete(env, otherId);
    const myId = await startAttempt(env, mine, asg);
    await forceComplete(env, myId);
    const cards = (await get(env, mine, '/student/notebook')).json().cards;
    expect(cards.map((c: { attemptId: string }) => c.attemptId)).toEqual([myId]);
    expect(JSON.stringify(cards)).not.toContain('QQQ');
  });

  it('测验布置未结束：作答卡片 canRedo=false，也不进待重做', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env, 'epsN', { mode: 'test' });
    const id = await startAttempt(env, cookie, asg);
    await insertLine(env, id, { statement: 'N=n+1', cls: 'error', errorId: 'E1' });
    await forceComplete(env, id);
    const nb = (await get(env, cookie, '/student/notebook')).json();
    expect(nb.cards[0].canRedo).toBe(false);
    expect(nb.toRedo).toEqual([]);
    await env.db.query(`update app.assignments set status = 'closed' where id = $1`, [asg]);
    const after = (await get(env, cookie, '/student/notebook')).json();
    expect(after.cards[0].canRedo).toBe(true);
    expect(after.toRedo.map((c: { attemptId: string }) => c.attemptId)).toEqual([id]);
  });
});

describe('GET /attempts/{id}/review', () => {
  it('未发布 403；发布后写完才能看，读参考证明记审计；他人的作答 404', async () => {
    const cookie = await login(env);
    const other = await addStudent(env, '2026002');
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);

    expect((await get(env, cookie, `/attempts/${id}/review`)).statusCode).toBe(403);
    await env.db.query(`update app.assignments set review_published_at = now(), review_note = '讲评ZQX' where id = $1`, [asg]);
    expect((await get(env, cookie, `/attempts/${id}/review`)).statusCode).toBe(403); // 还没写完且布置未结束
    expect((await get(env, other, `/attempts/${id}/review`)).statusCode).toBe(404);

    await forceComplete(env, id);
    const res = await get(env, cookie, `/attempts/${id}/review`);
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toBe('讲评ZQX');
    expect(res.json().proofs.length).toBeGreaterThan(0);
    const log = await env.db.query(`select purpose from vault.reference_access_log where purpose = 'review'`);
    expect(log.rows).toHaveLength(1);
    // 参考证明是教师发布的内容，本就含解题片段：这个响应不做泄露扫描
    env.seen.pop();
  });
});

describe('GET /student/home 的 week 与 notebook', () => {
  it('只统计 kind=main；重做不改变首页计数', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);
    await insertLine(env, id, { statement: 'N=n+1', cls: 'error', errorId: 'E1' });
    await forceComplete(env, id);
    await env.db.query(`update app.attempts set keys_own = 3 where id = $1`, [id]);
    const before = (await get(env, cookie, '/student/home')).json();
    expect(before.week).toEqual({ keysOwn: 3, keysTotal: 4, problemsDone: 1 });
    expect(before.notebook).toEqual({ cards: 1, toRedo: 1 });
    expect(before.done).toHaveLength(1);

    const redo = await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(redo.statusCode).toBe(200);
    const after = (await get(env, cookie, '/student/home')).json();
    expect(after.week).toEqual(before.week);
    expect(after.done).toHaveLength(1);
    expect(after.inProgress).toHaveLength(0);
    expect(after.done[0].attemptId).toBe(id);
  });
});

describe('excerpt', () => {
  it('不把公式从中间截开', () => {
    const text = `${'字'.repeat(118)}$a_n=\\frac{3n+1}{n+2}$结尾`;
    const cut = excerpt(text, 120);
    expect((cut.match(/\$/g) ?? []).length % 2).toBe(0);
    expect(cut.endsWith('…')).toBe(true);
    expect(excerpt('短', 120)).toBe('短');
  });
});
