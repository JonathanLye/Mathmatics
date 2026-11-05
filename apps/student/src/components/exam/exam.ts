/**
 * 严格测验模式（#46 A 侧；11 §5.2/5.3、04 §7）的纯逻辑。
 *
 * 边界（重要）：
 * - 前端只渲染服务端状态，不做锁定判定：切出次数（integrity.warnings）由服务端累加，
 *   阈值由服务端/布置配置决定；本模块只负责「把服务端给的数字格式化成 UI 文案」。
 * - 全屏、剪贴板、水印、倒计时都是交互/展示层；真正判定与服务端计时以 B 为准。
 * - 受限能力：倒计时只格式化；到点不在本地结束（11 §5.2「限时到：服务端自动提交」）。
 * - 水印不含 PII：只用匿名码 + 时间分钟；不请求/打印 token。
 */
import type { AttemptMode, AttemptState, ExamView } from '@/types/attempt'
import { FALLBACK_TOKEN, readCssToken } from '@/utils/themeTokens'

/** 切出锁定默认次数（04 §7：测验默认「3 次锁定」；实际以服务端/布置配置为准）。 */
export const EXAM_MAX_SWITCHES_DEFAULT = 3
/** 水印文字每分钟更新（11 §5.3）。 */
export const WATERMARK_UPDATE_MS = 60_000
/** 水印 SVG 的填充不透明度（11 §5.3：半透明 6%）。 */
export const WATERMARK_OPACITY = 0.06

export interface FullscreenSupport {
  supported: boolean
  /** 不支持的原因：unsupported=浏览器没有 Fullscreen API；ios-safari=iPhone Safari 已知不支持元素全屏（11 §3）。 */
  reason: 'unsupported' | 'ios-safari' | null
}

export interface ClipboardDecision {
  block: boolean
  /** 上报的事件类型（08 事件目录：复制/剪切/粘贴/右键菜单）。 */
  reportType: 'integ.copy' | 'integ.cut' | 'paste' | 'integ.contextmenu'
}

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 是否是测验模式（只看服务端 state.mode）。 */
export function isStrictExam(state: Pick<AttemptState, 'mode'> | null | undefined): boolean {
  return state?.mode === 'test'
}

/** 测验扩展字段（可能来自服务端，也可能是 mock；没有则 undefined）。 */
export function examOf(state: AttemptState | null | undefined): ExamView | undefined {
  return state?.exam
}

/** 截止时间（ms）；没有/非法返回 null（前端不自己造截止时间）。 */
export function examDeadlineMs(state: AttemptState | null | undefined): number | null {
  return parseTime(state?.exam?.deadlineAt)
}

/**
 * 服务端时钟偏移：serverTime - 客户端现在。刷新 state 时计算一次；
 * 倒计时显示统一用「客户端现在 + 偏移」，不依赖客户端本地时间是否正确（11 §7）。
 */
export function serverOffsetMs(state: AttemptState | null | undefined, clientNow = Date.now()): number {
  const serverTime = parseTime(state?.serverTime)
  return serverTime === null ? 0 : serverTime - clientNow
}

/** 剩余毫秒（deadline -（客户端现在 + 服务端时钟偏移））；没有截止时间返回 null。 */
export function remainingMs(
  deadlineMs: number | null,
  offsetMs: number,
  clientNow = Date.now(),
): number | null {
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return null
  return deadlineMs - (clientNow + (Number.isFinite(offsetMs) ? offsetMs : 0))
}

/** 倒计时文案：>=1h → h:mm:ss，否则 mm:ss；没有截止时间 → '—'；到点/负值 → '00:00'。 */
export function formatCountdown(remaining: number | null): string {
  if (remaining === null || !Number.isFinite(remaining)) return '—'
  const totalSeconds = Math.max(0, Math.floor(remaining / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const two = (value: number): string => String(value).padStart(2, '0')
  if (hours > 0) return hours + ':' + two(minutes) + ':' + two(seconds)
  return two(minutes) + ':' + two(seconds)
}

/** 是否已到截止时间（只用于显示「等待服务端提交」，不在本地结束/锁定）。 */
export function isExamTimeUp(remaining: number | null): boolean {
  return remaining !== null && Number.isFinite(remaining) && remaining <= 0
}

// ---------------------------------------------------------------------------
// 水印（11 §5.3）：匿名码 · 日期 时:分；CSS 背景（SVG data URI）；6% 不透明；不可选中。
// ---------------------------------------------------------------------------

/** 本地时间的分钟键：用于「每分钟更新」缓存。 */
export function watermarkMinuteKey(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return (
    date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate()) +
    ' ' + two(date.getHours()) + ':' + two(date.getMinutes())
  )
}

/** 水印文字：`匿名码 · 日期 时:分`；匿名码缺失时用「匿名码」占位（不显示 PII）。 */
export function watermarkText(anonCode: string | null | undefined, date: Date): string {
  const code = typeof anonCode === 'string' && anonCode.trim().length > 0 ? anonCode.trim() : '匿名码'
  return code + ' · ' + watermarkMinuteKey(date)
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 生成水印用的 SVG（斜向平铺单元）。文字必须是纯文本（匿名码/时间），不渲染 HTML。
 * 注意：返回**未编码** SVG 字符串；浏览器样式里用 backgroundImageFor 包 data URI。
 * 深色模式：fill 取当前主题 --ink（无 DOM 时回退浅色值），否则深字深底不可见（D2）。
 */
export function buildWatermarkSvg(text: string, ink: string = readCssToken('--ink', FALLBACK_TOKEN.ink)): string {
  const safe = escapeXml(text)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="140" viewBox="0 0 280 140">' +
    '<text x="140" y="70" transform="rotate(-24 140 70)" text-anchor="middle" ' +
    'font-family="ui-monospace, Menlo, monospace" font-size="11" ' +
    'fill="' + escapeXml(ink) + '" fill-opacity="' + WATERMARK_OPACITY + '">' + safe + '</text>' +
    '</svg>'
  )
}

/** SVG → CSS background-image data URI（encodeURIComponent，避免引号/特殊字符破坏 style）。 */
export function watermarkBackgroundImage(text: string, ink?: string): string {
  return 'url("data:image/svg+xml,' + encodeURIComponent(buildWatermarkSvg(text, ink)) + '")'
}

/** 水印覆盖层的行内样式：铺满、平铺、不接收指针事件、不可选中。 */
export function watermarkStyle(text: string, ink?: string): Record<string, string> {
  return {
    backgroundImage: watermarkBackgroundImage(text, ink),
    backgroundRepeat: 'repeat',
    backgroundSize: '280px 140px',
    pointerEvents: 'none',
    userSelect: 'none',
    webkitUserSelect: 'none',
  }
}

/**
 * 分钟级缓存：同一分钟重复渲染复用同一 data URI（避免每秒重算 SVG/编码）。
 * cache 由调用方持有（Map），本函数有界（最多 16 条，超出清空最旧）。
 * key 含 ink：深/浅色主题切换后同一文本也要重新生成（D2）。
 */
export function cachedWatermarkBackground(text: string, cache: Map<string, string>, ink?: string): string {
  const color = ink ?? readCssToken('--ink', FALLBACK_TOKEN.ink)
  const key = color + '\u0000' + text
  const cached = cache.get(key)
  if (cached) return cached
  const image = watermarkBackgroundImage(text, color)
  cache.set(key, image)
  if (cache.size > 16) {
    const oldest = cache.keys().next().value
    if (typeof oldest === 'string') cache.delete(oldest)
  }
  return image
}

// ---------------------------------------------------------------------------
// 全屏（11 §3/§5.2）：iPhone Safari 不支持网页元素全屏；不支持就记录 unsupported 并进水印模式。
// ---------------------------------------------------------------------------

/** 简化 UA 判定：iPhone/iPad + Safari/WebKit（11 §3 已确认 iPhone Safari 不支持元素全屏）。 */
export function isIosSafari(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== 'string' || userAgent.length === 0) return false
  const isIos = /iPad|iPhone|iPod/.test(userAgent)
  const isWebKit = /AppleWebKit/.test(userAgent)
  const isChromeOrFirefox = /CriOS|FxiOS|Chrome|Firefox/.test(userAgent)
  return isIos && isWebKit && !isChromeOrFirefox
}

/** 探测 Fullscreen API：返回是否支持 + 可调用的请求函数（不依赖具体 DOM 类型，便于单测）。 */
export function detectFullscreenSupport(docLike: unknown, userAgent?: string | null): FullscreenSupport {
  if (isIosSafari(userAgent ?? null)) return { supported: false, reason: 'ios-safari' }
  const doc = docLike as { documentElement?: { requestFullscreen?: unknown } } | null
  const element = doc?.documentElement as { requestFullscreen?: unknown } | undefined
  if (!element || typeof element.requestFullscreen !== 'function') {
    return { supported: false, reason: 'unsupported' }
  }
  return { supported: true, reason: null }
}

/** 当前是否处于全屏（读 document.fullscreenElement，不缓存）。 */
export function isFullscreen(docLike: unknown): boolean {
  const doc = docLike as { fullscreenElement?: unknown } | null
  return Boolean(doc?.fullscreenElement)
}

/**
 * 请求全屏（必须在用户手势的同步调用栈里发起，如「开始」按钮的点击处理）。
 * 成功/已在全屏 → 'enter'；用户拒绝/异常 → 'denied'；不支持 → 'unsupported'。
 */
export async function requestExamFullscreen(docLike: unknown, userAgent?: string | null): Promise<'enter' | 'denied' | 'unsupported'> {
  const support = detectFullscreenSupport(docLike, userAgent)
  if (!support.supported) return 'unsupported'
  const doc = docLike as { documentElement: { requestFullscreen: () => Promise<void> }; fullscreenElement?: unknown }
  if (doc.fullscreenElement) return 'enter'
  try {
    await doc.documentElement.requestFullscreen()
    return 'enter'
  } catch {
    return 'denied'
  }
}

// ---------------------------------------------------------------------------
// 作答中限制：粘贴/复制/剪切/右键菜单、求助、拍照（11 §5.2）
// ---------------------------------------------------------------------------

/** 测验作答中才拦截剪贴板（说明页阶段不拦；退出/锁定时仍拦）。 */
export function shouldBlockClipboard(mode: AttemptMode | null | undefined, started: boolean): boolean {
  return mode === 'test' && started
}

/** 复制/剪切/粘贴/右键的拦截决定（供采集器 preventDefault + blocked 上报使用）。 */
export function clipboardDecision(
  kind: 'copy' | 'cut' | 'paste' | 'contextmenu',
  mode: AttemptMode | null | undefined,
  started: boolean,
): ClipboardDecision {
  const block = shouldBlockClipboard(mode, started)
  const reportType =
    kind === 'copy' ? 'integ.copy' : kind === 'cut' ? 'integ.cut' : kind === 'paste' ? 'paste' : 'integ.contextmenu'
  return { block, reportType }
}

/** 测验模式允许的求助：exam.allowedHelp 缺省按「只留概念」处理（04 §7：测验默认关，可只开概念）。 */
export function examAllowedHelp(state: AttemptState | null | undefined): 'off' | 'concept' {
  return state?.exam?.allowedHelp === 'off' ? 'off' : 'concept'
}

/** 水印用的匿名码：优先 integrity.watermark → exam.watermark → Me.anonCode → 匿名码占位。 */
export function examWatermarkCode(
  state: AttemptState | null | undefined,
  meAnonCode: string | null | undefined,
): string {
  const fromIntegrity = state?.integrity?.watermark
  if (typeof fromIntegrity === 'string' && fromIntegrity.trim().length > 0) return fromIntegrity.trim()
  const fromExam = state?.exam?.watermark
  if (typeof fromExam === 'string' && fromExam.trim().length > 0) return fromExam.trim()
  if (typeof meAnonCode === 'string' && meAnonCode.trim().length > 0) return meAnonCode.trim()
  return '匿名码'
}

/** 锁定阈值：integrity.maxWarnings 缺省 3（04 §7）；只用于文案「第 N 次将锁定」，不做判定。 */
export function examMaxWarnings(state: AttemptState | null | undefined): number {
  const max = state?.integrity?.maxWarnings
  return typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : EXAM_MAX_SWITCHES_DEFAULT
}

/** 是否被服务端锁定（只读 integrity.locked / status）。 */
export function examLocked(state: AttemptState | null | undefined): boolean {
  return Boolean(state?.integrity?.locked) || state?.status === 'locked'
}

/** 切出次数（只读服务端字段；缺失按 0 显示，不自行累加）。 */
export function examWarnings(state: AttemptState | null | undefined): number {
  const count = state?.integrity?.warnings
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** 第 1/2 次切出警告文案（11 §5.2）。 */
export function leaveWarningText(count: number, max = EXAM_MAX_SWITCHES_DEFAULT): string {
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : EXAM_MAX_SWITCHES_DEFAULT
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  return '你已离开 ' + safeCount + ' 次（第 ' + safeMax + ' 次将锁定本题）'
}

/**
 * 是否弹「离开警告」：只根据服务端 warnings 的增量显示（前端不累加/不清零）。
 * - 已锁定 → 不弹（由锁定遮罩接管）；
 * - 次数达到阈值 → 不弹（服务端即将/已经锁）；
 * - 计数下降（教师解锁后服务端可能不重置）→ 不弹。
 */
export function shouldShowLeaveWarning(
  previous: number | undefined,
  next: number | undefined,
  locked: boolean,
  max = EXAM_MAX_SWITCHES_DEFAULT,
): boolean {
  if (locked) return false
  const before = typeof previous === 'number' && Number.isFinite(previous) ? previous : 0
  const after = typeof next === 'number' && Number.isFinite(next) ? next : 0
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : EXAM_MAX_SWITCHES_DEFAULT
  return after > before && after < safeMax
}

/** 锁定遮罩正文（11 §5.2：本题已锁定，请联系老师）。 */
export function examLockedText(): string {
  return '本题已锁定，请联系老师'
}
