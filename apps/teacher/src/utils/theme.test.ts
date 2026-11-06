import { describe, expect, it } from 'vitest';

import { applyTheme, resolveTheme } from './theme.ts';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
}

describe('教师端主题', () => {
  it('上次的选择优先，其次系统偏好，默认浅色', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
    expect(resolveTheme('???', false)).toBe('light');
  });

  it('共用 token 的 data-theme 与 TDesign 的 theme-mode 永远一起切', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    expect(root.attrs.get('data-theme')).toBe('dark');
    expect(root.attrs.get('theme-mode')).toBe('dark');
    applyTheme('light', root);
    expect(root.attrs.get('data-theme')).toBe('light');
    expect(root.attrs.has('theme-mode')).toBe(false);
  });
});
