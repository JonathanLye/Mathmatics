import { describe, expect, it } from 'vitest'
import { createFetchTransport, EVENT_REQUEST_HEADERS, type FetchLike } from '@/integrity/transport'
import type { ClientEvent } from '@/integrity/events'

function event(seq: number): ClientEvent {
  return {
    id: '00000000-0000-7000-8000-00000000000' + seq,
    type: 'integ.visibility',
    tsClient: '2026-11-04T00:00:00.000Z',
    sessionId: '00000000-0000-7000-8000-000000000001',
    deviceId: '00000000-0000-7000-8000-000000000002',
    clientSeq: seq,
    payload: { state: 'hidden' },
  }
}

interface Call {
  url: string
  init?: { method?: string; headers?: Record<string, string>; credentials?: string; keepalive?: boolean; body?: string }
}

describe('#27 传输层（POST /api/v1/events/batch）', () => {
  it('fetch 正常路径：URL/方法/JSON/CSRF 头/credentials 正确', async () => {
    const calls: Call[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200 }
    }
    const transport = createFetchTransport({ fetchImpl })
    const outcome = await transport.send([event(1)])
    expect(outcome.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/v1/events/batch')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.credentials).toBe('include')
    expect(calls[0]?.init?.headers).toMatchObject(EVENT_REQUEST_HEADERS)
    expect(calls[0]?.init?.headers?.['X-Requested-With']).toBe('proof-gym')
    expect(JSON.parse(calls[0]?.init?.body ?? '{}').events).toHaveLength(1)
    expect(calls[0]?.init?.keepalive).toBe(false)
  })

  it('429 / 5xx / 网络错误可重试；400 不可重试（丢弃脏数据）', async () => {
    const status = (code: number): FetchLike => async () => ({ ok: false, status: code })
    expect(await createFetchTransport({ fetchImpl: status(429) }).send([event(1)])).toMatchObject({ ok: false, retryable: true })
    expect(await createFetchTransport({ fetchImpl: status(503) }).send([event(1)])).toMatchObject({ ok: false, retryable: true })
    expect(await createFetchTransport({ fetchImpl: status(422) }).send([event(1)])).toMatchObject({ ok: false, retryable: false })
    const networkError: FetchLike = async () => {
      throw new Error('offline')
    }
    expect(await createFetchTransport({ fetchImpl: networkError }).send([event(1)])).toMatchObject({ ok: false, retryable: true })
  })

  it('beacon 路径优先 fetch keepalive（能带 CSRF 头）', async () => {
    const calls: Call[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200 }
    }
    let beaconCalls = 0
    const transport = createFetchTransport({ fetchImpl, beaconImpl: () => { beaconCalls += 1; return true } })
    const outcome = await transport.send([event(1)], { beacon: true })
    expect(outcome.ok).toBe(true)
    expect(beaconCalls).toBe(0)
    expect(calls[0]?.init?.keepalive).toBe(true)
    expect(calls[0]?.init?.headers?.['X-Requested-With']).toBe('proof-gym')
  })

  it('keepalive fetch 失败时退回 sendBeacon（JSON Blob；注释说明无 CSRF 头）', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('page unloading')
    }
    const beaconArgs: Array<{ url: string; data?: Blob | string }> = []
    const transport = createFetchTransport({
      fetchImpl,
      beaconImpl: (url, data) => {
        beaconArgs.push({ url, data })
        return true
      },
    })
    const outcome = await transport.send([event(1)], { beacon: true })
    expect(outcome.ok).toBe(true)
    expect(beaconArgs).toHaveLength(1)
    expect(beaconArgs[0]?.url).toBe('/api/v1/events/batch')
    expect(beaconArgs[0]?.data).toBeInstanceOf(Blob)
    expect((beaconArgs[0]?.data as Blob).type).toBe('application/json')
  })

  it('sendBeacon 返回 false / 不可用 → 可重试（事件留队列下次补发）', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('no fetch on unload')
    }
    expect(await createFetchTransport({ fetchImpl, beaconImpl: () => false }).send([event(1)], { beacon: true })).toMatchObject({ ok: false, retryable: true })
    expect(await createFetchTransport({ fetchImpl, beaconImpl: null }).send([event(1)], { beacon: true })).toMatchObject({ ok: false, retryable: true })
  })
})
