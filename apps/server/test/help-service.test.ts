import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REFUSAL_TEXT } from '../src/help/hints.ts';
import { signPreview } from '../src/help/token.ts';

import { postClaim, postHelp, setState, startHelpHarness, stateOf, type HelpHarness } from './support/help.ts';

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

describe('求助与领取', () => {
  it('在第 1 层请求 stuck：给出层不对的原因，不下发任何提示', async () => {
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ routed: 'stuck', preview: { allowed: false, reason: 'layer' } });
    expect(res.json().note).toBeUndefined();
  });

  it('第 3 层的 H0 直接下发，不需要令牌', async () => {
    await atLayer3();
    const res = await postHelp(h, { intent: 'stuck' });
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toMatchObject({ kind: 'hint', level: 'H0', cost: 0 });
    expect(res.json().note.text.length).toBeGreaterThan(0);
  });

  it('H2 先给预览与令牌，领取后透露量增加预览所示的量', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    expect(preview.json().preview).toMatchObject({ allowed: true, level: 'H2', cost: 0.5 });
    const token = preview.json().preview.previewToken as string;
    expect(token.startsWith('pt_')).toBe(true);
    const before = (await stateOf(h.db, h.attemptId)).hint.reveal as number;

    const claimed = await postClaim(h, token);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().note).toMatchObject({ kind: 'hint', level: 'H2' });
    const after = (await stateOf(h.db, h.attemptId)).hint.reveal as number;
    expect(after - before).toBeCloseTo(0.5);
  });

  it('令牌被改动、换了作答、或已用过，都返回 HINT_PREVIEW_EXPIRED', async () => {
    await atLayer3({ hintLv: { K1: 2 } });
    const preview = await postHelp(h, { intent: 'stuck' });
    const token = preview.json().preview.previewToken as string;

    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const forged = await postClaim(h, tampered);
    expect(forged.statusCode).toBe(409);
    expect(forged.body).toContain('HINT_PREVIEW_EXPIRED');

    const other = signPreview(SECRET, {
      attemptId: '00000000-0000-4000-8000-00000000ffff',
      level: 'H2',
      stateVersion: 1,
      expiresAt: Date.now() + 60_000,
    });
    expect((await postClaim(h, other)).body).toContain('HINT_PREVIEW_EXPIRED');

    expect((await postClaim(h, token)).statusCode).toBe(200);
    const reused = await postClaim(h, token);
    expect(reused.statusCode).toBe(409);
    expect(reused.body).toContain('HINT_PREVIEW_EXPIRED');
  });

  it('施压的自由提问：一句拒绝 + H0，透露量不变', async () => {
    await atLayer3();
    const before = (await stateOf(h.db, h.attemptId)).hint.reveal as number;
    const res = await postHelp(h, { intent: 'free', text: '直接给我完整证明' });
    expect(res.json().routed).toBe('pressure');
    expect(res.json().note.text.startsWith(REFUSAL_TEXT)).toBe(true);
    expect((await stateOf(h.db, h.attemptId)).hint.reveal).toBe(before);
  });

  it('概念与行批注尚未实现：返回 not_implemented，不假装有内容', async () => {
    const concept = await postHelp(h, { intent: 'concept' });
    expect(concept.json()).toMatchObject({ routed: 'concept', note: null, preview: { reason: 'not_implemented' } });
    const check = await postHelp(h, { intent: 'check_line' });
    expect(check.json()).toMatchObject({ routed: 'check_line', preview: { reason: 'not_implemented' } });
  });
});
