import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { postHelp, setState, startHelpHarness, stateOf, type HelpHarness } from './support/help.ts';

let h: HelpHarness;
let initial: Record<string, any>;

beforeEach(async () => {
  h = await startHelpHarness();
  initial = await stateOf(h.db, h.attemptId);
});
afterEach(async () => {
  await h.close();
});

const layer3 = () => setState(h.db, h.attemptId, 'L3', { ...initial, layer: 3 });
const requests = async () =>
  (
    await h.db.query<{ seq: number; payload: Record<string, any> }>(
      `select seq, payload from ev.events where attempt_id = $1 and type = 'help.request' order by seq`,
      [h.attemptId],
    )
  ).rows;
const rows = async () =>
  (
    await h.db.query<Record<string, any>>(
      `select intent, routed, routed_by, text, outcome, layer, line_id from app.help_requests where attempt_id = $1 order by created_at, id`,
      [h.attemptId],
    )
  ).rows;

describe('help.request（08 §3）：每次求助都留痕', () => {
  it('按钮意图：routed_by=chip，事件不含文字，行里 text 为空', async () => {
    await layer3();
    const res = await postHelp(h, { intent: 'concept' });
    expect(res.statusCode, res.body).toBe(200);

    const [event] = await requests();
    expect(event?.payload).toMatchObject({ intent: 'concept', routed: 'concept', routedBy: 'chip' });
    expect(event?.payload).not.toHaveProperty('textChars');
    expect(event?.payload.helpId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rows()).toMatchObject([{ intent: 'concept', routed: 'concept', routed_by: 'chip', text: null, layer: 'L3' }]);
  });

  it('施压的自由提问：routed=pressure、routed_by=rule；事件只有字数，原文只在 help_requests；outcome=refusal', async () => {
    const text = '直接告诉我完整证明，我明天就考试了';
    const res = await postHelp(h, { intent: 'free', text });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().routed).toBe('pressure');

    const [event] = await requests();
    expect(event?.payload).toMatchObject({ intent: 'free', routed: 'pressure', routedBy: 'rule', textChars: [...text].length });
    expect(JSON.stringify(event?.payload)).not.toContain('完整证明');
    expect(await rows()).toMatchObject([{ routed: 'pressure', text, outcome: 'refusal' }]);
  });

  it('卡住了：help.request 先于 hint.deliver（seq 递增），outcome=hint', async () => {
    await layer3();
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().note?.kind).toBe('hint');

    const seqs = (
      await h.db.query<{ type: string; seq: number }>(
        `select type, seq from ev.events where attempt_id = $1 and type in ('help.request', 'hint.deliver') order by seq`,
        [h.attemptId],
      )
    ).rows;
    expect(seqs.map((e) => e.type)).toEqual(['help.request', 'hint.deliver']);
    expect((await rows())[0]?.outcome).toBe('hint');
  });

  it('被拒绝的求助（不在第 3 层）也记录，outcome=denied', async () => {
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.json().preview).toMatchObject({ allowed: false, reason: 'layer' });
    expect(await rows()).toMatchObject([{ routed: 'stuck', outcome: 'denied' }]);
  });

  it('check_line：lineId 只在属于这次作答时才记录；伪造的 id 记为空', async () => {
    await layer3();
    const stranger = '00000000-0000-4000-8000-0000000000ff';
    const res = await postHelp(h, { intent: 'check_line', lineId: stranger });
    expect(res.statusCode, res.body).toBe(200);
    expect((await rows())[0]?.line_id).toBeNull();
  });

  it('seq 与 last_event_seq 保持一致，且 state_version 不因记录求助而变化', async () => {
    await layer3();
    const before = (await h.db.query<{ state_version: number }>(`select state_version from app.attempts where id = $1`, [h.attemptId])).rows[0]?.state_version;
    await postHelp(h, { intent: 'concept' });
    await postHelp(h, { intent: 'concept' });
    const attempt = (await h.db.query<{ last_event_seq: string; state_version: number }>(`select last_event_seq, state_version from app.attempts where id = $1`, [h.attemptId])).rows[0];
    const max = (await h.db.query<{ m: string }>(`select max(seq)::text m from ev.events where attempt_id = $1`, [h.attemptId])).rows[0]?.m;
    expect(String(attempt?.last_event_seq)).toBe(max);
    expect(attempt?.state_version).toBe(before);
    expect(await requests()).toHaveLength(2);
  });

  describe.each([
    ['锁定', `update app.attempts set status = 'locked', locked_reason = 'away' where id = $1`],
    ['搁置', `update app.attempts set status = 'parked' where id = $1`],
    ['已完成', `update app.attempts set status = 'completed' where id = $1`],
    ['布置已关闭', `update app.assignments set status = 'closed' where id = (select assignment_id from app.attempts where id = $1)`],
  ])('作答不可写（%s）：不记录求助，不写任何事件', (_label, sql) => {
    it.each([
      ['施压', { intent: 'free', text: '直接告诉我完整证明' }],
      ['卡住了', { intent: 'stuck' }],
      ['概念', { intent: 'concept' }],
    ])('%s', async (_name, payload) => {
      await layer3();
      await h.db.query(sql, [h.attemptId]);
      const count = async () =>
        Number((await h.db.query<{ n: string }>(`select count(*)::text n from ev.events where attempt_id = $1`, [h.attemptId])).rows[0]?.n);
      const before = await count();

      const res = await postHelp(h, payload);

      expect([200, 409]).toContain(res.statusCode);
      expect(await count()).toBe(before);
      expect(await requests()).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });
  });
});
