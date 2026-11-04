/**
 * mock 模式的事件接收器（#27 验收用，不依赖后端）：
 * 队列 flush 时把批次写进内存数组，并挂到 window.__PG_EVENTS__ 供 e2e 断言；
 * 真实模式（USE_MOCK=false / 非 mock 构建）不安装这个调试对象。
 *
 * 注意：只保存事件（不含 token/PII），页面刷新即清空。
 */
import type { ClientEvent } from './events'
import type { EventTransport } from './transport'

export interface RecordedBatch {
  events: ClientEvent[]
  via: string
  at: string
}

export interface MockEventSink {
  batches: RecordedBatch[]
  record(events: ClientEvent[], via: string): void
  allEvents(): ClientEvent[]
  clear(): void
}

export function createMockEventSink(now: () => number = Date.now): MockEventSink {
  const batches: RecordedBatch[] = []
  return {
    batches,
    record(events, via) {
      batches.push({
        events: events.map((event) => ({ ...event, payload: { ...event.payload } })),
        via,
        at: new Date(now()).toISOString(),
      })
    },
    allEvents() {
      return batches.flatMap((batch) => batch.events)
    },
    clear() {
      batches.length = 0
    },
  }
}

/** mock 模式：传输层成功落内存（不再发网络请求）。 */
export function createMockTransport(sink: MockEventSink): EventTransport {
  return {
    async send(events, options = {}) {
      sink.record(events, options.reason ?? (options.beacon ? 'beacon' : 'timer'))
      return { ok: true, retryable: false }
    },
  }
}

export interface MockEventsDebugApi {
  batches: RecordedBatch[]
  events: () => ClientEvent[]
  flush: (reason?: string) => Promise<void>
}

/** 只在 mock 构建里调用；e2e 通过 page.evaluate 读取 __PG_EVENTS__.batches。 */
export function installMockEventDebug(sink: MockEventSink, flush: (reason?: string) => Promise<void>): void {
  if (typeof window === 'undefined') return
  const api: MockEventsDebugApi = {
    batches: sink.batches,
    events: () => sink.allEvents(),
    flush,
  }
  ;(window as unknown as { __PG_EVENTS__?: MockEventsDebugApi }).__PG_EVENTS__ = api
}

export function isMockMode(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env
    return env?.VITE_ENABLE_MOCK === '1' || Boolean(env?.DEV)
  } catch {
    return false
  }
}
