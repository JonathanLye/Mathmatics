/**
 * 诚信信号采集（11 §3）：visibility / blur / fullscreen / copy / cut / paste / contextmenu /
 * shortcut / multitab / network。
 *
 * 只提供「大多数学生不会绕过」的威慑与记录，关键判定在服务端（11 §1）；
 * 事件类型与 payload 严格按 08 事件目录，不发明类型。
 */
import type { IntegrityEventType } from './events'
import type { MultitabMonitor } from './multitab'

export interface IntegrityCaptureOptions {
  report: (type: IntegrityEventType, payload?: Record<string, unknown>) => void
  doc?: Document
  win?: Window
  now?: () => number
  /** 11 §3：blur 只在桌面端计入（手机通知栏/来电误报多）。 */
  isDesktop?: boolean
  multitab?: MultitabMonitor | null
  /** 页面隐藏时立即 flush（由 SDK 接到 queue.flushBeacon）。 */
  onHidden?: () => void
  /** 练习模式：本次会话第一次切回来时轻提醒一次（11 §5.1）。 */
  onFirstReturn?: (awayMs: number) => void
  onNetworkChange?: (online: boolean) => void
  /**
   * #46 严格测验：答题中拦截复制/剪切/粘贴/右键菜单（preventDefault）并上报 blocked。
   * 由 SDK 的运行时开关提供（页面按 mode=test + 已开始 + 未完成切换），采集器每次事件时读取。
   */
  shouldBlockClipboard?: () => boolean
}

/** 选中文字长度：优先选区，其次 input/textarea 的 selection。 */
export function selectionChars(doc: Document): number {
  const selected = doc.getSelection?.()?.toString() ?? ''
  if (selected.length > 0) return selected.length
  const active = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    try {
      return Math.abs((active.selectionEnd ?? 0) - (active.selectionStart ?? 0))
    } catch {
      return 0
    }
  }
  return 0
}

const SHORTCUT_KEYS: Record<string, string> = {
  c: 'copy',
  v: 'paste',
  p: 'print',
  s: 'save',
  i: 'devtools',
  j: 'devtools',
}

/** 敏感快捷键 → combo 字符串；不敏感返回 null（08 目录 integ.shortcut{combo}）。 */
export function shortcutCombo(event: {
  key?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}): string | null {
  const key = (event.key ?? '').toLowerCase()
  const modifier = Boolean(event.ctrlKey || event.metaKey)
  if (key === 'f12') return 'f12'
  if (modifier && key === 'i' && event.shiftKey) return 'ctrl+shift+i'
  if (modifier && key === 'j' && event.shiftKey) return 'ctrl+shift+j'
  if (modifier && SHORTCUT_KEYS[key]) return (event.ctrlKey ? 'ctrl+' : 'meta+') + SHORTCUT_KEYS[key]
  return null
}

function targetOf(doc: Document): string {
  const active = doc.activeElement as (HTMLElement & { dataset?: DOMStringMap }) | null
  const target = active?.dataset?.pgTarget
  return target && target.length > 0 ? target : 'unknown'
}

export function attachIntegrityCapture(options: IntegrityCaptureOptions): () => void {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null)
  const win = options.win ?? (typeof window !== 'undefined' ? window : null)
  const now = options.now ?? Date.now
  if (!doc || !win) return () => {}

  let hiddenAt: number | null = null
  let blurAt: number | null = null
  let firstReturnSeen = false

  /** 当前是否处于「测验作答中」的剪贴板拦截状态；回调异常时不拦截（不阻塞学生）。 */
  function clipboardBlocked(): boolean {
    try {
      return options.shouldBlockClipboard?.() === true
    } catch {
      return false
    }
  }

  function prevent(event: unknown): void {
    const target = event as { preventDefault?: () => void } | undefined
    target?.preventDefault?.()
  }

  function markHidden(): void {
    if (hiddenAt !== null) return
    hiddenAt = now()
    options.report('integ.visibility', { state: 'hidden' })
    options.onHidden?.()
  }

  function markVisible(): void {
    if (hiddenAt === null) return
    const awayMs = Math.max(0, now() - hiddenAt)
    hiddenAt = null
    options.report('integ.visibility', { state: 'visible', awayMs })
    if (!firstReturnSeen) {
      firstReturnSeen = true
      options.onFirstReturn?.(awayMs)
    }
  }

  const onVisibilityChange = (): void => {
    if (doc.visibilityState === 'hidden') markHidden()
    else markVisible()
  }
  const onPageHide = (): void => markHidden()
  const onPageShow = (): void => markVisible()

  const onBlur = (): void => {
    if (!options.isDesktop || blurAt !== null) return
    blurAt = now()
  }
  const onFocus = (): void => {
    if (!options.isDesktop || blurAt === null) return
    const awayMs = Math.max(0, now() - blurAt)
    blurAt = null
    options.report('integ.blur', { awayMs })
  }

  const onFullscreenChange = (): void => {
    options.report('integ.fullscreen', { state: doc.fullscreenElement ? 'enter' : 'exit' })
  }

  const onCopy = (event?: Event): void => {
    const chars = selectionChars(doc)
    if (clipboardBlocked()) {
      prevent(event)
      // p_integ_copy 的契约字段只有 chars；blocked 由 additionalProperties 允许，测验模式用来标记拦截。
      options.report('integ.copy', { chars, blocked: true })
      return
    }
    options.report('integ.copy', { chars })
  }
  const onCut = (event?: Event): void => {
    const chars = selectionChars(doc)
    if (clipboardBlocked()) {
      prevent(event)
      options.report('integ.cut', { chars, blocked: true })
      return
    }
    options.report('integ.cut', { chars })
  }

  const onPaste = (event: ClipboardEvent): void => {
    const chars = event.clipboardData?.getData('text')?.length ?? 0
    const blocked = clipboardBlocked()
    if (blocked) prevent(event)
    // p_paste 契约里有 blocked 字段（11 §3：禁止复制粘贴：可拦截并记录）。
    options.report('paste', { target: targetOf(doc), chars, blocked })
  }

  const onContextMenu = (event?: Event): void => {
    const blocked = clipboardBlocked()
    if (blocked) prevent(event)
    options.report('integ.contextmenu', blocked ? { blocked: true } : {})
  }

  /** 测验模式：题面/证明行禁止选中（配合页面 user-select:none，双击/拖选也不出选区）。 */
  const onSelectStart = (event?: Event): void => {
    if (clipboardBlocked()) prevent(event)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const combo = shortcutCombo(event)
    if (combo) options.report('integ.shortcut', { combo })
  }

  const onOnline = (): void => {
    options.report('integ.network', { online: true })
    options.onNetworkChange?.(true)
  }
  const onOffline = (): void => {
    options.report('integ.network', { online: false })
    options.onNetworkChange?.(false)
  }

  doc.addEventListener('visibilitychange', onVisibilityChange)
  win.addEventListener('pagehide', onPageHide)
  win.addEventListener('pageshow', onPageShow)
  win.addEventListener('blur', onBlur)
  win.addEventListener('focus', onFocus)
  doc.addEventListener('fullscreenchange', onFullscreenChange)
  doc.addEventListener('copy', onCopy)
  doc.addEventListener('cut', onCut)
  doc.addEventListener('paste', onPaste as EventListener)
  doc.addEventListener('contextmenu', onContextMenu)
  doc.addEventListener('selectstart', onSelectStart)
  doc.addEventListener('selectstart', onSelectStart)
  win.addEventListener('keydown', onKeyDown)
  win.addEventListener('online', onOnline)
  win.addEventListener('offline', onOffline)

  options.multitab?.start()

  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    win.removeEventListener('pagehide', onPageHide)
    win.removeEventListener('pageshow', onPageShow)
    win.removeEventListener('blur', onBlur)
    win.removeEventListener('focus', onFocus)
    doc.removeEventListener('fullscreenchange', onFullscreenChange)
    doc.removeEventListener('copy', onCopy)
    doc.removeEventListener('cut', onCut)
    doc.removeEventListener('paste', onPaste as EventListener)
    doc.removeEventListener('contextmenu', onContextMenu)
    doc.removeEventListener('selectstart', onSelectStart)
    doc.removeEventListener('selectstart', onSelectStart)
    win.removeEventListener('keydown', onKeyDown)
    win.removeEventListener('online', onOnline)
    win.removeEventListener('offline', onOffline)
    options.multitab?.stop()
  }
}

/** 桌面判定（blur 只在桌面计入；H5 手机也是 hover:none）。 */
export function isDesktopEnv(win?: Window): boolean {
  const w = win ?? (typeof window !== 'undefined' ? window : null)
  if (!w || typeof w.matchMedia !== 'function') return false
  try {
    return w.matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch {
    return false
  }
}
