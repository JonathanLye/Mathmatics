import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('api client（06 §1）', () => {
  it('POST 带 JSON content-type、CSRF 头与 credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.post<{ ok: boolean }>('/api/v1/x', { a: 1 });
    expect(result.ok).toBe(true);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(headers['x-requested-with']).toBe('proof-gym');
    expect(headers['content-type']).toBe('application/json');
  });

  it('GET 不带 CSRF 头', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await api.get('/api/v1/teacher/classes');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-requested-with']).toBeUndefined();
  });

  it('错误 envelope 解析为 ApiError（code/status/message/detail）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'VALIDATION_FAILED', message: '参数不合法', detail: { reason: 'x' } } }, 422),
      ),
    );

    await expect(api.get('/api/v1/x')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: '参数不合法',
      detail: { reason: 'x' },
    });
  });

  it('401 派发 pg:unauthorized 事件（shell 统一跳登录）', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    let hits = 0;
    target.addEventListener('pg:unauthorized', () => {
      hits += 1;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401)),
    );

    await expect(api.get('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(hits).toBe(1);
  });

  it('每个请求都带 X-Pg-App: teacher（/me、退出据此读教师 Cookie）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.get('/api/v1/me');
    await api.post('/api/v1/auth/logout');
    await api.patch('/api/v1/x', {});
    await api.delete('/api/v1/x');
    await api.postCsv('/api/v1/x', new File(['a'], 'a.csv'));
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(5);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>)['x-pg-app']).toBe('teacher');
    }
  });

  it('403 且服务端标明 wrong_app（只登录了学生端）：和 401 一样派发 pg:unauthorized', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    let hits = 0;
    target.addEventListener('pg:unauthorized', () => {
      hits += 1;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'FORBIDDEN', message: '需要教师账号', detail: { reason: 'wrong_app' } } }, 403),
      ),
    );

    await expect(api.get('/api/v1/teacher/classes')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(hits).toBe(1);
  });

  it('业务 403（没有 wrong_app 标记）照常抛给页面就地显示，不触发跳登录', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    let hits = 0;
    target.addEventListener('pg:unauthorized', () => {
      hits += 1;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'FORBIDDEN', message: '管理员补发暂不支持' } }, 403)),
    );

    await expect(api.post('/api/v1/teacher/attempts/x/unlock', {})).rejects.toMatchObject({ message: '管理员补发暂不支持' });
    expect(hits).toBe(0);
  });

  it('204 返回 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.post('/api/v1/logout')).resolves.toBeUndefined();
  });
});
