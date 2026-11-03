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

  it('204 返回 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.post('/api/v1/logout')).resolves.toBeUndefined();
  });
});
