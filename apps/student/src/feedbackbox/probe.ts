/**
 * 探针（15 §4）：给每条反馈自动带上「在哪、做到哪、最近发生了什么」。
 *
 * 默认只带位置类（页面、题目、层、步骤、圈到的元素）。设备型号、最近的小错误、最近的操作属于「扩展采集」，
 * 由 VITE_FEEDBACKBOX_EXTENDED=true 打开——合规结论（15 §10 第 1 条）出来之前不开。环形缓冲始终只在内存里，
 * 不开扩展就不会发出去。绝不采集：证明正文、输入框内容、答案、请求/响应体。
 */
import type { FeedbackContext } from '@/types/feedbackbox'
import { pageNameOf, parseEnv, routeOf, stripUrl } from './logic'

export const ERROR_LIMIT = 20
export const CRUMB_LIMIT = 30
export const TARGET_LIMIT = 5

export const EXTENDED: boolean = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FEEDBACKBOX_EXTENDED === 'true'

type ErrorEntry = NonNullable<FeedbackContext['errors']>[number]
type Crumb = NonNullable<FeedbackContext['breadcrumbs']>[number]

const errors: ErrorEntry[] = []
const crumbs: Crumb[] = []
let installed = false

const pushLimited = <T>(list: T[], item: T, limit: number): void => {
  list.push(item)
  if (list.length > limit) list.splice(0, list.length - limit)
}

/** 错误信息去掉长数字串、网址 query，并截断：可能带出的个人信息越少越好。 */
export function cleanMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '')
  return text
    .replace(/https?:\/\/[^\s]+/g, (u) => stripUrl(u))
    .replace(/\d{8,}/g, '…')
    .slice(0, 200)
}

export function recordError(error: unknown, where?: string): void {
  const name = error instanceof Error ? error.name.slice(0, 60) : undefined
  const entry: ErrorEntry = { message: cleanMessage(error), at: Date.now() }
  if (name) entry.name = name
  if (where) entry.where = where.slice(0, 80)
  pushLimited(errors, entry, ERROR_LIMIT)
}

export function recordCrumb(crumb: Omit<Crumb, 'at'>): void {
  const text = crumb.kind === 'tap' ? crumb.text.slice(0, 160) : stripUrl(crumb.text).slice(0, 160)
  pushLimited(crumbs, { ...crumb, text, at: Date.now() }, CRUMB_LIMIT)
}

/** http.ts 每次请求结束时调用：只记方法、路径、状态、耗时、请求 ID。 */
export function recordApi(info: { method: string; path: string; status: number; ms: number; reqId: string }): void {
  const crumb: Omit<Crumb, 'at'> = { kind: 'api', text: `${info.method} ${stripUrl(info.path)}`, ms: Math.max(0, Math.round(info.ms)), reqId: info.reqId }
  if (info.status >= 100 && info.status <= 599) crumb.status = info.status
  recordCrumb(crumb)
}

// ---------------------------------------------------------------- 当前位置（做题页写入）

const here: Pick<FeedbackContext, 'problemId' | 'attemptId' | 'layer' | 'mode' | 'stepNo'> = {}

/** 做题页告诉探针：现在在哪道题、哪一层、做到第几步。传 undefined 的键会被清掉。 */
export function setProbeContext(patch: Partial<typeof here>): void {
  for (const key of Object.keys(patch) as Array<keyof typeof here>) {
    const value = patch[key]
    if (value === undefined) delete here[key]
    else (here as Record<string, unknown>)[key] = value
  }
}

export function clearProbeContext(): void {
  for (const key of Object.keys(here)) delete (here as Record<string, unknown>)[key]
}

// ---------------------------------------------------------------- 安装（只在浏览器里）

function currentRoute(): string {
  if (typeof window === 'undefined') return ''
  return routeOf(window.location.hash || window.location.pathname)
}

/** 取最近的 data-fb 名：点击与圈选都用它。 */
export function fbNameOf(node: unknown): string | null {
  let el = node instanceof Element ? node : null
  while (el) {
    const name = el.getAttribute?.('data-fb')
    if (name) return name.slice(0, 80)
    el = el.parentElement
  }
  return null
}

export function installProbe(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  recordCrumb({ kind: 'nav', text: currentRoute() })
  window.addEventListener('hashchange', () => recordCrumb({ kind: 'nav', text: currentRoute() }))
  window.addEventListener('error', (event) => recordError(event.error ?? event.message, 'window'))
  window.addEventListener('unhandledrejection', (event) => recordError(event.reason, 'promise'))
  document.addEventListener(
    'click',
    (event) => {
      const name = fbNameOf(event.target)
      if (name) recordCrumb({ kind: 'tap', text: name })
    },
    true,
  )
}

// ---------------------------------------------------------------- 收集

export interface CollectOptions {
  /** 学生圈到/点到的 data-fb 名。 */
  targets?: string[]
  theme?: 'light' | 'dark'
  motion?: boolean
  /** 测试注入。 */
  extended?: boolean
  route?: string
}

/** 拼出这条反馈要带的上下文。不开扩展时只有位置类字段。 */
export function collectContext(options: CollectOptions = {}): FeedbackContext {
  const extended = options.extended ?? EXTENDED
  // 不管路径从哪来，都再清一遍 query/hash（里面可能带 token、学号）。
  const route = routeOf(options.route ?? currentRoute())
  const ctx: FeedbackContext = {}
  if (route) {
    ctx.route = route
    const name = pageNameOf(route)
    if (name) ctx.pageName = name
  }
  Object.assign(ctx, here)
  const targets = (options.targets ?? []).slice(0, TARGET_LIMIT)
  if (targets.length > 0) ctx.targets = targets

  if (extended) {
    const nav = typeof navigator === 'undefined' ? null : navigator
    const win = typeof window === 'undefined' ? null : window
    const env = parseEnv(nav?.userAgent ?? '', win?.innerWidth ?? 0, win?.innerHeight ?? 0, win?.devicePixelRatio ?? 0)
    ctx.env = { ...env, ...(options.theme ? { theme: options.theme } : {}), ...(options.motion === undefined ? {} : { motion: options.motion }), ...(nav ? { online: nav.onLine } : {}) }
    const version = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_VERSION
    const sha = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_SHA
    if (version || sha) ctx.app = { ...(version ? { version: version.slice(0, 32) } : {}), ...(sha ? { sha: sha.slice(0, 40) } : {}) }
    if (errors.length > 0) ctx.errors = errors.map((e) => ({ ...e }))
    if (crumbs.length > 0) ctx.breadcrumbs = crumbs.map((c) => ({ ...c }))
  }
  return ctx
}

/** 测试用：清空缓冲。 */
export function resetProbe(): void {
  errors.length = 0
  crumbs.length = 0
  clearProbeContext()
}
