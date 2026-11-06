import { serializeState } from '@proof-gym/engine';
import { afterEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { loadContract } from '../src/contract.ts';
import { Runner } from '../../../packages/engine/test/support/runner.ts';
import { DEF_OK, FRAME_TEXT, K1, K2, K3, K4, SCENARIOS, SUMMARY_MISSING_POINT } from '../../../packages/engine/test/support/scenarios.ts';

import { WRITE_HEADERS } from './support/fixtures.ts';
import { startHelpHarness, type HelpHarness } from './support/help.ts';

const contract = loadContract();
const INPUT = { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000d1' };
let h: HelpHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const post = (harness: HelpHarness, path: string, payload?: unknown) =>
  harness.app.inject({ method: 'POST', url: `/api/v1/attempts/${harness.attemptId}${path}`, headers: { cookie: harness.cookie, ...WRITE_HEADERS }, ...(payload === undefined ? {} : { payload: payload as object }) });
const view = async (harness: HelpHarness) => {
  const res = await harness.app.inject({ method: 'GET', url: `/api/v1/attempts/${harness.attemptId}`, headers: { cookie: harness.cookie } });
  expect(res.statusCode, res.body).toBe(200);
  contract.validate('AttemptState', res.json().state);
  return res.json().state as Record<string, any>;
};

// 契约里的 StepsView / DefView / FrameView / TransferView / SummaryView：学生写下的内容要能从 AttemptState 读回来。
describe('AttemptState 的作答内容视图', () => {
  it('第 1–2 层：任务文案；提交后 last 回显；骨架模板展示后 templateShown / template 出现', async () => {
    h = await startHelpHarness('epsN');
    let state = await view(h);
    expect(state.def.task).toContain('定义');
    expect(state.def.last).toBeUndefined();
    expect(state.frame).toMatchObject({ templateShown: false, template: null });

    const def = await post(h, '/definition', { text: DEF_OK, input: INPUT });
    expect(def.statusCode, def.body).toBe(200);
    expect(def.json().state.def.last).toBe(DEF_OK); // 写接口的响应里就带着刚写的内容
    expect(def.json().state.currentLayer).toBe('L2');

    const tpl = (await post(h, '/framework/template')).json().state;
    expect(tpl.frame.templateShown).toBe(true);
    expect(tpl.frame.template).toContain('骨架');
    expect((await post(h, '/framework', { text: FRAME_TEXT, input: INPUT })).statusCode).toBe(200);
    state = await view(h);
    expect(state.frame.last).toBe(FRAME_TEXT);
    expect(state.currentLayer).toBe('L3');
  });

  it('第 3 层：steps.lines 回显学生写的行（不含判断字段）；路线写全前 canFinish=false，写全后 true', async () => {
    h = await startHelpHarness('epsN');
    await post(h, '/definition', { text: DEF_OK, input: INPUT });
    await post(h, '/framework', { text: FRAME_TEXT, input: INPUT });

    const first = await post(h, '/lines', { statement: K1[0], justification: K1[1], input: INPUT });
    expect(first.statusCode, first.body).toBe(200);
    const { lines, canFinish } = first.json().state.steps;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ n: 1, statement: K1[0], justification: K1[1], provenance: 'keyboard', flagged: false });
    expect(Object.keys(lines[0]).sort()).toEqual(['createdAt', 'flagged', 'justification', 'lineId', 'n', 'provenance', 'statement']);
    expect(canFinish).toBe(false);

    for (const [s, j] of [K2, K3, K4]) await post(h, '/lines', { statement: s, justification: j, input: INPUT });
    const state = await view(h);
    expect(state.steps.lines.map((l: { n: number }) => l.n)).toEqual([1, 2, 3, 4]);
    expect(state.steps.canFinish).toBe(true);
    expect((await post(h, '/finish')).json().state.currentLayer).toBe('L4');
  });

  it('第 5–6 层：迁移题视图；总结五问、已交回答与追问', async () => {
    h = await startHelpHarness('epsN');
    const { ctx } = await loadProblem(h.db, 'epsN', 1);
    const runner = new Runner(ctx);
    for (const action of SCENARIOS.pro.slice(0, 9)) action(runner); // 到第 5 层
    await h.db.query(`update app.attempts set state = $2::jsonb, current_layer = 'L5' where id = $1`, [h.attemptId, JSON.stringify(serializeState(runner.state))]);
    let state = await view(h);
    expect(state.transfer).toMatchObject({ childAttemptId: null, status: 'not_started' });

    const child = await post(h, '/transfer');
    expect(child.statusCode, child.body).toBe(200);
    state = await view(h);
    expect(state.transfer).toMatchObject({ childAttemptId: child.json().state.attemptId, status: 'active' });
    expect(state.transfer.stem.length).toBeGreaterThan(0);
    expect(state.summary).toBeUndefined();

    SCENARIOS.pro[9]?.(runner); // transfer.complete
    await h.db.query(`update app.attempts set state = $2::jsonb, current_layer = 'L6' where id = $1`, [h.attemptId, JSON.stringify(serializeState(runner.state))]);
    state = await view(h);
    expect(state.transfer.status).toBe('completed');
    expect(state.summary.questions).toHaveLength(5);
    expect(state.summary.answers).toEqual([]);
    expect(state.summary.followup).toBeNull();

    const submitted = await post(h, '/summary', { answers: SUMMARY_MISSING_POINT, input: INPUT });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const after = submitted.json().state.summary;
    expect(after.answers).toEqual(SUMMARY_MISSING_POINT);
    expect(after.followup).toBe('你的总结没有提到 $N$ 和 $\\varepsilon$ 的依赖关系。它重要吗？');
  });
});
