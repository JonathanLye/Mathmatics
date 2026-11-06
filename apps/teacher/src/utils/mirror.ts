// 复用学生端 apps/student/src/components/mirror/mirror.ts 的纯逻辑；待抽共享包后替换为同一实现。
// 安全敏感：sandbox 只能 allow-scripts（不能加 allow-same-origin），URL 必须是 /s/mirror + attempt + token。
export const MIRROR_IFRAME_SANDBOX = 'allow-scripts';

const MIRROR_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isValidMirrorToken(token: string): boolean {
  return MIRROR_TOKEN.test(token);
}

export function isMirrorPageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!url.pathname.endsWith('/s/mirror')) return false;
  const attempt = url.searchParams.get('attempt');
  const token = url.searchParams.get('token');
  return attempt !== null && attempt !== '' && token !== null && isValidMirrorToken(token);
}

// 日志/错误文案里若带 token，替换为 ***（与 server logging.ts 的规则一致）。
export function redactMirrorToken(text: string): string {
  return text.replace(/([?&]token=)[^&#\s]*/gi, '$1***');
}

export function mirrorUrlFor(attemptId: string, token: string): string {
  return `/s/mirror?attempt=${encodeURIComponent(attemptId)}&token=${encodeURIComponent(token)}`;
}
