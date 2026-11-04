/**
 * 诚信事件 SDK 入口（11 §3，apps/student/src/integrity）。
 *
 * 组成：身份（sessionId/deviceId）→ 事件工厂（08 §2 ClientEvent）→ 内存队列（5s/20 条/隐藏时 keepalive fetch）
 *      → 传输层（mock 内存 / 真实 fetch）；采集器挂 visibility/blur/fullscreen/copy/paste/... 
 *
 * 用法：App onLaunch 调 initIntegrity()（全局只初始化一次）；做题页 setContext({attemptId, layer})；
 *  页面隐藏/卸载由 SDK 自己 flushBeacon。mock 构建下 window.__PG_EVENTS__ 供 e2e 断言。
 */
import { resolveStorage } from '@/storage'
import type { KeyValueStore } from '@/storage/types'
import { attachIntegrityCapture, isDesktopEnv } from './capture'
import { createEventReporter, type EventContext, type IntegrityEventType } from './events'
import { createIdentity } from './identity'
import { createMockEventSink, createMockTransport, installMockEventDebug, isMockMode } from './mockSink'
import { createDefaultTabChannel, MultitabMonitor } from './multitab'
import { EventQueue } from './queue'
import type { FlushReason } from './transport'
import { createFetchTransport } from './transport'

export interface IntegritySdk {
  /** 入队一条事件（type 必须来自 08 目录；payload 按类型定义）。 */
  report(type: IntegrityEventType, payload?: Record<string, unknown>): void
  /** 更新事件归属（做题页在进入/切层时调用；null 表示未知）。 */
  setContext(patch: Partial<Pick<EventContext, 'attemptId' | 'layer' | 'mode' | 'problemId'>>): void
  flush(reason?: FlushReason): Promise<void>
  /** 页面隐藏/卸载时立即发（keepalive fetch 优先，sendBeacon 兜底）。 */
  flushBeacon(): Promise<void>
  /**
   * #46 严格测验：作答中拦截复制/剪切/粘贴/右键菜单并上报 blocked。
   * 页面按「mode=test 且已开始且未完成」切换；真实判定仍在服务端。
   */
  setClipboardBlocked(blocked: boolean): void
  /** 练习模式第一次切回来时提醒一次；返回取消订阅函数。 */
  onFirstReturn(callback: (awayMs: number) => void): () => void
  size(): number
  destroy(): void
}

export interface IntegritySdkOptions {
  storage?: KeyValueStore
  mockMode?: boolean
  now?: () => number
}

let instance: IntegritySdk | null = null

function createNoopSdk(): IntegritySdk {
  return {
    report() {},
    setContext() {},
    async flush() {},
    async flushBeacon() {},
    setClipboardBlocked() {},
    onFirstReturn() {
      return () => {}
    },
    size() {
      return 0
    },
    destroy() {},
  }
}

export function initIntegrity(options: IntegritySdkOptions = {}): IntegritySdk {
  if (instance) return instance
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    instance = createNoopSdk()
    return instance
  }

  const now = options.now ?? Date.now
  const mockMode = options.mockMode ?? isMockMode()
  const identity = createIdentity()
  const context: EventContext = { ...identity, attemptId: null, layer: null, mode: null, problemId: null }
  const reporter = createEventReporter(() => context, { now })
  const sink = mockMode ? createMockEventSink(now) : null
  const transport = sink ? createMockTransport(sink) : createFetchTransport()
  const storage = options.storage ?? resolveStorage()
  const queue = new EventQueue({ transport, store: storage })
  const firstReturnListeners = new Set<(awayMs: number) => void>()
  /** #46 严格测验：采集器每次事件时读取这个开关（false=练习/说明页，不拦截）。 */
  let clipboardBlocked = false

  function report(type: IntegrityEventType, payload: Record<string, unknown> = {}): void {
    queue.enqueue(reporter(type, payload))
  }

  let monitor: MultitabMonitor | null = null
  const channel = createDefaultTabChannel('attempt:' + identity.sessionId)
  if (channel) {
    monitor = new MultitabMonitor({
      channel,
      report: (tabs) => report('integ.multitab', { tabs }),
      now,
    })
  }

  const detach = attachIntegrityCapture({
    report,
    now,
    isDesktop: isDesktopEnv(window),
    multitab: monitor,
    onHidden: () => {
      void queue.flushBeacon()
    },
    onFirstReturn: (awayMs) => {
      for (const listener of firstReturnListeners) listener(awayMs)
    },
    onNetworkChange: (online) => {
      queue.setOnline(online)
    },
    shouldBlockClipboard: () => clipboardBlocked,
  })

  // 初始网络状态也记一条（教师看板可区分「开始时就离线」与「中途断网」）。
  report('integ.network', { online: typeof navigator === 'undefined' ? true : navigator.onLine })
  queue.start()

  if (sink) installMockEventDebug(sink, (reason?: string) => queue.flush((reason as FlushReason) ?? 'manual'))

  const sdk: IntegritySdk = {
    report,
    setContext(patch) {
      Object.assign(context, patch)
    },
    flush(reason: FlushReason = 'manual') {
      return queue.flush(reason)
    },
    flushBeacon() {
      return queue.flushBeacon()
    },
    setClipboardBlocked(blocked: boolean) {
      clipboardBlocked = blocked === true
    },
    onFirstReturn(callback) {
      firstReturnListeners.add(callback)
      return () => firstReturnListeners.delete(callback)
    },
    size() {
      return queue.size()
    },
    destroy() {
      detach()
      queue.stop()
      firstReturnListeners.clear()
      instance = null
    },
  }
  instance = sdk
  return sdk
}

export function getIntegritySdk(): IntegritySdk | null {
  return instance
}

/**
 * 清理 SDK（卸载采集器、停止队列）：页面/测试 teardown 用。
 * 注意：应用切后台（onHide）不要调用——回到前台还要继续采集；那里只 flushBeacon。
 */
export function disposeIntegrity(): void {
  instance?.destroy()
  instance = null
}

/** 便捷上报（未初始化时静默忽略，不阻塞 UI）。 */
export function reportIntegrity(type: IntegrityEventType, payload?: Record<string, unknown>): void {
  instance?.report(type, payload)
}
