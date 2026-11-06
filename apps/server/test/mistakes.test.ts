import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';
import { errorGroupOf } from '../src/attempts/notebook.ts';

import { addStudent, forceComplete, get, insertLine, leaks, login, makeEnv, openAssignment, startAttempt, type Env } from './support/flow.ts';

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

describe('错因分组映射', () => {
  it.each([
    ['N 依赖 n', 'scaling'],
    ['不等号方向', 'scaling'],
    ['单调方向写反', 'scaling'],
    ['认为交错判别法不适用', 'basis'],
    ['引用定理时漏了条件', 'basis'],
    ['分子算错', 'other'],
    ['', 'other'],
  ])('%s -> %s', (label, group) => {
    expect(errorGroupOf(label)).toBe(group);
  });
});

describe('GET /student/mistakes', () => {
  it('没有作答：空；未登录 401', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/v1/student/mistakes' })).statusCode).toBe(401);
    const cookie = await login(env);
    expect((await get(env, cookie, '/student/mistakes')).json()).toEqual({ groups: [], total: 0 });
  });

  it('按卡点分组，空分组不出现，每项有重做所需的 attemptId', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await startAttempt(env, cookie, asg);
    // 行归类为 E1（N 依赖 n）、E3（不等号方向）；K1 靠 H2 以上提示才写出；自检 SC1 失败后没再通过；定义提交过但没通过
    await insertLine(env, id, { idx: 1, statement: 'N=n+1', cls: 'error', errorId: 'E1' });
    await insertLine(env, id, { idx: 2, statement: '所以式子>ε', cls: 'error', errorId: 'E3' });
    await insertLine(env, id, { idx: 3, statement: '写出第一步ZQX', cls: 'match', newKeys: ['K1'] });
    await insertLine(env, id, { layer: 'L4', role: 'selfcheck', slot: 'SC1', statement: '没答到点ZQX', cls: 'fail' });
    await insertLine(env, id, { layer: 'L1', role: 'def', idx: 1, statement: '我的定义ZQX' });
    await env.db.query(
      `insert into ev.events (id, seq, type, source, user_anon, role, attempt_id, payload)
       values (gen_random_uuid(), 900, 'def.submit', 'server', 'S-X', 'student', $1, $2::jsonb)`,
      [id, JSON.stringify({ components: { forall_eps: true, exists_N: false, n_gt_N: true, abs_lt: true }, orderOk: true, pass: false })],
    );
    await forceComplete(env, id, (s) => ({
      ...s,
      def: { ...s.def, attempts: 1, passed: false },
      hint: { ...s.hint, matched: ['K1'], keyCost: { K1: 0.5 } },
    }));

    const res = await get(env, cookie, '/student/mistakes');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    contract.validate('Mistakes', body);
    expect(body.groups.map((g: { group: string }) => g.group)).toEqual(['definition', 'scaling', 'hinted', 'selfcheck']);
    expect(body.total).toBe(5);
    const scaling = body.groups.find((g: { group: string }) => g.group === 'scaling');
    expect(scaling.count).toBe(2);
    expect(scaling.items[0]).toMatchObject({ attemptId: id, problemTitle: '数列极限 · ε-N', canRedo: true });
    expect(scaling.items.map((i: { lineExcerpt: string }) => i.lineExcerpt).sort()).toEqual(['N=n+1', '所以式子>ε']);
    const def = body.groups.find((g: { group: string }) => g.group === 'definition').items[0];
    expect(def.note).toContain('存在');
    expect(body.groups.find((g: { group: string }) => g.group === 'hinted').items[0].lineExcerpt).toBe('写出第一步ZQX');
  });

  it('测验布置结束前不出现，结束后出现；他人的错题不可见', async () => {
    const cookie = await login(env);
    const other = await addStudent(env, '2026002');
    const asg = await openAssignment(env, 'epsN', { mode: 'test' });
    const id = await startAttempt(env, cookie, asg);
    await insertLine(env, id, { statement: 'N=n+1', cls: 'error', errorId: 'E1' });
    await forceComplete(env, id);
    expect((await get(env, cookie, '/student/mistakes')).json().total).toBe(0);
    await env.db.query(`update app.assignments set status = 'closed' where id = $1`, [asg]);
    expect((await get(env, cookie, '/student/mistakes')).json().total).toBe(1);
    expect((await get(env, other, '/student/mistakes')).json().total).toBe(0);
  });

  it('最新在前', async () => {
    const cookie = await login(env);
    const a1 = await openAssignment(env, 'epsN');
    const a2 = await openAssignment(env, 'series');
    const id1 = await startAttempt(env, cookie, a1);
    const id2 = await startAttempt(env, cookie, a2);
    await insertLine(env, id1, { statement: '甲', cls: 'error', errorId: 'E1' });
    await insertLine(env, id2, { statement: '乙', cls: 'error', errorId: 'E1' });
    await env.db.query(`update app.attempt_lines set created_at = now() - interval '2 days' where attempt_id = $1`, [id1]);
    await forceComplete(env, id1);
    await forceComplete(env, id2);
    const items = (await get(env, cookie, '/student/mistakes')).json().groups.flatMap((g: { items: unknown[] }) => g.items);
    expect(items.map((i: { lineExcerpt: string }) => i.lineExcerpt)).toEqual(['乙', '甲']);
  });
});
