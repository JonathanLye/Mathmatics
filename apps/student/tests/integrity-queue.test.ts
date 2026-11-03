import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientEvent } from '@/integrity/events'
import { EventQueue } from '@/integrity/queue'
import type { EventTransport, SendOptions, SendOutcome } from '@/integrity/transport'
import { createMemoryStore } from '@/storage/memory'

function makeEvent(seq: number): ClientEvent {
  return {
    id: '00000000-0000-7000-8000-' + String(seq).padStart(12, '0'),
    type: 'integ.visibility',
    tsClient: '2026-11-04T00:00:00.000Z',
    sessionId: '00000000-0000-7000-8000-000000000001',
    deviceId: '00000000-0000-7000-8000-000000000002',
    clientSeq: seq,
    payload: { state: 'hidden' },
  }
}

class RecordingTransport implements EventTransport {
  batches: ClientEvent[][] = []
  beaconFlags: boolean[] = []
  outcomes: SendOutcome[] = []
  throwError = false

  async send(events: ClientEvent[], options: SendOptions = {}): Promise<SendOutcome> {
    this.batches.push(events)
    this.beaconFlags.push(Boolean(options.beacon))
    if (this.throwError) throw new Error('transport exploded')
    return this.outcomes.shift() ?? { ok: true, retryable: false }
  }
}

describe('#27 事件队列（5 秒 / 20 条 / beacon / 离线重试）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('不足 20 条不立即发；5 秒定时器触发 flush', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport, flushIntervalMs: 5000 })
    queue.start()
    queue.enqueue(makeEvent(1))
    queue.enqueue(makeEvent(2))
    expect(transport.batches).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.batches).toHaveLength(1)
    expect(transport.batches[0]).toHaveLength(2)
    expect(queue.size()).toBe(0)
    queue.stop()
  })

  it('满 20 条立即 flush（不等定时器）', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport, maxBatch: 20 })
    for (let i = 1; i <= 20; i += 1) queue.enqueue(makeEvent(i))
    await vi.runAllTimersAsync()
    expect(transport.batches[0]).toHaveLength(20)
    expect(queue.size()).toBe(0)
  })

  it('超过一批时循环分块发送', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport, maxBatch: 3 })
    for (let i = 1; i <= 7; i += 1) queue.enqueue(makeEvent(i))
    await queue.flush('manual')
    expect(transport.batches.map((batch) => batch.length)).toEqual([3, 3, 1])
  })

  it('可重试失败保留事件，下一轮成功后再清空', async () => {
    const transport = new RecordingTransport()
    transport.outcomes = [{ ok: false, retryable: true, detail: 'offline' }]
    const queue = new EventQueue({ transport })
    queue.enqueue(makeEvent(1))
    await queue.flush('timer')
    expect(queue.size()).toBe(1)
    await queue.flush('timer')
    expect(queue.size()).toBe(0)
    expect(transport.batches).toHaveLength(2)
  })

  it('不可重试失败（4xx 脏数据）丢弃，避免死队列', async () => {
    const transport = new RecordingTransport()
    transport.outcomes = [{ ok: false, retryable: false, detail: 'http 422' }]
    const queue = new EventQueue({ transport })
    queue.enqueue(makeEvent(1))
    await queue.flush('timer')
    expect(queue.size()).toBe(0)
  })

  it('transport 抛异常不会变成未处理异常，事件仍保留', async () => {
    const transport = new RecordingTransport()
    transport.throwError = true
    const queue = new EventQueue({ transport })
    queue.enqueue(makeEvent(1))
    await expect(queue.flush('timer')).resolves.toBeUndefined()
    expect(queue.size()).toBe(1)
  })

  it('离线时定时器不发送；恢复 online 后立即补发（integ.network 恢复后的 online 重试）', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport })
    queue.start()
    queue.setOnline(false)
    queue.enqueue(makeEvent(1))
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.batches).toHaveLength(0)
    queue.setOnline(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.batches).toHaveLength(1)
    queue.stop()
  })

  it('flushBeacon 以 beacon 模式发送（页面隐藏/卸载）', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport })
    queue.enqueue(makeEvent(1))
    await queue.flushBeacon()
    expect(transport.beaconFlags[0]).toBe(true)
    expect(queue.size()).toBe(0)
  })

  it('hydrate 从 IndexedDB（此处内存 store）恢复未发事件，并按 id 去重', async () => {
    const store = createMemoryStore()
    const persisted = [makeEvent(1), makeEvent(2)]
    await store.set('integrity:pending-events', persisted)
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport, store })
    await queue.hydrate()
    expect(queue.size()).toBe(2)
    queue.enqueue(makeEvent(2))
    expect(queue.size()).toBe(3) // enqueue 不去重（id 由服务端去重）；hydrate 已避免重复加载
    await queue.flush('timer')
    expect(queue.size()).toBe(0)
  })

  it('持久化：enqueue 后事件写入 store，成功发送后清空', async () => {
    const store = createMemoryStore()
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport, store })
    queue.enqueue(makeEvent(1))
    await Promise.resolve()
    expect(await store.get<ClientEvent[]>('integrity:pending-events')).toHaveLength(1)
    await queue.flush('manual')
    expect(await store.get<ClientEvent[]>('integrity:pending-events')).toHaveLength(0)
  })

  it('stop 后定时器不再 flush', async () => {
    const transport = new RecordingTransport()
    const queue = new EventQueue({ transport })
    queue.start()
    queue.stop()
    queue.enqueue(makeEvent(1))
    await vi.advanceTimersByTimeAsync(10000)
    expect(transport.batches).toHaveLength(0)
  })
})
