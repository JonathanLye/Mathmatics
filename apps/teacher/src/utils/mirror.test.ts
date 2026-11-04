import { describe, expect, it } from 'vitest';

import { MIRROR_IFRAME_SANDBOX, isMirrorPageUrl, isValidMirrorToken, mirrorUrlFor, redactMirrorToken } from './mirror.ts';

const TOKEN = 'eyJ2IjoxfQ.c2ln';

describe('镜像 iframe 安全（04 §5.1 / #100 方案 b）', () => {
  it('sandbox 只有 allow-scripts，不含 allow-same-origin', () => {
    expect(MIRROR_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(MIRROR_IFRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  it('token 形状校验', () => {
    expect(isValidMirrorToken(TOKEN)).toBe(true);
    expect(isValidMirrorToken('no-dot')).toBe(false);
    expect(isValidMirrorToken('a b.c')).toBe(false);
  });

  it('镜像 URL 校验：只接受 http(s) + /s/mirror + attempt + token', () => {
    expect(isMirrorPageUrl(`https://example.com/s/mirror?attempt=abc&token=${encodeURIComponent(TOKEN)}`)).toBe(true);
    expect(isMirrorPageUrl(`http://127.0.0.1:5175/s/mirror?attempt=abc&token=${encodeURIComponent(TOKEN)}`)).toBe(true);
    expect(isMirrorPageUrl(`javascript:alert(1)//s/mirror?attempt=a&token=${TOKEN}`)).toBe(false);
    expect(isMirrorPageUrl(`data:text/html,x`)).toBe(false);
    expect(isMirrorPageUrl(`/s/mirror?attempt=a`)).toBe(false);
    expect(isMirrorPageUrl(`/s/other?attempt=a&token=${TOKEN}`)).toBe(false);
  });

  it('日志脱敏与 URL 构造', () => {
    expect(redactMirrorToken('/s/mirror?attempt=a&token=SECRET&x=1')).toBe('/s/mirror?attempt=a&token=***&x=1');
    const url = mirrorUrlFor('a b', TOKEN);
    expect(url).toContain('attempt=a%20b');
    expect(isMirrorPageUrl(new URL(url, 'https://example.com').toString())).toBe(true);
  });
});
