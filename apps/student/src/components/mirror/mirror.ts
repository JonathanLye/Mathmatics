/**
 * 教师镜像预览 / 回放的纯逻辑（issue #43 A 侧子集）。
 *
 * 口径：
 * - 04 §5：教师取 5 分钟 mirror-token，iframe 打开学生 H5 /s/mirror?attempt=…&token=…；
 *   回放用时间轴滑块，标出层切换、提交、提示、批注、离开、识别。
 * - 06 §6：镜像 SSE 用 event: state（data=AttemptState）+ ping；鉴权可用 mirrorToken 查询参数。
 * - 08 §2/§3：事件信封以 seq 严格递增，回放排序以 seq 为准；时间显示以服务端时间为准。
 *
 * 本文件不依赖 Vue / DOM（除 isMixedContent 会读 window.location.protocol），可直接被 vitest 单测。
 * 安全约定：token 只允许出现在 iframe 的 src 查询参数里；日志/错误文案一律走 redact/sanitize，
 * 不要把 token 原样写进 console 或可见文本。
 */

/**
 * 镜像 iframe 的 sandbox 策略（issue #43；PR #100 评审后采用方案 b）。
 *
 * 只保留 `allow-scripts`，**禁止**再加 `allow-same-origin`：
 * - 镜像页与学生 H5 同源；iframe 同源且同时拥有 allow-scripts 与 allow-same-origin 时，
 *   嵌入页可以直接移除自己的 sandbox 属性并重载，等于完全跳出沙箱（WHATWG HTML / MDN 均明确警告），
 *   学生可控内容里注入的脚本就能以教师控制台身份行动（教师会话 Cookie / 接口权限）。
 * - 因此镜像页不得依赖「同源页面直接取数据」：必须用 04 §5.1 的 mirrorToken 经 CORS/令牌接口
 *   取数据（SSE 用同一令牌）；具体接口由 B 提供，C #51 在 B/A/C 定案前不得接线本组件。
 */
export const MIRROR_IFRAME_SANDBOX = 'allow-scripts'

/** 镜像 iframe sandbox 允许的 token（如需表单/下载等能力，必须在 B/A/C 安全评审后单独加）。 */
export const MIRROR_ALLOWED_SANDBOX_TOKENS: readonly string[] = ['allow-scripts']

/**
 * 镜像 iframe sandbox 禁止出现的 token：
 * `allow-same-origin` 会导致同源逃逸（见上）；其余是给镜像页扩权的高风险能力，默认不开。
 */
export const MIRROR_FORBIDDEN_SANDBOX_TOKENS: readonly string[] = [
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-modals',
  'allow-downloads',
]

/**
 * 校验一个 sandbox 值是否满足镜像页隔离要求（纯函数，组件/测试/C 接线前都可用）：
 * - 非空字符串、token 全部在允许列表内、且包含 allow-scripts；
 * - 任何禁止 token（尤其 allow-same-origin）直接判不安全。
 */
export function isSafeMirrorSandbox(sandbox: unknown): boolean {
  if (typeof sandbox !== 'string') return false
  const tokens = sandbox.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  if (!tokens.includes('allow-scripts')) return false
  return tokens.every(
    (token) => !MIRROR_FORBIDDEN_SANDBOX_TOKENS.includes(token) && MIRROR_ALLOWED_SANDBOX_TOKENS.includes(token),
  )
}

/** 时间轴标记的颜色语义（对应 tokens.css，02 §2.2）：accent=层/页面，ok=提交，hint=提示/离开，margin=批注，muted=其它。 */
export type MarkerTone = 'accent' | 'ok' | 'hint' | 'margin' | 'muted'

/**
 * 事件信封里本模块用到的字段子集（08 §2；完整 schema 见 contracts/events.schema.json）。
 * seq 由服务端分配、同一作答内严格递增，回放排序以它为准。
 */
export interface MirrorEvent {
  seq: number
  type: string
  tsServer?: string | null
  tsClient?: string | null
  layer?: string | null
  payload?: Record<string, unknown> | null
}

/** 时间轴上的一个标记；at 为相对第一条事件时间的毫秒数。 */
export interface TimelineMarker {
  at: number
  type: string
  label: string
  seq: number
}

export interface MirrorTimeline {
  /** 最后一条事件的相对时间（毫秒）；没有事件时为 0。 */
  durationMs: number
  markers: TimelineMarker[]
}

/** SSE 帧（06 §6 / WHATWG SSE 子集）。data 多行已经按规范用换行合并。 */
export interface SseFrame {
  event?: string
  id?: string
  data: string
  retry?: number
}

const MIRROR_PATH = '/s/mirror'
const TOKEN_MIN_LENGTH = 8
const TOKEN_MAX_LENGTH = 512
/** 只接受 URL-safe 字符：JWT（含点）、base64url、uuid 风格都能过；空白/引号/&、#、?、/ 一律拒绝。 */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/
const ATTEMPT_MAX_LENGTH = 128
const ATTEMPT_FORBIDDEN = /[\s\u0000-\u001f\u007f?&#/]/

/** mirror-token 校验：非空字符串、8–512 字符、URL-safe 字符。 */
export function isValidMirrorToken(token: unknown): token is string {
  if (typeof token !== 'string') return false
  if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) return false
  return TOKEN_PATTERN.test(token)
}

/** attemptId 校验（契约是 uuid；这里允许非 uuid 的演示 id，但仍拒绝空白与控制字符）。 */
export function isValidAttemptId(attemptId: unknown): boolean {
  if (typeof attemptId !== 'string') return false
  const value = attemptId.trim()
  if (!value || value.length > ATTEMPT_MAX_LENGTH) return false
  return !ATTEMPT_FORBIDDEN.test(value)
}

/** 日志安全：只保留长度信息，绝不包含 token 原文。 */
export function redactMirrorToken(token: unknown): string {
  if (typeof token !== 'string' || token.length === 0) return '<mirror-token missing>'
  return '<mirror-token len=' + token.length + '>'
}

/** 日志安全：把 URL 里的 token 查询参数替换成 ***（非法 URL 用正则兜底）。 */
export function sanitizeMirrorUrlForLog(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) return ''
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '***')
    return parsed.toString()
  } catch {
    return url.replace(/([?&]token=)[^&#]*/gi, '$1***')
  }
}

/**
 * 构造镜像页 URL：base 是学生 H5 的地址（origin 或带子路径，如 https://x.example/proof-gym），
 * 结果形如 https://x.example/proof-gym/s/mirror?attempt=…&token=…。
 * 只支持 http(s)，拒绝 javascript:/data: 等；token 不合法时抛通用错误（错误信息里不含 token）。
 */
export function buildMirrorUrl(base: string, attemptId: string, token: string): string {
  if (!isValidMirrorToken(token)) throw new Error('mirror token 不合法')
  if (!isValidAttemptId(attemptId)) throw new Error('attemptId 不合法')
  const rawBase = typeof base === 'string' ? base.trim() : ''
  if (!rawBase) throw new Error('mirror base 不能为空')
  let url: URL
  try {
    url = new URL(rawBase)
  } catch {
    throw new Error('mirror base 必须是绝对 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('mirror base 只支持 http(s)')
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith(MIRROR_PATH) ? pathname : pathname + MIRROR_PATH
  url.search = ''
  url.hash = ''
  url.searchParams.set('attempt', attemptId.trim())
  url.searchParams.set('token', token)
  return url.toString()
}

/** 是否是合法的镜像页 URL（协议 http(s)、路径以 /s/mirror 结尾、attempt/token 参数合法）。 */
export function isMirrorPageUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  if (!parsed.pathname.replace(/\/+$/, '').endsWith(MIRROR_PATH)) return false
  return isValidAttemptId(parsed.searchParams.get('attempt') ?? '') && isValidMirrorToken(parsed.searchParams.get('token') ?? '')
}

/**
 * 混合内容检测：教师端是 https 时，iframe 加载 http 镜像会被浏览器拦截，组件要提前给出人话提示。
 * pageProtocol 可显式传入（单测用），默认读 window.location.protocol。
 */
export function isMixedContent(srcUrl: string, pageProtocol?: string): boolean {
  if (typeof srcUrl !== 'string' || !srcUrl) return false
  const page = pageProtocol ?? (typeof window !== 'undefined' ? window.location.protocol : '')
  if (page !== 'https:') return false
  try {
    return new URL(srcUrl).protocol === 'http:'
  } catch {
    return false
  }
}

function pad2(value: number): string {
  return value < 10 ? '0' + value : String(value)
}

/** 毫秒 → 回放时间文本：小于 1 小时用 m:ss，1 小时及以上用 h:mm:ss。负值/非数字按 0:00。 */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? hours + ':' + pad2(minutes) + ':' + pad2(seconds) : minutes + ':' + pad2(seconds)
}

/** 数值夹到 [min, max]（min > max 时自动交换；非有限值取小端）。 */
export function clamp(value: number, min: number, max: number): number {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  if (!Number.isFinite(value)) return low
  if (value < low) return low
  if (value > high) return high
  return value
}

/** 标记在 0..100 轨道上的百分比（duration 为 0 时统一 0）。 */
export function markerPercent(atMs: number, durationMs: number): number {
  if (!Number.isFinite(atMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return clamp((atMs / durationMs) * 100, 0, 100)
}

const MARKER_TYPES: ReadonlySet<string> = new Set([
  'app.open',
  'nav.page',
  'layer.enter',
  'layer.done',
  'layer.skip',
  'def.submit',
  'frame.submit',
  'line.submit',
  'line.edit',
  'line.delete',
  'finish.try',
  'summary.submit',
  'help.open',
  'help.request',
  'hint.preview',
  'hint.deliver',
  'hint.deny',
  'budget.exhausted',
  'lesson.open',
  'recog.request',
  'recog.result',
  'recog.confirm',
  'annotation',
  'integ.visibility',
  'integ.blur',
  'attempt.lock',
  'attempt.unlock',
])

/** 是否需要在回放时间轴上标出（04 §5.2：层切换、提交、提示、批注、离开、识别）。 */
export function isMarkerType(type: string): boolean {
  return MARKER_TYPES.has(type)
}

const HELP_INTENT_TEXT: Record<string, string> = {
  stuck: '卡住了',
  concept: '不懂这个',
  check_line: '看这一行',
  free: '自由提问',
}

function payloadText(payload: Record<string, unknown> | null | undefined, key: string): string {
  const value = payload ? payload[key] : undefined
  return typeof value === 'string' ? value : ''
}

/** 标记文案（payload 能补细节时补一句；返回 null 表示该类型不上时间轴）。 */
export function markerLabel(event: MirrorEvent): string | null {
  const payload = event.payload ?? null
  switch (event.type) {
    case 'app.open':
      return '打开应用'
    case 'nav.page': {
      const page = payloadText(payload, 'page')
      return page ? '页面：' + page : '页面切换'
    }
    case 'layer.enter': {
      const layer = payloadText(payload, 'layer') || (typeof event.layer === 'string' ? event.layer : '')
      return layer ? '进入 ' + layer : '进入下一层'
    }
    case 'layer.done':
      return '完成一层'
    case 'layer.skip':
      return '跳过一层'
    case 'def.submit': {
      const passed = payload ? payload['pass'] : undefined
      return 'L1 提交定义' + (typeof passed === 'boolean' ? (passed ? '（通过）' : '（未通过）') : '')
    }
    case 'frame.submit': {
      const passed = payload ? payload['pass'] : undefined
      return 'L2 提交骨架' + (typeof passed === 'boolean' ? (passed ? '（通过）' : '（未通过）') : '')
    }
    case 'line.submit': {
      const n = payload ? payload['n'] : undefined
      return 'L3 提交第 ' + (typeof n === 'number' ? n : '?') + ' 行'
    }
    case 'line.edit':
      return '修改证明行'
    case 'line.delete':
      return '删除证明行'
    case 'finish.try':
      return '写完了'
    case 'summary.submit':
      return '提交总结'
    case 'help.open':
      return '打开求助'
    case 'help.request': {
      const intent = payloadText(payload, 'intent')
      return '求助·' + (HELP_INTENT_TEXT[intent] ?? '提问')
    }
    case 'hint.preview':
      return '查看提示预览'
    case 'hint.deliver': {
      const level = payloadText(payload, 'level')
      return level ? '领取提示 ' + level : '领取提示'
    }
    case 'hint.deny':
      return '提示未发放'
    case 'budget.exhausted':
      return '透露额度用尽'
    case 'lesson.open':
      return '打开微课'
    case 'recog.request':
      return '识别中'
    case 'recog.result':
      return '识别结果'
    case 'recog.confirm':
      return '确认识别'
    case 'annotation':
      return '批注'
    case 'integ.visibility': {
      const state = payloadText(payload, 'state')
      if (state === 'hidden') return '离开页面'
      const awayMs = payload ? payload['awayMs'] : undefined
      const seconds = typeof awayMs === 'number' ? Math.round(awayMs / 1000) : 0
      return seconds >= 1 ? '回到页面（离开 ' + seconds + ' 秒）' : '回到页面'
    }
    case 'integ.blur':
      return '窗口失焦'
    case 'attempt.lock':
      return '作答锁定'
    case 'attempt.unlock':
      return '作答解锁'
    default:
      return null
  }
}

/** 颜色语义（02 §2.2）：只用于时间轴标记，不表达判定。 */
export function markerTone(type: string): MarkerTone {
  if (type.startsWith('integ.')) return 'hint' // 离开/失焦：琥珀段（04 §5.2）
  if (type === 'annotation') return 'margin' // 红笔批注
  if (/^(help|hint|budget|concept|pressure|proactive)\./.test(type)) return 'hint'
  if (/^(def|frame|line|finish|summary)\./.test(type)) return 'ok'
  if (/^(app|nav|layer|lesson|recog|selfcheck|transfer)\./.test(type)) return 'accent'
  return 'muted'
}

function eventTimestamp(event: MirrorEvent): number | null {
  const candidates = [event.tsServer, event.tsClient]
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw) continue
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * 由事件序列构造回放时间轴：
 * - 按 seq 升序（08 §2）；第一条带有效服务端时间的事件作为时间零点；
 * - at 为相对毫秒，durationMs 取所有事件（含不上轴的）的最大 at；
 * - 只有 isMarkerType 的类型进 markers，label 由 markerLabel 生成；markers 按 (at, seq) 排序。
 */
export function buildTimeline(events: readonly MirrorEvent[]): MirrorTimeline {
  const sorted = events
    .filter((event) => event && typeof event.type === 'string' && Number.isFinite(event.seq))
    .slice()
    .sort((a, b) => a.seq - b.seq)
  let baseTs: number | null = null
  let previousAt = 0
  let durationMs = 0
  const markers: TimelineMarker[] = []
  for (const event of sorted) {
    const ts = eventTimestamp(event)
    if (baseTs === null && ts !== null) baseTs = ts
    const at = ts !== null && baseTs !== null ? Math.max(0, ts - baseTs) : previousAt
    previousAt = at
    durationMs = Math.max(durationMs, at)
    const label = markerLabel(event)
    if (label !== null && isMarkerType(event.type)) markers.push({ at, type: event.type, label, seq: event.seq })
  }
  markers.sort((a, b) => a.at - b.at || a.seq - b.seq)
  return { durationMs, markers }
}

/** 当前时间点之前（含）最近的标记下标；没有则 -1。用于显示「当前事件标签」。 */
export function seekIndex(markers: readonly TimelineMarker[], atMs: number): number {
  if (markers.length === 0 || !Number.isFinite(atMs)) return -1
  if (atMs < markers[0].at) return -1
  let low = 0
  let high = markers.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (markers[mid].at <= atMs) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** 下一个（direction=1：严格晚于当前）或上一个（-1：严格早于当前）标记下标；没有则 -1。 */
export function nextMarker(markers: readonly TimelineMarker[], atMs: number, direction: 1 | -1 = 1): number {
  if (markers.length === 0 || !Number.isFinite(atMs)) return -1
  if (direction >= 0) {
    for (let index = 0; index < markers.length; index += 1) {
      if (markers[index].at > atMs) return index
    }
    return -1
  }
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    if (markers[index].at < atMs) return index
  }
  return -1
}

function parseSseFrame(block: string): SseFrame | null {
  const dataLines: string[] = []
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue // 空行 / 注释行（心跳）
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'retry') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) retry = parsed
    }
  }
  const data = dataLines.join('\n')
  if (!data.trim() && event === undefined && id === undefined && retry === undefined) return null
  const frame: SseFrame = { data }
  if (event !== undefined) frame.event = event
  if (id !== undefined) frame.id = id
  if (retry !== undefined) frame.retry = retry
  return frame
}

/**
 * 增量 SSE 解析：传入本次收到的文本，返回完整帧 + 未收完的 rest（下次接着拼）。
 * - 支持 \n\n 与 \r\n 帧分隔；
 * - data 多行按规范用换行合并；忽略空帧与以 : 开头的注释帧（心跳）。
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  if (typeof buffer !== 'string' || buffer.length === 0) return { frames: [], rest: '' }
  const normalized = buffer.replace(/\r\n?/g, '\n')
  const blocks = normalized.split('\n\n')
  const rest = blocks.pop() ?? ''
  const frames: SseFrame[] = []
  for (const block of blocks) {
    const frame = parseSseFrame(block)
    if (frame) frames.push(frame)
  }
  return { frames, rest }
}

/** 解析 SSE 的 data 为 JSON；空串/非法 JSON 返回 null（心跳或坏帧不应打断回放）。 */
export function parseSseData<T = unknown>(data: string): T | null {
  if (typeof data !== 'string') return null
  const trimmed = data.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}
