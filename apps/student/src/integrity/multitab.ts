/**
 * 多标签页检测（11 §3）：BroadcastChannel('attempt:<id>') 互相 ping，上报 integ.multitab{tabs}。
 *
 * - 只发随机 tabId 与时间戳，无 PII；
 * - 同一标签数只报一次（去重），心跳 2 秒、6 秒没心跳视为离开；
 * - 测试可注入 fake channel（见 tests/integrity-multitab.test.ts）。
 */
import { uuidv7 } from './ids'

export interface TabChannelLike {
  postMessage(message: unknown): void
  close?: () => void
  onmessage: ((event: { data: unknown }) => void) | null
}

export interface MultitabMessage {
  tab: string
  at: number
  kind: 'hello' | 'ping' | 'bye'
}

export interface MultitabMonitorOptions {
  channel: TabChannelLike
  report: (tabs: number) => void
  now?: () => number
  tabId?: string
  heartbeatMs?: number
  staleMs?: number
  setIntervalImpl?: (fn: () => void, ms: number) => unknown
  clearIntervalImpl?: (id: unknown) => void
}

export class MultitabMonitor {
  private readonly channel: TabChannelLike
  private readonly report: (tabs: number) => void
  private readonly now: () => number
  private readonly tabId: string
  private readonly heartbeatMs: number
  private readonly staleMs: number
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown
  private readonly clearIntervalImpl: (id: unknown) => void
  private readonly peers = new Map<string, number>()
  private timer: unknown = null
  private lastReported = 0
  private started = false

  constructor(options: MultitabMonitorOptions) {
    this.channel = options.channel
    this.report = options.report
    this.now = options.now ?? Date.now
    this.tabId = options.tabId ?? uuidv7()
    this.heartbeatMs = options.heartbeatMs ?? 2000
    this.staleMs = options.staleMs ?? 6000
    this.setIntervalImpl = options.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalImpl = options.clearIntervalImpl ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>))
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.channel.onmessage = (event) => this.handleMessage(event.data)
    this.channel.postMessage(this.message('hello'))
    this.timer = this.setIntervalImpl(() => this.tick(), this.heartbeatMs)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.channel.postMessage(this.message('bye'))
    this.channel.onmessage = null
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer)
      this.timer = null
    }
    this.peers.clear()
  }

  tabCount(): number {
    this.prune()
    return this.peers.size + 1
  }

  handleMessage(data: unknown): void {
    const message = data as Partial<MultitabMessage> | null
    if (!message || typeof message.tab !== 'string' || !message.tab || message.tab === this.tabId) return
    if (typeof message.at !== 'number' || !Number.isFinite(message.at)) return
    if (message.kind === 'bye') {
      this.peers.delete(message.tab)
    } else {
      this.peers.set(message.tab, this.now())
      if (message.kind === 'hello') this.channel.postMessage(this.message('ping'))
    }
    this.emit()
  }

  private tick(): void {
    this.prune()
    this.channel.postMessage(this.message('ping'))
    this.emit()
  }

  private prune(): void {
    const threshold = this.now() - this.staleMs
    for (const [tab, seenAt] of Array.from(this.peers.entries())) {
      if (seenAt < threshold) this.peers.delete(tab)
    }
  }

  private emit(): void {
    const tabs = this.tabCount()
    if (tabs > 1 && tabs !== this.lastReported) {
      this.lastReported = tabs
      this.report(tabs)
    }
  }

  private message(kind: MultitabMessage['kind']): MultitabMessage {
    return { tab: this.tabId, at: this.now(), kind }
  }
}

/** BroadcastChannel 可用就用；否则退回「uni 存储 + window.storage 事件」。 */
export function createDefaultTabChannel(name: string): TabChannelLike | null {
  if (typeof BroadcastChannel === 'function') {
    return new BroadcastChannel(name) as unknown as TabChannelLike
  }
  if (typeof window === 'undefined') return null
  let onmessage: TabChannelLike['onmessage'] = null
  const storageKey = 'pg_tab_' + name
  const listener = (event: StorageEvent): void => {
    if (!event.key || event.key !== storageKey || !event.newValue) return
    try {
      onmessage?.({ data: JSON.parse(event.newValue) })
    } catch {
      /* 非法消息忽略 */
    }
  }
  window.addEventListener('storage', listener)
  return {
    postMessage(message) {
      try {
        const api = (globalThis as { uni?: { setStorageSync?: (key: string, value: unknown) => void } }).uni
        const value = JSON.stringify(message)
        if (api?.setStorageSync) api.setStorageSync(storageKey, value)
        else window.localStorage.setItem(storageKey, value)
      } catch {
        /* ignore */
      }
    },
    close() {
      window.removeEventListener('storage', listener)
    },
    get onmessage() {
      return onmessage
    },
    set onmessage(handler) {
      onmessage = handler
    },
  }
}
