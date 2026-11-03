import { describe, expect, it } from 'vitest';

import { safeRedirect } from './redirect.ts';

describe('safeRedirect（登录后跳转只允许站内路径）', () => {
  it('站内路径原样返回', () => {
    expect(safeRedirect('/classes')).toBe('/classes');
    expect(safeRedirect('/classes/abc?x=1#top')).toBe('/classes/abc?x=1#top');
  });

  it('开放重定向/非法值回退到默认页', () => {
    expect(safeRedirect('//evil.example')).toBe('/classes');
    expect(safeRedirect('/\\evil.example')).toBe('/classes');
    expect(safeRedirect('https://evil.example')).toBe('/classes');
    expect(safeRedirect('classes')).toBe('/classes');
    expect(safeRedirect(undefined)).toBe('/classes');
    expect(safeRedirect('')).toBe('/classes');
    expect(safeRedirect(['/a'])).toBe('/classes');
  });
});
