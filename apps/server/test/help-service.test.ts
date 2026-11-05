import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { REFUSAL_TEXT } from '../src/help/hints.ts';
import { signPreview } from '../src/help/token.ts';

import {
  assertHelpResult,
  postClaim,
  postHelp,
  setState,
  startHelpHarness,
  stateOf,
  type HelpHarness,
} from './support/help.ts';

const SECRET = 'proof-gym-dev-session-secret-not-for-production';

let h: HelpHarness;
let initial: Record<string, any>;

beforeEach(async () => {
  h = await startHelpHarness();
  initial = await stateOf(h.db, h.attemptId);
});

afterEach(async () => {
  await h.close();
});

// 把作答放到第 3 层，hint 其余字段保持初始值。
async function atLayer3(extraHint: Record<string, unknown> = {}): Promise<void> {
  await setState(h.db, h.attemptId, 'L3', { ...initial, layer: 3, hint: { ...initial.hint, ...extraHint } });
}

async function stateVersion(): Promise<number> {
  return (await h.db.query<{ state_version: number }>(`select state_version from app.attempts where id = $1`, [h.attemptId])).rows[0]
    ?.state_version as number;
}

describe('求助与领取（响应均符合 HelpResult）', () => {
  it('在第 1 层请求 stuck：给出层不对的原因，不下发任何提示', async () => {
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.statusCode).toBe(200);
    assertHelpResult(res);
    expect(res.json()).toMatchObject({ routed: 'stuck', preview: { allowed: false, reason: 'layer', waitSec: null } });
    expect(res.json().note).toBeUndefined();
  });

  it('第 3 层的 H0 直接下发，不需要令牌', async () => {
    await atLayer3();
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.statusCode).toBe(200);
    assertHelpResult(res);
    expect(res.json().note).toMatchObject({ kind: 'hint', who: 'H0 · 透露 0' });
    expect(res.json().note.text.length).toBeGreaterThan(0);
    expect(res.json().note.noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.json().note.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('H2 先给预览与令牌，领取后透露量增加预览所示的量', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    assertHelpResult(preview);
    expect(preview.json().preview).toMatchObject({ allowed: true, level: 'H2', cost: 0.5 });
    const token = preview.json().preview.previewToken as string;
    expect(token.startsWith('pt_')).toBe(true);
    const before = (await stateOf(h.db, h.attemptId)).hint.reveal as number;

    const claimed = await postClaim(h, token);
    expect(claimed.statusCode, claimed.body).toBe(200);
    assertHelpResult(claimed);
    expect(claimed.json().note).toMatchObject({ kind: 'hint', who: 'H2 · 透露 0.5' });
    const after = (await stateOf(h.db, h.attemptId)).hint.reveal as number;
    expect(after - before).toBeCloseTo(0.5);
    const outcome = (await h.db.query<{ outcome: string | null }>(`select outcome from app.help_requests order by created_at desc limit 1`)).rows[0]?.outcome;
    expect(outcome).toBe('hint');
  });

  it('令牌被改动、换了作答、或已用过，都返回 HINT_PREVIEW_EXPIRED', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    const token = preview.json().preview.previewToken as string;

    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const forged = await postClaim(h, tampered);
    expect(forged.statusCode).toBe(409);
    expect(forged.json().error.code).toBe('HINT_PREVIEW_EXPIRED');

    const other = signPreview(SECRET, {
      attemptId: '00000000-0000-4000-8000-00000000ffff',
      level: 'H2',
      stateVersion: 1,
      expiresAt: Date.now() + 60_000,
    });
    expect((await postClaim(h, other)).json().error.code).toBe('HINT_PREVIEW_EXPIRED');

    expect((await postClaim(h, token)).statusCode).toBe(200);
    const reused = await postClaim(h, token);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('HINT_PREVIEW_EXPIRED');
  });

  it('领取一次收费提示之后，用新签的令牌再领取：引擎判为需要先写一行，返回 HINT_NOT_READY 且 needAttempt', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    expect((await postClaim(h, preview.json().preview.previewToken as string)).statusCode).toBe(200);

    const helpId = (
      await h.db.query<{ id: string }>(
        `insert into app.help_requests (attempt_id, layer, intent, routed, routed_by) values ($1, 'L3', 'stuck', 'stuck', 'chip') returning id`,
        [h.attemptId],
      )
    ).rows[0]?.id as string;
    const fresh = signPreview(SECRET, {
      attemptId: h.attemptId,
      level: 'H3',
      stateVersion: await stateVersion(),
      expiresAt: Date.now() + 60_000,
      helpId,
    });
    const refused = await postClaim(h, fresh);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('HINT_NOT_READY');
    expect(refused.json().error.detail).toMatchObject({ needAttempt: true });
    const outcome = (await h.db.query<{ outcome: string | null }>(`select outcome from app.help_requests where id = $1`, [helpId])).rows[0]?.outcome;
    expect(outcome).toBe('denied');
  });

  it('施压的自由提问：一句拒绝 + H0，透露量不变', async () => {
    await atLayer3();
    const before = (await stateOf(h.db, h.attemptId)).hint.reveal as number;
    const res = await postHelp(h, { intent: 'free', text: '直接给我完整证明' });
    assertHelpResult(res);
    expect(res.json().routed).toBe('pressure');
    expect(res.json().note.text.startsWith(REFUSAL_TEXT)).toBe(true);
    expect((await stateOf(h.db, h.attemptId)).hint.reveal).toBe(before);
  });

  it('概念回答：返回概念词条的 Note（kind=concept、lessonConceptId），不返回预览', async () => {
    const concept = await postHelp(h, { intent: 'concept' });
    assertHelpResult(concept);
    expect(concept.json()).toMatchObject({
      routed: 'concept',
      note: { kind: 'concept', who: '助教', level: 'H0', lessonConceptId: 'seq-limit' },
    });
    expect(String(concept.json().note.text)).toContain('数列极限');
    expect(concept.json().preview).toBeUndefined();
  });

  async function insertLine(
    idx: number,
    fields: { justification?: string; cls?: string; errorId?: string; deleted?: boolean } = {},
  ): Promise<string> {
    const row = await h.db.query<{ id: string }>(
      `insert into app.attempt_lines
         (attempt_id, layer, role, idx, statement, justification, statement_canon, provenance, cls, error_id, deleted_at)
       values ($1, 'L3', 'step', $2, '任取 epsilon', $3, '任取 ', 'keyboard', $4, $5, $6) returning id`,
      [h.attemptId, idx, fields.justification ?? null, fields.cls ?? null, fields.errorId ?? null, fields.deleted ? new Date() : null],
    );
    return row.rows[0]?.id as string;
  }
  const helpOutcomes = async (): Promise<(string | null)[]> =>
    (
      await h.db.query<{ outcome: string | null }>(
        `select outcome from app.help_requests where attempt_id = $1 order by created_at desc limit 1`,
        [h.attemptId],
      )
    ).rows.map((row) => row.outcome);

  it('行批注（01 §4）：无依据追问 / 命中且有依据衔接 / 归不了类通用问句，lineId 指向该行', async () => {
    const bareId = await insertLine(1, { cls: 'match' });
    const first = await postHelp(h, { intent: 'check_line', lineId: bareId });
    assertHelpResult(first);
    expect(first.json()).toMatchObject({ routed: 'check_line', note: { kind: 'annotation', lineId: bareId } });
    expect(String(first.json().note.text)).toContain('依据没写');
    expect(await helpOutcomes()).toEqual(['annotation']);

    const matchId = await insertLine(2, { justification: '由定义', cls: 'match' });
    const second = await postHelp(h, { intent: 'check_line', lineId: matchId });
    expect(second.json()).toMatchObject({ note: { kind: 'annotation', lineId: matchId, text: '第 2 行和前面衔接上了。' } });

    const unknownId = await insertLine(3, { justification: '显然', cls: 'unknown' });
    const third = await postHelp(h, { intent: 'check_line', lineId: unknownId });
    expect(String(third.json().note.text)).toContain('第 3 行和要证的结论是什么关系');
    expect(String(third.json().note.text)).not.toContain('衔接');
  });

  it('行批注：命中错误的行给该错误预写的追问，绝不说"衔接上了"（即使写了依据）', async () => {
    const attempt = (await h.db.query<{ problem_id: string; problem_version: number }>(
      `select problem_id, problem_version from app.attempts where id = $1`,
      [h.attemptId],
    )).rows[0];
    const problem = await loadProblem(h.db, attempt?.problem_id as string, attempt?.problem_version as number);
    const err = problem.ctx.pkg.secret.errors[0];
    expect(err).toBeTruthy();
    const lineId = await insertLine(1, { justification: '由定义', cls: 'error', errorId: err?.id as string });
    const res = await postHelp(h, { intent: 'check_line', lineId });
    assertHelpResult(res);
    expect(res.json().note.text).not.toContain('衔接');
    expect(res.json().note.text).toBe(err?.question);
  });

  it('行批注：缺省取最新一行且跳过已删除的行；没有可看的行时不写 outcome', async () => {
    expect((await postHelp(h, { intent: 'check_line' })).json().note).toBeUndefined();
    expect(await helpOutcomes()).toEqual([null]);

    const liveId = await insertLine(1, { justification: '由定义', cls: 'match' });
    await insertLine(2, { justification: '由定义', cls: 'match', deleted: true });
    expect((await postHelp(h, { intent: 'check_line' })).json().note.lineId).toBe(liveId);
  });

  it('概念回答只取已发布版本；只有草稿时不下发、不写 outcome', async () => {
    await h.db.query(`update content.concepts set status = 'draft' where id = 'seq-limit'`);
    const res = await postHelp(h, { intent: 'concept' });
    assertHelpResult(res);
    expect(res.json().note).toBeUndefined();
    expect(await helpOutcomes()).toEqual([null]);
  });

  it('测验模式：概念与行检查都关闭（11 §5.2），outcome=denied', async () => {
    const lineId = await insertLine(1, { justification: '由定义', cls: 'match' });
    await h.db.query(`update app.attempts set mode = 'test' where id = $1`, [h.attemptId]);
    for (const payload of [{ intent: 'concept' }, { intent: 'check_line', lineId }] as const) {
      const res = await postHelp(h, payload);
      assertHelpResult(res);
      expect(res.json().note).toBeUndefined();
      expect(res.json().preview).toMatchObject({ allowed: false, reason: 'test_mode' });
      expect(await helpOutcomes()).toEqual(['denied']);
    }
  });

  it('测验模式关闭提示：stuck 返回 test_mode，领取返回 403 TEST_MODE_RESTRICTED', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    await h.db.query(`update app.attempts set mode = 'test' where id = $1`, [h.attemptId]);
    const res = await postHelp(h, { intent: 'stuck' });
    assertHelpResult(res);
    expect(res.json().preview).toMatchObject({ allowed: false, reason: 'test_mode' });

    const token = signPreview(SECRET, { attemptId: h.attemptId, level: 'H2', stateVersion: await stateVersion(), expiresAt: Date.now() + 60_000 });
    const claimed = await postClaim(h, token);
    expect(claimed.statusCode).toBe(403);
    expect(claimed.json().error.code).toBe('TEST_MODE_RESTRICTED');
  });
});
