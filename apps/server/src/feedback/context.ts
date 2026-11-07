import { AppError } from '../errors.ts';

// 探针上下文（15 §4）。契约（FeedbackContext）已经限制了键与长度；这里再做两件契约表达不了的事：
// 1. 去掉路径/面包屑里的 query 与 hash（里面可能带 token、学号）；
// 2. 序列化后总大小 ≤16KB。
// 客户端是不可信的：开发者页面一律按纯文本渲染这些字段。

export const MAX_CONTEXT_BYTES = 16 * 1024;

type Json = Record<string, unknown>;

const stripUrl = (value: string): string => {
  const cut = value.search(/[?#]/);
  return cut < 0 ? value : value.slice(0, cut);
};

// 面包屑的 text：nav 是路径；api 形如「POST /student/feedback?x=1」，只清洗其中的路径；tap 是 data-fb 名，不动。
const cleanBreadcrumbText = (kind: string, text: string): string => {
  if (kind === 'nav') return stripUrl(text);
  if (kind === 'api') {
    const space = text.indexOf(' ');
    return space < 0 ? stripUrl(text) : `${text.slice(0, space)} ${stripUrl(text.slice(space + 1))}`;
  }
  return text;
};

export function sanitizeContext(raw: unknown): Json {
  if (raw === undefined || raw === null) return {};
  const ctx = structuredClone(raw) as Json;

  if (typeof ctx.route === 'string') ctx.route = stripUrl(ctx.route);
  if (Array.isArray(ctx.breadcrumbs)) {
    ctx.breadcrumbs = (ctx.breadcrumbs as Json[]).map((b) => ({
      ...b,
      text: cleanBreadcrumbText(String(b.kind), String(b.text)),
    }));
  }

  if (Buffer.byteLength(JSON.stringify(ctx), 'utf8') > MAX_CONTEXT_BYTES) {
    throw new AppError('VALIDATION_FAILED', 422, '附带的信息太多了', { reason: 'context_too_large' });
  }
  return ctx;
}

// 页面区域（开发者分类用）：由路由推导，开发者可改。路由形如 /pages/me/about、/pages/practice/index。
export function areaOf(route: string | undefined): string {
  if (!route) return 'other';
  const parts = stripUrl(route).split('/').filter(Boolean);
  const seg = parts[0] === 'pages' ? parts[1] : parts[0];
  if (!seg) return 'other';
  const known = new Set([
    'home',
    'practice-zone',
    'practice',
    'mistakes',
    'proofbook',
    'proof-detail',
    'me',
    'login',
    'set-password',
    'age',
    'consent',
    'welcome',
    'tour',
    'privacy-policy',
    'mirror',
    'not-found',
  ]);
  return known.has(seg) ? seg : 'other';
}
