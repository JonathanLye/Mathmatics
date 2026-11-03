// 登录后的跳转目标必须是站内路径：只接受以单个 '/' 开头、排除 '//' 与 '/\'（避免开放重定向）。
export function safeRedirect(value: unknown, fallback = '/classes'): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (value[0] !== '/' || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
