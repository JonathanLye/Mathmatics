import { describe, expect, it } from 'vitest';

import { checkPasswordForm } from './password.ts';

describe('checkPasswordForm', () => {
  it('合法输入通过', () => {
    expect(checkPasswordForm('old-password', 'new-password-1', 'new-password-1')).toBeNull();
  });
  it('缺当前密码、新密码过短、两次不一致、与旧密码相同分别给出原因', () => {
    expect(checkPasswordForm('', 'new-password-1', 'new-password-1')).toBe('请输入当前密码');
    expect(checkPasswordForm('old', 'short', 'short')).toMatch(/至少 8/);
    expect(checkPasswordForm('old', 'new-password-1', 'new-password-2')).toBe('两次输入的新密码不一样');
    expect(checkPasswordForm('same-password', 'same-password', 'same-password')).toBe('新密码不能和当前密码一样');
  });
});
