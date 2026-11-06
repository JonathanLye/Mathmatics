// 修改密码表单的前端检查：只做“两次一致、够长、不和旧密码一样”这类显而易见的事；其余规则以服务端为准。
export const TEACHER_MIN_PASSWORD_LENGTH = 8;

export function checkPasswordForm(current: string, next: string, confirm: string): string | null {
  if (current === '') return '请输入当前密码';
  if ([...next].length < TEACHER_MIN_PASSWORD_LENGTH) return `新密码至少 ${TEACHER_MIN_PASSWORD_LENGTH} 个字符`;
  if (next !== confirm) return '两次输入的新密码不一样';
  if (next === current) return '新密码不能和当前密码一样';
  return null;
}
