import { describe, expect, it } from 'vitest'

import { ApiError, createHttpClient, newIdempotencyKey } from '@/api/http'

interface Call {
  url: string
  init: RequestInit
  body: unknown
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function captureFetch(responder: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const call: Call = { url, init, body }
    calls.push(call)
    return responder(call)
  }
  return { calls, fetchImpl }
}

function headersOf(call: Call): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

const KEY = '11111111-1111-4111-8111-111111111111'

describe('http 封装（issue #24）', () => {
  it('写请求带 X-Requested-With / JSON / If-Match / Idempotency-Key / credentials', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ state: { attemptId: 'a', stateVersion: 1 } }))
    const client = createHttpClient({ base: '/api/v1', fetchImpl })

    const result = await client.post('/attempts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/lines', { statement: 'x' }, {
      ifMatch: 7,
      idempotencyKey: KEY,
    })

    expect(calls).toHaveLength(1)
    const call = calls[0] as Call
    expect(call.url).toBe('/api/v1/attempts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/lines')
    expect(call.init.method).toBe('POST')
    expect(call.init.credentials).toBe('include')
    expect(call.body).toEqual({ statement: 'x' })
    const headers = headersOf(call)
    expect(headers['X-Requested-With']).toBe('proof-gym')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['If-Match']).toBe('7')
    expect(headers['Idempotency-Key']).toBe(KEY)
    expect(result.data).toEqual({ state: { attemptId: 'a', stateVersion: 1 } })
    expect(result.replayed).toBe(false)
  })

  it('GET 不带写请求头，也不带 If-Match', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ state: 'ok' }))
    const client = createHttpClient({ base: '/api/v1', fetchImpl })
    await client.get('/attempts/x')
    const call = calls[0] as Call
    expect(call.init.method).toBe('GET')
    expect(call.init.body).toBeUndefined()
    const headers = headersOf(call)
    expect(headers['X-Requested-With']).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers['If-Match']).toBeUndefined()
  })

  it('识别 Idempotent-Replayed 响应头', async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ state: {} }, 200, { 'idempotent-replayed': 'true' }))
    const client = createHttpClient({ base: '/api/v1', fetchImpl })
    const result = await client.post('/x', {})
    expect(result.replayed).toBe(true)
  })

  const errorCases: Array<{ status: number; code: string; message: string; terminal: boolean }> = [
    { status: 401, code: 'UNAUTHORIZED', message: '请先登录', terminal: true },
    { status: 403, code: 'CONSENT_REQUIRED', message: '请先阅读并签署知情同意书', terminal: true },
    { status: 409, code: 'ASSIGNMENT_CLOSED', message: '布置已关闭，作答为只读', terminal: true },
    { status: 409, code: 'ATTEMPT_LOCKED', message: '本题已锁定，请联系老师', terminal: true },
    { status: 422, code: 'VALIDATION_FAILED', message: '内容太短或不完整', terminal: true },
    { status: 429, code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试', terminal: false },
    { status: 500, code: 'INTERNAL', message: '出了点问题，你的内容已保存', terminal: false },
  ]
  for (const errorCase of errorCases) {
    it(`错误映射：${errorCase.status} ${errorCase.code}（terminal=${errorCase.terminal}）`, async () => {
      const { fetchImpl } = captureFetch(() => jsonResponse({ error: { code: errorCase.code, message: errorCase.message } }, errorCase.status))
      const client = createHttpClient({ base: '/api/v1', fetchImpl })
      const error = (await client.get('/x').catch((reason: unknown) => reason)) as ApiError
      expect(error).toBeInstanceOf(ApiError)
      expect(error.status).toBe(errorCase.status)
      expect(error.code).toBe(errorCase.code)
      expect(error.message).toBe(errorCase.message)
      expect(error.terminal).toBe(errorCase.terminal)
      expect(error.retryable).toBe(errorCase.status === 429 || errorCase.status >= 500)
    })
  }

  it('409 STATE_STALE：保留 detail.state 供上层覆盖，且不标为终态', async () => {
    const latest = { attemptId: 'a', stateVersion: 8 }
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ error: { code: 'STATE_STALE', message: '状态已更新', detail: { state: latest } } }, 409),
    )
    const client = createHttpClient({ base: '/api/v1', fetchImpl })
    const error = (await client.post('/x', {}).catch((reason: unknown) => reason)) as ApiError
    expect(error.code).toBe('STATE_STALE')
    expect(error.terminal).toBe(false)
    expect(error.retryable).toBe(false)
    expect(error.staleState).toEqual(latest)
  })

  it('网络失败映射为 NETWORK，可重试、非终态', async () => {
    const client = createHttpClient({
      base: '/api/v1',
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    const error = (await client.get('/x').catch((reason: unknown) => reason)) as ApiError
    expect(error.code).toBe('NETWORK')
    expect(error.retryable).toBe(true)
    expect(error.terminal).toBe(false)
    expect(error.detail?.cause).toBe('offline')
  })

  it('非 JSON 错误体按状态码回退；204 返回 undefined', async () => {
    const errorClient = createHttpClient({
      base: '/api/v1',
      fetchImpl: async () => new Response('bad gateway', { status: 502 }),
    })
    const error = (await errorClient.get('/x').catch((reason: unknown) => reason)) as ApiError
    expect(error.code).toBe('INTERNAL')
    expect(error.status).toBe(502)

    const emptyClient = createHttpClient({ base: '/api/v1', fetchImpl: async () => new Response(null, { status: 204 }) })
    await expect(emptyClient.post('/auth/logout')).resolves.toMatchObject({ data: undefined, status: 204 })
  })

  it('非法幂等键在发请求前拒绝', async () => {
    let called = false
    const client = createHttpClient({
      base: '/api/v1',
      fetchImpl: async () => {
        called = true
        return jsonResponse({})
      },
    })
    await expect(client.post('/x', {}, { idempotencyKey: 'not-a-uuid' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(called).toBe(false)
  })

  it('newIdempotencyKey 返回 uuid', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})