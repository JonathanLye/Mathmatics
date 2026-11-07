/**
 * 小方信箱的纯逻辑（15 号文档）：谁显示入口、页面名、编号、状态说法、环境解析、草稿。
 * 不碰 DOM、不碰接口，方便在 node 里测。命名里用 feedbackbox，是为了和学习反馈（PgFeedbackPanel、feedbackAllowed）区分。
 */
import { FBBOX_CLOSE_LABEL, FBBOX_STATUS_LABEL } from '@/copy/feedbackbox'
import type { FeedbackKind } from '@/types/attempt'
import type { FeedbackContext, FeedbackListItem, FeedbackStatus } from '@/types/feedbackbox'

export const FBBOX_MAX = 2000
export const FBBOX_DRAFT_KEY = 'pg.fbbox.v1'

/** 反馈入口出现的页面（白名单：没列出的页面不显示，登录/同意/改密/年龄/引导/隐私政策/镜像页自然被排除）。 */
const FAB_PAGES = new Set([
  'home',
  'practice-zone',
  'mistakes',
  'proofbook',
  'proof-detail',
  'me',
  'practice',
  'not-found',
])

/** 页面名（给学生和开发者看的说法）。 */
const PAGE_NAMES: Readonly<Record<string, string>> = {
  home: '路径',
  'practice-zone': '练习',
  mistakes: '错题',
  proofbook: '证明本',
  'proof-detail': '证明详情',
  me: '我的',
  practice: '做题',
  'not-found': '出错页',
  login: '登录',
  'set-password': '设密码',
  age: '年龄选择',
  consent: '同意书',
  welcome: '欢迎',
  tour: '引导',
  'privacy-policy': '隐私政策',
}

/** 去掉 query 与 hash。 */
export function stripUrl(value: string): string {
  const cut = value.search(/[?#]/)
  return cut < 0 ? value : value.slice(0, cut)
}

/** hash 路由（#/pages/home/index?x=1）或普通路径 → /pages/home/index。 */
export function routeOf(raw: string | null | undefined): string {
  if (!raw) return ''
  let value = raw
  // #/pages/x 是 hash 路由；pages/x#top 只是带锚点的路径，锚点直接丢掉。
  const hash = value.indexOf('#')
  if (hash >= 0 && value.charAt(hash + 1) === '/') value = value.slice(hash + 1)
  value = stripUrl(value)
  if (!value.startsWith('/')) value = '/' + value
  return value.slice(0, 200)
}

/** /pages/me/about → me；/pages/practice/index → practice。 */
export function pageKeyOf(route: string): string {
  const parts = stripUrl(route).split('/').filter(Boolean)
  const seg = parts[0] === 'pages' ? parts[1] : parts[0]
  return seg ?? ''
}

export function pageNameOf(route: string): string | undefined {
  return PAGE_NAMES[pageKeyOf(route)]
}

export type FabMode = 'hidden' | 'full' | 'mini'

export interface FabState {
  route: string
  loggedIn: boolean
  consented: boolean
  /** 考试（测验）模式：入口完全隐藏（防作弊 11 §5.2）。 */
  testMode: boolean
  /** 有 Sheet、Dialog、考试遮罩、庆祝层打开。 */
  overlayOpen: boolean
}

/** 入口怎么显示：做题页缩成小标，其余页面完整；不该出现的地方隐藏。 */
export function fabModeFor(state: FabState): FabMode {
  if (!state.loggedIn || !state.consented || state.testMode || state.overlayOpen) return 'hidden'
  const key = pageKeyOf(state.route)
  if (!FAB_PAGES.has(key)) return 'hidden'
  return key === 'practice' ? 'mini' : 'full'
}

/** 编号：#0042。 */
export function refLabel(refNo: number): string {
  return '#' + String(Math.max(0, Math.trunc(refNo))).padStart(4, '0')
}

export function feedbackText(raw: string): string {
  return raw.trim().slice(0, FBBOX_MAX)
}

/** 学生看到的状态说法：已关闭时按原因细分（已修复=已解决）。 */
export function statusLabelOf(status: FeedbackStatus, closeReason?: string | null): string {
  if (status === 'closed' && closeReason && closeReason in FBBOX_CLOSE_LABEL) {
    return FBBOX_CLOSE_LABEL[closeReason as keyof typeof FBBOX_CLOSE_LABEL]
  }
  return FBBOX_STATUS_LABEL[status]
}

export type TagTone = 'neutral' | 'ok' | 'sea' | 'fox' | 'bee' | 'accent'

/** 状态标签的颜色：想问问你用橙（需要你回应），已解决用绿，正在看用蓝。 */
export function statusToneOf(status: FeedbackStatus): TagTone {
  switch (status) {
    case 'new':
      return 'neutral'
    case 'open':
      return 'sea'
    case 'need_info':
      return 'fox'
    case 'resolved':
      return 'ok'
    default:
      return 'neutral'
  }
}

/** 有多少条在等学生回应（想问问你）。 */
export function waitingOnMe(items: readonly FeedbackListItem[]): number {
  return items.filter((i) => i.status === 'need_info').length
}

/** 只有「开发者还在跟」的状态下学生能追加回复；已关闭不行。 */
export function canReply(status: FeedbackStatus): boolean {
  return status !== 'closed'
}

// ---------------------------------------------------------------- 环境

export interface EnvInfo {
  os?: string
  browser?: string
  viewport?: string
  dpr?: number
}

/** 从 UA 里认出系统和浏览器（只取大类，不上报整串 UA）。 */
export function parseEnv(ua: string, width: number, height: number, dpr: number): EnvInfo {
  const u = ua || ''
  let os: string | undefined
  if (/iPhone|iPad|iPod/.test(u)) os = 'iOS'
  else if (/Android/.test(u)) os = 'Android'
  else if (/Windows/.test(u)) os = 'Windows'
  else if (/Mac OS X|Macintosh/.test(u)) os = 'macOS'
  else if (/Linux/.test(u)) os = 'Linux'
  let browser: string | undefined
  if (/MicroMessenger/.test(u)) browser = '微信'
  else if (/Edg\//.test(u)) browser = 'Edge'
  else if (/(Chrome|CriOS)\//.test(u)) browser = 'Chrome'
  else if (/(Firefox|FxiOS)\//.test(u)) browser = 'Firefox'
  else if (/Safari\//.test(u)) browser = 'Safari'
  const out: EnvInfo = {}
  if (os) out.os = os
  if (browser) out.browser = browser
  if (width > 0 && height > 0) out.viewport = `${Math.round(width)}x${Math.round(height)}`
  if (dpr > 0) out.dpr = Math.round(dpr * 100) / 100
  return out
}

// ---------------------------------------------------------------- 草稿

export interface Draft {
  kind: FeedbackKind
  body: string
}

export function serializeDraft(draft: Draft): string {
  return JSON.stringify({ kind: draft.kind, body: draft.body.slice(0, FBBOX_MAX) })
}

/** 解析本机存的草稿：坏数据一律当没有。 */
export function parseDraft(raw: string | null | undefined): Draft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { kind?: unknown; body?: unknown }
    const kinds: FeedbackKind[] = ['bug', 'idea', 'content', 'other']
    if (typeof value.body !== 'string' || value.body.trim() === '') return null
    const kind = kinds.includes(value.kind as FeedbackKind) ? (value.kind as FeedbackKind) : 'bug'
    return { kind, body: value.body.slice(0, FBBOX_MAX) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 「会带上什么」

/** 提交时实际会带的内容，和界面上「小方会一起带上」逐项对应。 */
export function withItems(ctx: {
  route?: string
  pageName?: string
  problemId?: string
  stepNo?: number
  env?: unknown
  app?: unknown
  errors?: readonly unknown[]
}): Array<'page' | 'problem' | 'step' | 'device' | 'errors'> {
  const items: Array<'page' | 'problem' | 'step' | 'device' | 'errors'> = []
  if (ctx.route || ctx.pageName) items.push('page')
  if (ctx.problemId) items.push('problem')
  if (typeof ctx.stepNo === 'number') items.push('step')
  if (ctx.env || ctx.app) items.push('device')
  if (ctx.errors && ctx.errors.length > 0) items.push('errors')
  return items
}

// ---------------------------------------------------------------- 时间

/** 刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日。 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, now - t)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  const d = new Date(t)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
