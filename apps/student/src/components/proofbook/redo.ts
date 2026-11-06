/**
 * 证明本「稍后重做」纯逻辑（issue #47 P1-2）。
 *
 * 输入：已完成作答的卡片（学生端本地 / GET /student/notebook 的 completed 列表的字段子集，
 *      见 packages/contracts/openapi.yaml 的 Notebook/AssignmentCard；本模块只镜像用到的字段）。
 * 输出：「可稍后重做」列表（排序、按题去重、可选冷却期）、下一次入口数据（开始重做时用）。
 *
 * 判定口径（04 教师端规格·独立度 / 08 §4.1）：
 *  - 独立度 = 1 − 透露量 / 关键步骤数（0–1，跨题不可比）；
 *  - 分档：≥0.85 独立 / 0.5–0.85 有提示 / <0.5 依赖（阈值可配，默认按规格）；
 *  - 只把「依赖」和教师标记 redoRecommended 的题放进稍后重做；可选把「有提示」也纳入；
 *  - 同一题多次完成只保留最新一条（避免重复入口），但 redoRecommended 标记取多次的并集；
 *  - 排序：教师标记 > 独立度升序（越低越该重做）> 完成时间倒序；冷却期内刚做完的题先不推。
 *
 * 纯逻辑：不读 DOM、不发请求，便于单测；重做的真实接口（#74 /student/notebook、#26 证明本页）
 * 合入后由证明本页接线，本模块不改页面。
 */

export interface CompletedAttemptView {
  attemptId: string
  problemId: string
  title: string
  /** ISO 8601 完成时间 */
  completedAt: string
  /** main = 主题作答；transfer = 迁移题子作答 */
  kind?: 'main' | 'transfer'
  /** 服务端算好的独立度；缺省时用 revealUsed / keysTotal 兜底 */
  independence?: number | null
  revealUsed?: number
  revealMax?: number
  keysTotal?: number
  /** 教师/系统标记「稍后重做」 */
  redoRecommended?: boolean
  /** 重做入口所需的布置 id / 题目版本（服务端 notebook 提供，缺省则入口数据为 null） */
  assignmentId?: string | null
  problemVersion?: number
}

export type IndependenceLevel = 'independent' | 'hinted' | 'dependent' | 'unknown'

export interface RedoOptions {
  /** 低于该独立度视为「依赖」；默认 0.5（04 §独立度分档） */
  threshold?: number
  /** 是否把「有提示」（0.5–0.85）也纳入稍后重做；默认 false（只推依赖） */
  includeHinted?: boolean
  /** 最近 N 天内完成的先不推；默认 0 = 不设冷却 */
  cooldownDays?: number
  /** 最多返回几条；默认 10 */
  limit?: number
  /** 参考时间（测试注入）；默认当前时间 */
  now?: number | string | Date
}

export interface RedoEntry {
  attemptId: string
  sourceAttemptId: string
  problemId: string
  title: string
  completedAt: string
  independence: number | null
  /** 关键步骤数：页面上把独立度说成“N 步里 M 步靠自己”。 */
  keysTotal: number | null
  level: IndependenceLevel
  reason: string
  /** 排序序号，0 最靠前；只用于稳定排序与调试 */
  priority: number
  /** 开始重做时的入口数据（新作答复用同一题/布置；assignmentId 缺失时由 UI 回首页） */
  entry: {
    mode: 'redo'
    attemptId: string
    problemId: string
    assignmentId: string | null
    problemVersion: number | null
  }
}

export interface RedoList {
  redoable: RedoEntry[]
  /** 下一次入口（列表第一条），没有可重做的题时为 null */
  next: RedoEntry | null
  /** 去重、冷却期之后的可重做总数（limit 截断前） */
  total: number
  /** 因为冷却期被排除的题数 */
  skippedRecent: number
}

const DEFAULT_THRESHOLD = 0.5
const DEFAULT_LIMIT = 10
const INDEPENDENT_THRESHOLD = 0.85
const DAY_MS = 24 * 60 * 60 * 1000

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 独立度：优先用服务端算好的值；否则 1 − revealUsed / keysTotal（08 §4.1）。
 * 数据不足（keysTotal 缺失或 ≤0）时返回 null（展示为「—」，不猜）。
 */
export function independenceOf(attempt: CompletedAttemptView): number | null {
  if (typeof attempt.independence === 'number' && Number.isFinite(attempt.independence)) {
    return clamp01(attempt.independence)
  }
  const keysTotal = attempt.keysTotal
  const revealUsed = attempt.revealUsed
  if (typeof keysTotal === 'number' && keysTotal > 0 && typeof revealUsed === 'number' && Number.isFinite(revealUsed)) {
    return clamp01(1 - revealUsed / keysTotal)
  }
  return null
}

/** 独立度分档（04 §独立度分档；阈值可配置时调用方自行比较）。 */
export function independenceLevel(value: number | null, threshold = DEFAULT_THRESHOLD): IndependenceLevel {
  if (value === null) return 'unknown'
  if (value >= INDEPENDENT_THRESHOLD) return 'independent'
  if (value >= threshold) return 'hinted'
  return 'dependent'
}

function toTimestamp(value: string | number | Date | undefined): number {
  if (value === undefined) return Date.now()
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function completedTimestamp(attempt: CompletedAttemptView): number {
  const parsed = Date.parse(attempt.completedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

interface MergedAttempt extends CompletedAttemptView {
  redoRecommended: boolean
}

/** 同一题多次完成：保留最新一条，redoRecommended 取并集。 */
function dedupeByProblem(attempts: readonly CompletedAttemptView[]): MergedAttempt[] {
  const byProblem = new Map<string, MergedAttempt>()
  for (const attempt of attempts) {
    const recommended = attempt.redoRecommended === true
    const existing = byProblem.get(attempt.problemId)
    if (existing === undefined) {
      byProblem.set(attempt.problemId, { ...attempt, redoRecommended: recommended })
      continue
    }
    const isNewer = completedTimestamp(attempt) >= completedTimestamp(existing)
    const merged: MergedAttempt = {
      ...(isNewer ? attempt : existing),
      redoRecommended: existing.redoRecommended || recommended,
    }
    byProblem.set(attempt.problemId, merged)
  }
  return [...byProblem.values()]
}

function buildEntry(attempt: MergedAttempt, independence: number | null): RedoEntry {
  const level = independenceLevel(independence)
  return {
    attemptId: attempt.attemptId,
    sourceAttemptId: attempt.attemptId,
    problemId: attempt.problemId,
    title: attempt.title,
    completedAt: attempt.completedAt,
    independence,
    keysTotal: attempt.keysTotal ?? null,
    level,
    reason: attempt.redoRecommended
      ? '老师/系统标记：稍后重做'
      : '这一题再自己写一遍',
    priority: 0,
    entry: {
      mode: 'redo',
      attemptId: attempt.attemptId,
      problemId: attempt.problemId,
      assignmentId: attempt.assignmentId ?? null,
      problemVersion: attempt.problemVersion ?? null,
    },
  }
}

/**
 * 生成证明本的「稍后重做」列表与下一次入口。
 * 不修改入参；结果按「教师标记 → 独立度升序 → 完成时间倒序」排序后截断到 limit。
 */
export function listRedoable(attempts: readonly CompletedAttemptView[], options: RedoOptions = {}): RedoList {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const includeHinted = options.includeHinted === true
  const cooldownDays = Math.max(0, options.cooldownDays ?? 0)
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  const now = toTimestamp(options.now)
  const cooldownMs = cooldownDays * DAY_MS

  const merged = dedupeByProblem(attempts)
  let skippedRecent = 0
  const candidates: Array<{ attempt: MergedAttempt; independence: number | null }> = []
  for (const attempt of merged) {
    if (cooldownMs > 0 && now - completedTimestamp(attempt) < cooldownMs) {
      skippedRecent += 1
      continue
    }
    const independence = independenceOf(attempt)
    const level = independenceLevel(independence, threshold)
    const wanted = attempt.redoRecommended || level === 'dependent' || (includeHinted && level === 'hinted')
    if (wanted) candidates.push({ attempt, independence })
  }

  candidates.sort((left, right) => {
    const leftRecommended = left.attempt.redoRecommended ? 1 : 0
    const rightRecommended = right.attempt.redoRecommended ? 1 : 0
    if (leftRecommended !== rightRecommended) return rightRecommended - leftRecommended
    const leftValue = left.independence === null ? Number.POSITIVE_INFINITY : left.independence
    const rightValue = right.independence === null ? Number.POSITIVE_INFINITY : right.independence
    if (leftValue !== rightValue) return leftValue - rightValue
    return completedTimestamp(right.attempt) - completedTimestamp(left.attempt)
  })

  const redoable = candidates.slice(0, limit).map((candidate, index) => {
    const entry = buildEntry(candidate.attempt, candidate.independence)
    return { ...entry, priority: index }
  })
  return {
    redoable,
    next: redoable[0] ?? null,
    total: candidates.length,
    skippedRecent,
  }
}
