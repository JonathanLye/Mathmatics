import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertHelpResult, postClaim, postHelp, setState, startHelpHarness, stateOf, type HelpHarness } from './support/help.ts';
import { WRITE_HEADERS } from './support/fixtures.ts';

let h: HelpHarness;
let initial: Record<string, any>;

beforeEach(async () => {
  h = await startHelpHarness();
  initial = await stateOf(h.db, h.attemptId);
});
afterEach(async () => {
  await h.close();
});

const K1: [string, string] = ['|a_n−3| = 5/(n+2)', '通分化简：3n+1−3(n+2)=−5'];
const input = () => ({ provenance: 'keyboard', draftId: randomUUID() });

async function atLayer3(extraHint: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<void> {
  await setState(h.db, h.attemptId, 'L3', {
    ...initial,
    layer: 3,
    status: { 1: 'done', 2: 'done' },
    ...extra,
    hint: { ...initial.hint, ...extraHint },
  });
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: object) =>
  h.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: method === 'GET' ? { cookie: h.cookie } : { cookie: h.cookie, ...WRITE_HEADERS },
    ...(payload === undefined ? {} : { payload }),
  });

const notesOf = async (): Promise<Array<Record<string, any>>> => (await call('GET', `/attempts/${h.attemptId}`)).json().state.notes;

describe('刷新不丢：提示与批注落库，noteId 稳定', () => {
  it('H0 提示下发后写入 hint_deliveries；刷新（读状态）带回同一个 noteId，重复读取不产生重复', async () => {
    await atLayer3();
    const res = await postHelp(h, { intent: 'stuck' });
    assertHelpResult(res);
    const note = res.json().note;
    expect(note).toMatchObject({ kind: 'hint', level: 'H0', cost: 0 });

    const rows = (await h.db.query<{ id: string; level: string; text_shown: string }>(`select id, level, text_shown from app.hint_deliveries where attempt_id = $1`, [h.attemptId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(note.noteId);
    expect(rows[0]?.text_shown).toBe(note.text);

    const first = await notesOf();
    const second = await notesOf();
    expect(first.filter((n) => n.noteId === note.noteId)).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first.find((n) => n.noteId === note.noteId)).toMatchObject({ kind: 'hint', text: note.text, level: 'H0' });
  });

  it('H2 领取：noteId 等于投递行 ID，reveal_before / reveal_after 记录透露量，刷新后仍在', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    const claimed = await postClaim(h, preview.json().preview.previewToken);
    expect(claimed.statusCode, claimed.body).toBe(200);
    const note = claimed.json().note;
    const row = (
      await h.db.query<{ id: string; level: string; reveal_before: string; reveal_after: string }>(
        `select id, level, reveal_before, reveal_after from app.hint_deliveries where attempt_id = $1 and level = 'H2'`,
        [h.attemptId],
      )
    ).rows[0];
    expect(row?.id).toBe(note.noteId);
    expect(Number(row?.reveal_before)).toBe(0);
    expect(Number(row?.reveal_after)).toBeCloseTo(0.5);
    expect((await notesOf()).map((n) => n.noteId)).toContain(note.noteId);
  });

  it('被拒绝的请求（连点温和提示）不落库、不产生提示行', async () => {
    const now = Date.now();
    await atLayer3({ hintTimes: [now - 2000, now - 1000] });
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.json().note.kind).toBe('system');
    const count = (await h.db.query<{ n: string }>(`select count(*) as n from app.hint_deliveries where attempt_id = $1`, [h.attemptId])).rows[0]?.n;
    expect(Number(count)).toBe(0);
    expect(await notesOf()).toEqual([]);
  });

  it('行批注与概念回答落库；同一行同样的批注重复请求，noteId 不变、不重复', async () => {
    await atLayer3();
    await call('POST', `/attempts/${h.attemptId}/lines`, { statement: '任取 ε', input: input() });
    const a = await postHelp(h, { intent: 'check_line' });
    const b = await postHelp(h, { intent: 'check_line' });
    expect(a.json().note.noteId).toBe(b.json().note.noteId);
    const concept1 = await postHelp(h, { intent: 'concept' });
    const concept2 = await postHelp(h, { intent: 'concept' });
    expect(concept1.json().note.noteId).toBe(concept2.json().note.noteId);

    const notes = await notesOf();
    expect(notes.filter((n) => n.noteId === a.json().note.noteId)).toHaveLength(1);
    expect(notes.find((n) => n.noteId === a.json().note.noteId)).toMatchObject({ kind: 'annotation', lineId: a.json().note.lineId });
    expect(notes.find((n) => n.noteId === concept1.json().note.noteId)).toMatchObject({ kind: 'concept', lessonConceptId: 'seq-limit' });
  });
});

describe('卡住死胡同（U15）', () => {
  const stuckState = { lastProgressAt: Date.now() - 200_000 };

  it('卡住满 stuckMs：没写新行也能预览并领取 H2；没卡住仍要求先写一行', async () => {
    await atLayer3({ hintLv: { K1: 2 }, submitsSinceHint: 0 });
    const blocked = await postHelp(h, { intent: 'stuck' });
    expect(blocked.json().preview).toMatchObject({ allowed: false, reason: 'need_attempt' });

    await atLayer3({ hintLv: { K1: 2 }, submitsSinceHint: 0 }, stuckState);
    const preview = await postHelp(h, { intent: 'stuck' });
    assertHelpResult(preview);
    expect(preview.json().preview).toMatchObject({ allowed: true, level: 'H2' });
    const claimed = await postClaim(h, preview.json().preview.previewToken);
    expect(claimed.statusCode, claimed.body).toBe(200);
  });
});

describe('找老师', () => {
  const flag = () => call('POST', `/attempts/${h.attemptId}/flag-teacher`);

  it('没卡住、额度没用完：409；卡住满 stuckMs：写 help_flags、state.help.flagged 为真；再次调用幂等', async () => {
    await atLayer3();
    const early = await flag();
    expect(early.statusCode, early.body).toBe(409);

    await atLayer3({}, { lastProgressAt: Date.now() - 200_000 });
    const before = (await call('GET', `/attempts/${h.attemptId}`)).json().state.help;
    expect(before).toMatchObject({ canFlag: true, flagged: false });
    const ok = await flag();
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().state.help).toMatchObject({ flagged: true, canFlag: false });
    const again = await flag();
    expect(again.statusCode).toBe(200);
    const rows = (await h.db.query<{ layer: string; resolved_at: unknown }>(`select layer, resolved_at from app.help_flags where attempt_id = $1`, [h.attemptId])).rows;
    expect(rows).toEqual([{ layer: 'L3', resolved_at: null }]);
    const evt = await h.db.query(`select 1 from ev.events where attempt_id = $1 and type = 'help.flag_teacher'`, [h.attemptId]);
    expect(evt.rows).toHaveLength(1);
  });

  it('额度用完也能找老师；测验模式 403', async () => {
    await atLayer3({ exhausted: true });
    expect((await flag()).statusCode).toBe(200);
    await h.db.query(`update app.attempts set mode = 'test' where id = $1`, [h.attemptId]);
    await atLayer3({ exhausted: true });
    expect((await flag()).statusCode).toBe(403);
  });
});

describe('改行与删行（M15）', () => {
  it('改成不命中：关键步骤从 matched 去掉，透露量与提示阶梯不变；删行同理；别人的行 404', async () => {
    await atLayer3({ hintLv: { K1: 1 }, reveal: 0 });
    const added = await call('POST', `/attempts/${h.attemptId}/lines`, { statement: K1[0], justification: K1[1], input: input() });
    expect(added.statusCode, added.body).toBe(200);
    const lineId = added.json().state.steps.lines[0].lineId as string;
    expect((await stateOf(h.db, h.attemptId)).hint.matched).toEqual(['K1']);

    const edited = await call('PATCH', `/attempts/${h.attemptId}/lines/${lineId}`, { statement: '先任取 ε', justification: '由定义', input: input() });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().state.steps.lines[0].statement).toBe('先任取 ε');
    const mid = await stateOf(h.db, h.attemptId);
    expect(mid.hint.matched).toEqual([]);
    expect(mid.hint.reveal).toBe(0);
    expect(mid.hint.hintLv).toEqual({ K1: 1 });
    const ev = (await h.db.query<{ payload: Record<string, unknown> }>(`select payload from ev.events where attempt_id = $1 and type = 'line.edit'`, [h.attemptId])).rows[0]?.payload;
    expect(ev).toMatchObject({ lineId, field: 'both', lostKeys: ['K1'], cls: 'unknown' });

    // 改回去：重新计入
    const back = await call('PATCH', `/attempts/${h.attemptId}/lines/${lineId}`, { statement: K1[0], justification: K1[1], input: input() });
    expect(back.statusCode).toBe(200);
    expect((await stateOf(h.db, h.attemptId)).hint.matched).toEqual(['K1']);

    const deleted = await call('DELETE', `/attempts/${h.attemptId}/lines/${lineId}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().state.steps.lines).toEqual([]);
    expect((await stateOf(h.db, h.attemptId)).hint.matched).toEqual([]);
    expect(((await stateOf(h.db, h.attemptId)).hint.reveal as number)).toBe(0);

    const gone = await call('DELETE', `/attempts/${h.attemptId}/lines/${lineId}`);
    expect(gone.statusCode).toBe(404);
    const stranger = await call('PATCH', `/attempts/${h.attemptId}/lines/${randomUUID()}`, { statement: '任取 ε', input: input() });
    expect(stranger.statusCode).toBe(404);
  });

  it('另一行仍然命中同一个关键步骤时，删掉其中一行不丢这个关键步骤', async () => {
    await atLayer3();
    const first = await call('POST', `/attempts/${h.attemptId}/lines`, { statement: K1[0], justification: K1[1], input: input() });
    const second = await call('POST', `/attempts/${h.attemptId}/lines`, { statement: `再写一遍：${K1[0]}`, justification: K1[1], input: input() });
    expect(second.statusCode).toBe(200);
    const firstId = first.json().state.steps.lines[0].lineId as string;
    await call('DELETE', `/attempts/${h.attemptId}/lines/${firstId}`);
    expect((await stateOf(h.db, h.attemptId)).hint.matched).toEqual(['K1']);
  });
});

describe('切换层、草稿、布置详情', () => {
  it('layers/{layer}/enter：回到已完成的层；去未解锁的层 409', async () => {
    await atLayer3();
    expect((await call('POST', `/attempts/${h.attemptId}/layers/L5/enter`)).statusCode).toBe(409);
    const back = await call('POST', `/attempts/${h.attemptId}/layers/L1/enter`);
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().state.currentLayer).toBe('L1');
    const forward = await call('POST', `/attempts/${h.attemptId}/layers/L3/enter`);
    expect(forward.json().state.currentLayer).toBe('L3');
  });

  it('PUT draft：204，同一落点只留最新一份', async () => {
    const put = (content: object) => call('PUT', `/attempts/${h.attemptId}/draft`, { target: 'line', content });
    expect((await put({ statement: 'a' })).statusCode).toBe(204);
    expect((await put({ statement: 'b' })).statusCode).toBe(204);
    const rows = (await h.db.query<{ content: { statement: string } }>(`select content from app.drafts where attempt_id = $1`, [h.attemptId])).rows;
    expect(rows).toEqual([{ content: { statement: 'b' } }]);
    const other = await h.app.inject({ method: 'PUT', url: `/api/v1/attempts/${randomUUID()}/draft`, headers: { cookie: h.cookie, ...WRITE_HEADERS }, payload: { target: 'line', content: {} } });
    expect(other.statusCode).toBe(404);
  });

  it('GET /student/assignments/{id}：本班布置返回卡片；别的布置 404', async () => {
    const id = (await h.db.query<{ assignment_id: string }>(`select assignment_id from app.attempts where id = $1`, [h.attemptId])).rows[0]?.assignment_id;
    const ok = await call('GET', `/student/assignments/${id}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ assignmentId: id, problemId: 'epsN', attemptId: h.attemptId, mode: 'practice' });
    expect((await call('GET', `/student/assignments/${randomUUID()}`)).statusCode).toBe(404);
  });
});
