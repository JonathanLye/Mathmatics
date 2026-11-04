/**
 * 事件批量上报的传输层（11 §3）。
 *
 * - 正常：POST /api/v1/events/batch（openapi servers 基路径 /api/v1），带 JSON 与 CSRF 兼容头
 *   X-Requested-With: proof-gym（06 §1 写接口要求）+ credentials include（HttpOnly Cookie pg_sid）。
 * - 页面隐藏/卸载：优先 fetch(keepalive:true)（能带 CSRF 头与 Cookie）。
 *   **不使用 navigator.sendBeacon 兜底**：服务端 CSRF 中间件要求 X-Requested-With，而 sendBeacon
 *   无法自定义请求头，发出会被 403；浏览器仍返回"已排队"，若按成功处理会丢事件（PR #119 复审 P2）。
 *   keepalive fetch 失败时返回 retryable，由队列持久化到 IndexedDB，下次带正确头补发。
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

export interface FetchTransportOptions {
  url?: string
  fetchImpl?: FetchLike
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
      // 页面隐藏/卸载：只走 keepalive fetch（能带 CSRF 头与 Cookie），不回退 sendBeacon。
      const viaFetch = await post(events, true)
      if (viaFetch.ok) return viaFetch
      return {
        ok: false,
        retryable: true,
        detail:
          'keepalive fetch failed on hide; events kept for retry (sendBeacon cannot carry CSRF header)',
      }
    },
  }
}
