// 统一的 fetch 封装（06 §1）：
// - 同源 Cookie（credentials: 'include'）；本地开发由 Vite 代理 /api 到 server。
// - 非 GET 一律带 X-Requested-With: proof-gym（CSRF 校验）。
// - 每个请求带 X-Pg-App: teacher：/me、/auth/logout 据此读教师 Cookie（pg_sid_t），与同一浏览器里的学生登录互不影响。
// - 错误统一解析 { error: { code, message, detail } }。
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; detail?: unknown };
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
  return new ApiError(
    body?.error?.code ?? 'HTTP_ERROR',
    res.status,
    body?.error?.message ?? `请求失败（${res.status}）`,
    body?.error?.detail,
  );
}

// 会话过期统一通知 shell（App.vue 清理 session 并跳登录），避免每个页面各写一遍。
// 401 一定是；403 只在服务端标明 wrong_app（浏览器里只有学生端会话）时算，
// 其余 403（例如“管理员补发暂不支持”）是业务提示，照常抛给页面就地显示。
function isAuthLost(error: ApiError): boolean {
  if (error.status === 401) return true;
  const detail = error.detail as { reason?: unknown } | null | undefined;
  return error.status === 403 && detail?.reason === 'wrong_app';
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const error = await parseError(res);
    if (isAuthLost(error) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pg:unauthorized'));
    }
    throw error;
  }
  return (await res.json()) as T;
}

function headersFor(method: string, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-pg-app': 'teacher' };
  if (json) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-requested-with'] = 'proof-gym';
  return headers;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return fetch(path, { headers: headersFor('GET', false), credentials: 'include' }).then(handle<T>);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(path, {
      method: 'POST',
      headers: headersFor('POST', body !== undefined),
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle<T>);
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return fetch(path, {
      method: 'PATCH',
      headers: headersFor('PATCH', true),
      credentials: 'include',
      body: JSON.stringify(body),
    }).then(handle<T>);
  },
  delete<T>(path: string): Promise<T> {
    return fetch(path, {
      method: 'DELETE',
      headers: headersFor('DELETE', false),
      credentials: 'include',
    }).then(handle<T>);
  },
  // 名单 CSV 用原始字节上传（服务端做 UTF-8/GBK 探测，04 §10）。
  postCsv<T>(path: string, file: File): Promise<T> {
    return file.arrayBuffer().then((buffer) =>
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'text/csv', 'x-requested-with': 'proof-gym', 'x-pg-app': 'teacher' },
        credentials: 'include',
        body: buffer,
      }).then(handle<T>),
    );
  },
};
