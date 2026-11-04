/**
 * 事件队列（11 §3）：先进内存队列，每 5 秒或满 20 条批量上报；
 * 页面隐藏/卸载用 keepalive fetch 立即发（sendBeacon 无 CSRF 头，不用）；失败（网络/5xx/429）保留并持久化到 IndexedDB，恢复后重试。
 *
 * 设计要点：
 * - 每批 ≤ 100 条（openapi）；发送失败的事件 id 不变（服务端按 id 去重）。
 * - 串行发送（chain），避免定时器与 threshold/online 同时 flush 造成重复批次。
 * - 永不抛未处理异常：transport 失败只会进入重试队列。
 */
import type { KeyValueStore } from '@/storage/types'
import type { ClientEvent } from './events'
import type { EventTransport, FlushReason, SendOutcome } from './transport'

export interface EventQueueOptions {
  transport: EventTransport
  maxBatch?: number
  flushIntervalMs?: number
  now?: () => number
  setIntervalImpl?: (fn: () => void, ms: number) => unknown
  clearIntervalImpl?: (id: unknown) => void
  store?: KeyValueStore | null
  storageKey?: string
  onFlushed?: (batch: ClientEvent[], outcome: SendOutcome, reason: FlushReason) => void
  onDropped?: (batch: ClientEvent[], outcome: SendOutcome) => void
}

export const DEFAULT_FLUSH_INTERVAL_MS = 5000
export const DEFAULT_MAX_BATCH = 20

export class EventQueue {
  private readonly transport: EventTransport
  private readonly maxBatch: number
  private readonly flushIntervalMs: number
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown
  private readonly clearIntervalImpl: (id: unknown) => void
  private readonly store: KeyValueStore | null
  private readonly storageKey: string
  private readonly onFlushed?: EventQueueOptions['onFlushed']
  private readonly onDropped?: EventQueueOptions['onDropped']
  private bus: ClientEvent[] = []
  private timer: unknown = null
  private online = true
  private chain: Promise<void> = Promise.resolve()
  private persistedOnce = false

  constructor(options: EventQueueOptions) {
    this.transport = options.transport
    this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this.setIntervalImpl = options.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalImpl = options.clearIntervalImpl ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>))
    this.store = options.store ?? null
    this.storageKey = options.storageKey ?? 'integrity:pending-events'
    this.onFlushed = options.onFlushed
    this.onDropped = options.onDropped
  }

  size(): number {
    return this.bus.length
  }

  isOnline(): boolean {
    return this.online
  }

  /** 启动 5 秒定时 flush；同时恢复 IndexedDB 里上次没发出去的事件。 */
  start(): void {
    if (this.timer === null) {
      this.timer = this.setIntervalImpl(() => {
        if (this.bus.length > 0) void this.flush('timer')
      }, this.flushIntervalMs)
    }
    void this.hydrate()
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer)
      this.timer = null
    }
  }

  hydrate(): Promise<void> {
    if (this.persistedOnce || !this.store) return Promise.resolve()
    this.persistedOnce = true
    return this.store
      .get<ClientEvent[]>(this.storageKey)
      .then((stored) => {
        if (!Array.isArray(stored) || stored.length === 0) return
        const known = new Set(this.bus.map((event) => event.id))
        for (const event of stored) {
          if (event && typeof event.id === 'string' && !known.has(event.id)) {
            known.add(event.id)
            this.bus.unshift(event)
          }
        }
      })
      .catch(() => {
        /* 读不到就空队列启动 */
      })
  }

  enqueue(event: ClientEvent): void {
    this.bus.push(event)
    this.persist()
    if (this.bus.length >= this.maxBatch) void this.flush('threshold')
  }

  setOnline(online: boolean): void {
    this.online = online
    if (online && this.bus.length > 0) void this.flush('online')
  }

  /** 网页隐藏/卸载时调用：立即发（优先 keepalive fetch，退化 sendBeacon）。 */
  flushBeacon(): Promise<void> {
    if (this.bus.length === 0 && !this.store) return Promise.resolve()
    return this.flush('beacon', { beacon: true })
  }

  /** 串行 flush；返回时本次已处理完当前可发批次（失败则保留）。 */
  flush(reason: FlushReason = 'manual', options: { beacon?: boolean } = {}): Promise<void> {
    const run = this.chain.then(() => this.flushOnce(reason, options))
    this.chain = run.catch(() => {
      /* 队列内部兜底，不向外抛 */
    })
    return run.catch(() => {
      /* 永不抛未处理异常 */
    })
  }

  private async flushOnce(reason: FlushReason, options: { beacon?: boolean }): Promise<void> {
    if (!this.online && !options.beacon) return
    for (;;) {
      const batch = this.bus.slice(0, this.maxBatch)
      if (batch.length === 0) return
      let outcome: SendOutcome
      try {
        outcome = await this.transport.send(batch, { beacon: options.beacon, reason })
      } catch (error) {
        outcome = { ok: false, retryable: true, detail: error instanceof Error ? error.message : String(error) }
      }
      this.onFlushed?.(batch, outcome, reason)
      if (outcome.ok) {
        this.removeByIds(batch)
        this.persist()
        continue
      }
      if (!outcome.retryable) {
        this.onDropped?.(batch, outcome)
        this.removeByIds(batch)
        this.persist()
        continue
      }
      // 可重试：留在队列，等 5 秒定时器 / online / 下次隐藏再发
      this.persist()
      return
    }
  }

  private removeByIds(batch: ClientEvent[]): void {
    const ids = new Set(batch.map((event) => event.id))
    this.bus = this.bus.filter((event) => !ids.has(event.id))
  }

  private persist(): void {
    if (!this.store) return
    void this.store.set(this.storageKey, this.bus).catch(() => {
      /* 配额/隐私模式：内存队列仍可继续，不影响作答 */
    })
  }
}
