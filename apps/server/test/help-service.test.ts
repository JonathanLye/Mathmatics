import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  it('概念与行批注尚未实现：不返回 note 与预览，不假装有内容', async () => {
    const concept = await postHelp(h, { intent: 'concept' });
    assertHelpResult(concept);
    expect(concept.json()).toMatchObject({ routed: 'concept' });
    expect(concept.json().note).toBeUndefined();
    expect(concept.json().preview).toBeUndefined();
    const check = await postHelp(h, { intent: 'check_line' });
    assertHelpResult(check);
    expect(check.json()).toMatchObject({ routed: 'check_line' });
    expect(check.json().note).toBeUndefined();
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
