/**
 * 教师镜像页的 SSE 客户端（issue #43 A 侧 / 04 §5.1 / 06 §6）。
 *
 * - 数据：`GET /api/v1/teacher/attempts/{attemptId}/stream?token=…`，
 *   `event: state`（data=学生视图 AttemptState）、`event: ping`（20s）；id=stateVersion。
 * - 只渲染服务端 state，不在前端做任何判定；stateVersion 单调（旧帧不覆盖新帧）。
 * - 断线指数退避重连（次数/上限可配）；EventSource 出错时关掉再新建，因此不会自动带 Last-Event-ID
 *   （构造器无法设 header），重连后服务端会重发完整 state，镜像最终收敛到最新状态。
 * - 401/404：浏览器 EventSource 只给 error、不给 HTTP 状态；连续 N 次失败且从未收到 state 时标记 auth 可疑，
 *   页面提示「令牌可能已过期或无权访问」，持续重试到上限后 failed。
 * - 不依赖 Vue/DOM（除页面注入的 EventSource 工厂），可直接用 fake EventSource 单测。
 */
import type { AttemptState } from '@/types/attempt'
import { parseSseData } from './mirror'

export type MirrorConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed'

export type MirrorStatusDetail = 'network' | 'auth' | null

/** EventSource 的最小接口面（单测注入 fake；真实页面用浏览器原生 EventSource）。 */
export interface MirrorEventSourceLike {
  addEventListener(type: string, listener: (event: unknown) => void): void
  close(): void
}

export interface MirrorStreamStatusInfo {
  status: MirrorConnectionStatus
  detail: MirrorStatusDetail
  attempts: number
  /** 是否已经收到过至少一帧 state（用于区分「首连失败」与「已连上后断线」）。 */
  receivedState: boolean
  lastEventId: string | null
}

export interface MirrorStreamOptions {
  url: string
  /** 浏览器里传 (url) => new EventSource(url)；单测传 fake 工厂。 */
  createEventSource: (url: string) => MirrorEventSourceLike
  onState: (state: AttemptState) => void
  onStatus?: (info: MirrorStreamStatusInfo) => void
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** 最多重连次数（不含首次连接）。 */
  maxReconnectAttempts?: number
  /** 从未收到 state 时，连续失败多少次开始提示「令牌过期/无权限」可疑。 */
  authSuspectAttempts?: number
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (id: unknown) => void
  now?: () => number
}

export interface MirrorStreamHandle {
  close: () => void
  status: () => MirrorConnectionStatus
  attempts: () => number
  lastEventId: () => string | null
}

/** 构造 SSE 相对地址（iframe 在 token 场景下是 opaque origin，但文档 URL 仍是学生 H5，相对路径可用）。 */
export function buildMirrorStreamUrl(attemptId: string, token: string): string {
  return (
    '/api/v1/teacher/attempts/' +
    encodeURIComponent(attemptId) +
    '/stream?token=' +
    encodeURIComponent(token)
  )
}

/** 指数退避：attempt 从 1 开始（第一次失败后的等待），base * 2^(attempt-1)，封顶 max。 */
export function reconnectDelay(attempt: number, baseMs = 800, maxMs = 8000): number {
  const n = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1))
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 800
  const cap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 8000
  return Math.min(cap, base * 2 ** (n - 1))
}

/** 只接受「像 AttemptState」的数据：必须有 attemptId/stateVersion/problem/layers（不信任坏帧）。 */
export function isReadonlyAttemptState(value: unknown): value is AttemptState {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<AttemptState>
  return (
    typeof candidate.attemptId === 'string' &&
    candidate.attemptId.length > 0 &&
    typeof candidate.stateVersion === 'number' &&
    Number.isFinite(candidate.stateVersion) &&
    candidate.problem !== null &&
    typeof candidate.problem === 'object' &&
    typeof (candidate.problem as { title?: unknown }).title === 'string' &&
    Array.isArray(candidate.layers)
  )
}

/** SSE data → AttemptState；非法 JSON/形状返回 null（心跳或坏帧不打断镜像）。 */
export function parseMirrorStateMessage(data: unknown): AttemptState | null {
  if (typeof data !== 'string') return null
  const parsed = parseSseData<unknown>(data)
  return isReadonlyAttemptState(parsed) ? parsed : null
}

/** stateVersion 单调：只接受版本 >= 当前状态的帧（镜像只需要最新状态）。 */
export function shouldApplyMirrorState(current: AttemptState | null, next: AttemptState): boolean {
  if (!current) return true
  return next.stateVersion >= current.stateVersion
}

function messageEventData(event: unknown): string | null {
  if (event !== null && typeof event === 'object' && 'data' in event) {
    const data = (event as { data?: unknown }).data
    return typeof data === 'string' ? data : null
  }
  return null
}

function messageEventId(event: unknown): string | null {
  if (event !== null && typeof event === 'object' && 'lastEventId' in event) {
    const id = (event as { lastEventId?: unknown }).lastEventId
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  return null
}

/** 创建镜像 SSE 连接控制器（可关闭；自动重连）。 */
export function createMirrorStream(options: MirrorStreamOptions): MirrorStreamHandle {
  const reconnectBaseMs = options.reconnectBaseMs ?? 800
  const reconnectMaxMs = options.reconnectMaxMs ?? 8000
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 6
  const authSuspectAttempts = options.authSuspectAttempts ?? 2
  const setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimeoutImpl = options.clearTimeoutImpl ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  let status: MirrorConnectionStatus = 'connecting'
  let detail: MirrorStatusDetail = null
  let attempts = 0
  let closedByUser = false
  let receivedState = false
  let current: AttemptState | null = null
  let lastEventId: string | null = null
  let source: MirrorEventSourceLike | null = null
  let timer: unknown = null

  function emitStatus(): void {
    options.onStatus?.({ status, detail, attempts, receivedState, lastEventId })
  }

  function setStatus(next: MirrorConnectionStatus, nextDetail: MirrorStatusDetail = null): void {
    status = next
    detail = nextDetail
    emitStatus()
  }

  function closeSource(): void {
    if (source) {
      try {
        source.close()
      } catch {
        /* ignore */
      }
      source = null
    }
    if (timer !== null) {
      clearTimeoutImpl(timer)
      timer = null
    }
  }

  function applyState(raw: unknown): void {
    const next = parseMirrorStateMessage(messageEventData(raw))
    if (!next || !shouldApplyMirrorState(current, next)) return
    current = next
    receivedState = true
    attempts = 0
    setStatus('connected')
    options.onState(next)
  }

  function scheduleReconnect(): void {
    attempts += 1
    if (attempts > maxReconnectAttempts) {
      setStatus('failed', receivedState ? 'network' : 'auth')
      return
    }
    const suspectAuth = !receivedState && attempts >= authSuspectAttempts
    setStatus('reconnecting', suspectAuth ? 'auth' : 'network')
    timer = setTimeoutImpl(() => {
      timer = null
      open()
    }, reconnectDelay(attempts, reconnectBaseMs, reconnectMaxMs))
  }

  function onError(): void {
    if (closedByUser) return
    closeSource()
    scheduleReconnect()
  }

  function open(): void {
    if (closedByUser) return
    setStatus(attempts === 0 ? 'connecting' : 'reconnecting', detail)
    let next: MirrorEventSourceLike
    try {
      next = options.createEventSource(options.url)
    } catch {
      onError()
      return
    }
    source = next
    next.addEventListener('open', () => {
      if (closedByUser) return
      lastEventId = lastEventId ?? null
      setStatus('connected')
    })
    next.addEventListener('state', (event) => {
      if (closedByUser) return
      lastEventId = messageEventId(event) ?? lastEventId
      applyState(event)
    })
    // 兼容默认 message 事件（服务端目前只发 event: state，多一种编码不丢数据）。
    next.addEventListener('message', (event) => {
      if (closedByUser) return
      lastEventId = messageEventId(event) ?? lastEventId
      applyState(event)
    })
    next.addEventListener('ping', (event) => {
      if (closedByUser) return
      lastEventId = messageEventId(event) ?? lastEventId
      if (status !== 'connected') setStatus('connected')
    })
    next.addEventListener('error', onError)
  }

  open()

  return {
    close() {
      closedByUser = true
      closeSource()
      status = 'failed'
      detail = null
      emitStatus()
    },
    status() {
      return status
    },
    attempts() {
      return attempts
    },
    lastEventId() {
      return lastEventId
    },
  }
}
