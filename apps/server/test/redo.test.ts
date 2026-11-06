import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadContract } from '../src/contract.ts';
import { computeAttemptMetrics } from '../src/metrics/attempt.ts';
import { refreshStaleMetrics } from '../src/metrics/refresh.ts';

import {
  addStudent,
  forceComplete,
  get,
  input,
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

async function completedMain(cookie: string, asg: string): Promise<string> {
  const id = await startAttempt(env, cookie, asg);
  await insertLine(env, id, { statement: 'N=n+1', cls: 'error', errorId: 'E1' });
  await forceComplete(env, id);
  return id;
}

describe('POST /student/attempts/{id}/redo', () => {
  it('在已完成的作答上新建 redo：练习模式、同布置同版本、引擎从头开始、第 5 层关闭；再次调用返回同一个', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await completedMain(cookie, asg);

    const res = await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(res.statusCode, res.body).toBe(200);
    const state = res.json().state;
    contract.validate('AttemptState', state);
    expect(state).toMatchObject({ kind: 'redo', parentAttemptId: id, mode: 'practice', status: 'active', currentLayer: 'L1' });
    expect(state.layers[4]).toMatchObject({ layer: 'L5', status: 'disabled' });
    expect(state.transfer).toBeUndefined();
    expect(state.steps.lines).toEqual([]);

    const row = (await env.db.query<{ assignment_id: string; problem_version: number; mode: string }>(
      `select assignment_id, problem_version, mode from app.attempts where id = $1`, [state.attemptId])).rows[0];
    expect(row).toMatchObject({ assignment_id: asg, mode: 'practice' });

    const again = await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(again.json().state.attemptId).toBe(state.attemptId);
    const count = await env.db.query(`select 1 from app.attempts where kind = 'redo'`);
    expect(count.rows).toHaveLength(1);

    // 可通过正常的 GET /attempts/{id} 读取
    expect((await get(env, cookie, `/attempts/${state.attemptId}`)).json().state.kind).toBe('redo');
  });

  it('重做时第 4 层完成后直接进入第 6 层（第 5 层不是死路）', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await completedMain(cookie, asg);
    const redoId = (await post(env, cookie, `/student/attempts/${id}/redo`)).json().state.attemptId as string;
    await env.db.query(
      `update app.attempts set state = jsonb_set(jsonb_set(jsonb_set(state, '{layer}', '4'), '{selfcheck}', '{"items":["SC1"],"passed":{}}'::jsonb),
         '{lines}', '3'), current_layer = 'L4' where id = $1`, [redoId]);
    const sc = await post(env, cookie, `/attempts/${redoId}/selfcheck/SC1`, { text: '第1行和第2行', input });
    expect(sc.statusCode, sc.body).toBe(200);
    expect(sc.json().state.currentLayer).toBe('L6');
    // 迁移接口对重做没有出路
    expect((await post(env, cookie, `/attempts/${redoId}/transfer`)).statusCode).toBe(409);
  });

  it('未完成 409；不存在 404；他人的作答 403', async () => {
    const cookie = await login(env);
    const other = await addStudent(env, '2026002');
    const asg = await openAssignment(env);
    const active = await startAttempt(env, cookie, asg);
    expect((await post(env, cookie, `/student/attempts/${active}/redo`)).statusCode).toBe(409);
    expect((await post(env, cookie, `/student/attempts/00000000-0000-4000-8000-00000000ffff/redo`)).statusCode).toBe(404);
    await forceComplete(env, active);
    expect((await post(env, other, `/student/attempts/${active}/redo`)).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: `/api/v1/student/attempts/${active}/redo`, headers: { 'x-requested-with': 'proof-gym' } })).statusCode).toBe(401);
  });

  it('测验：开放期间 403，结束后可重做（并变为练习模式）', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env, 'epsN', { mode: 'test' });
    const id = await completedMain(cookie, asg);
    const denied = await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('TEST_MODE_RESTRICTED');
    await env.db.query(`update app.assignments set status = 'closed' where id = $1`, [asg]);
    const ok = await post(env, cookie, `/student/attempts/${id}/redo`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state).toMatchObject({ kind: 'redo', mode: 'practice' });
  });

  it('布置已关闭：重做仍可写入（绕过关闭拦截），主作答依旧只读', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await completedMain(cookie, asg);
    await env.db.query(`update app.assignments set status = 'closed' where id = $1`, [asg]);
    const redoId = (await post(env, cookie, `/student/attempts/${id}/redo`)).json().state.attemptId as string;
    expect((await post(env, cookie, `/attempts/${redoId}/layers/L1/skip`)).statusCode).toBe(200);
    // 主作答已完成且布置关闭：写入被拒
    expect((await post(env, cookie, `/attempts/${id}/layers/L1/skip`)).statusCode).toBe(409);
    // 布置关闭后不能再开始新的主作答
    const another = await addStudent(env, '2026003');
    expect((await post(env, another, `/student/assignments/${asg}/attempt`)).statusCode).toBe(409);
  });

  it('不影响主作答的统计：指标、首页、导出、进度来源都只算 kind=main', async () => {
    const cookie = await login(env);
    const asg = await openAssignment(env);
    const id = await completedMain(cookie, asg);
    const redoId = (await post(env, cookie, `/student/attempts/${id}/redo`)).json().state.attemptId as string;

    // 1. 教师班级指标（kind='main' 过滤）
    const teacher = await env.db.query<{ n: string }>(
      `select count(*)::text as n from app.attempts a join app.assignments g on g.id = a.assignment_id where g.class_id = $1 and a.kind = 'main'`,
      [env.fx.classId],
    );
    expect(teacher.rows[0]?.n).toBe('1');

    // 2. attempt_metrics 不为重做计算
    await refreshStaleMetrics(env.db);
    const metricRows = (await env.db.query<{ attempt_id: string }>(`select attempt_id from app.attempt_metrics`)).rows.map((r) => r.attempt_id);
    expect(metricRows).toContain(id);
    expect(metricRows).not.toContain(redoId);
    // 重做不会让主作答的指标变化
    const m = await computeAttemptMetrics(env.db, id);
    expect(m).toBeDefined();

    // 3. 导出里没有重做作答及其事件
    const { exportableAttemptSql } = await import('../src/export/attempts-csv.ts');
    const exported = (await env.db.query<{ id: string }>(`select t.id from app.attempts t where ${exportableAttemptSql('t')}`)).rows.map((r) => r.id);
    expect(exported).toEqual([id]);
  });
});
