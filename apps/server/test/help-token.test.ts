import { describe, expect, it } from 'vitest';

import { signPreview, verifyPreview } from '../src/help/token.ts';

const SECRET = 'unit-test-secret-at-least-thirty-two-chars';
const claims = { attemptId: 'a1', level: 'H2', stateVersion: 3, expiresAt: 10_000 };

describe('预览令牌', () => {
  it('签名后在有效期内可验证，返回原始内容', () => {
    const token = signPreview(SECRET, claims);
    expect(token.startsWith('pt_')).toBe(true);
    expect(verifyPreview(SECRET, token, 5_000)).toEqual(claims);
  });

  it('过期后不接受', () => {
    expect(verifyPreview(SECRET, signPreview(SECRET, claims), 10_000)).toBeNull();
  });

  it('换了密钥、改了内容或签名、格式不对，都不接受', () => {
    const token = signPreview(SECRET, claims);
    const [body, sig] = token.slice(3).split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, level: 'H4' }), 'utf8').toString('base64url');
    expect(verifyPreview('another-secret-that-is-also-long-enough', token, 5_000)).toBeNull();
    expect(verifyPreview(SECRET, `pt_${forgedBody}.${sig}`, 5_000)).toBeNull();
    expect(verifyPreview(SECRET, `pt_${body}.${sig.slice(0, -2)}AA`, 5_000)).toBeNull();
    expect(verifyPreview(SECRET, 'not-a-token', 5_000)).toBeNull();
    expect(verifyPreview(SECRET, 'pt_onlybody', 5_000)).toBeNull();
  });
});
