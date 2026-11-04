/**
 * 事件批量上报的传输层（11 §3）。
 *
 * - 正常：POST /api/v1/events/batch（openapi servers 基路径 /api/v1），带 JSON 与 CSRF 兼容头
 *   X-Requested-With: proof-gym（06 §1 写接口要求）+ credentials include（HttpOnly Cookie pg_sid）。
 * - 页面隐藏/卸载：优先 fetch(keepalive:true)（能带 CSRF 头与 Cookie）；浏览器不支持/已失败时退回
 *   navigator.sendBeacon。注意：**sendBeacon 无法自定义请求头**，带不上 X-Requested-With；
 *   但 11 §3 要求隐藏时立即发，所以保留 beacon 兜底，发送失败的事件仍留在 IndexedDB 队列里，
 *   下次上报（带正确头）补发；服务端按事件 id 去重。真实接口联调时需确认服务端接受 beacon 变体
 *   （#24/#20 对齐；本 issue 不改契约）。
 */
import { EVENTS_BATCH_PATH, type ClientEvent } from './events'

export type FlushReason = 'threshold' | 'timer' | 'beacon' | 'manual' | 'online'

export interface SendOutcome {
  ok: boolean
  /** 网络/5xx/429 可重试；4xx（除 408/429）视为脏数据，丢弃避免死队列。 */
  retryable: boolean
  detail?: string
}

export interface SendOptions {
  beacon?: boolean
  reason?: FlushReason
}

export interface EventTransport {
  send(events: ClientEvent[], options?: SendOptions): Promise<SendOutcome>
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    credentials?: 'include' | 'same-origin' | 'omit'
    keepalive?: boolean
    body?: string
  },
) => Promise<{ ok: boolean; status: number }>

export type BeaconLike = (url: string, data?: Blob | string) => boolean

export interface FetchTransportOptions {
  url?: string
  fetchImpl?: FetchLike
  beaconImpl?: BeaconLike | null
  headers?: Record<string, string>
  credentials?: 'include' | 'same-origin' | 'omit'
}

/** 06 §1：写接口要带 X-Requested-With: proof-gym（配合 Cookie 的 CSRF 防护）。 */
export const EVENT_REQUEST_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'proof-gym',
}

export function createFetchTransport(options: FetchTransportOptions = {}): EventTransport {
  const url = options.url ?? EVENTS_BATCH_PATH
  const headers = { ...EVENT_REQUEST_HEADERS, ...options.headers }
  const credentials = options.credentials ?? 'include'
  const resolveFetch = (): FetchLike | null => {
    if (options.fetchImpl) return options.fetchImpl
    return typeof fetch === 'function' ? (fetch as unknown as FetchLike) : null
  }
  const resolveBeacon = (): BeaconLike | null => {
    if (options.beaconImpl !== undefined) return options.beaconImpl
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      return (target, data) => navigator.sendBeacon(target, data)
    }
    return null
  }

  async function post(events: ClientEvent[], keepalive: boolean): Promise<SendOutcome> {
    const fetchImpl = resolveFetch()
    if (!fetchImpl) return { ok: false, retryable: true, detail: 'fetch unavailable' }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        credentials,
        keepalive,
        body: JSON.stringify({ events }),
      })
      if (response.ok) return { ok: true, retryable: false }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      return { ok: false, retryable, detail: 'http ' + response.status }
    } catch (error) {
      return { ok: false, retryable: true, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    async send(events, opts = {}) {
      if (!opts.beacon) return post(events, false)
      // 卸载/隐藏时优先 keepalive fetch（能带 CSRF 头）；若已被浏览器中断再退回 sendBeacon。
      if (resolveFetch()) {
        const viaFetch = await post(events, true)
        if (viaFetch.ok || !viaFetch.retryable) return viaFetch
      }
      const beacon = resolveBeacon()
      if (!beacon) return { ok: false, retryable: true, detail: 'beacon unavailable' }
      try {
        const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' })
        const queued = beacon(url, blob)
        return queued
          ? { ok: true, retryable: false, detail: 'sendBeacon queued（无 CSRF 头）' }
          : { ok: false, retryable: true, detail: 'sendBeacon rejected' }
      } catch (error) {
        return { ok: false, retryable: true, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
