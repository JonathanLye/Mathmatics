/**
 * 练习区的纯逻辑（无 DOM，tests/zoneLogic.test.ts 覆盖）：筛选条件的保存与请求、结果计数、解题思路该显示哪一步。
 * 可不可以看解答、看到哪一级都由服务端决定；这里只是把响应翻译成界面状态。
 */
import type { DifficultyBand, NodeState, PracticeFacets, PracticeItem, PracticeQuery, PracticeSolution } from '@/types/path'

export interface ZoneFilters {
  chapter: string
  difficulty: DifficultyBand | 'all'
  status: NodeState | 'all'
  q: string
}

export const EMPTY_FILTERS: Readonly<ZoneFilters> = { chapter: '', difficulty: 'all', status: 'all', q: '' }
export const ZONE_PAGE_SIZE = 20
/** 服务端每页最多 50 条。 */
export const ZONE_REFRESH_MAX = 50

const STORAGE_KEY = 'pg.zone.filters.v1'
const BANDS = new Set(['easy', 'medium', 'hard'])
const STATUSES = new Set(['todo', 'active', 'done'])

export function parseFilters(raw: string | null | undefined): ZoneFilters {
  if (!raw) return { ...EMPTY_FILTERS }
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof ZoneFilters, unknown>>
    return {
      chapter: typeof value.chapter === 'string' ? value.chapter : '',
      difficulty: BANDS.has(String(value.difficulty)) ? (value.difficulty as DifficultyBand) : 'all',
      status: STATUSES.has(String(value.status)) ? (value.status as NodeState) : 'all',
      q: typeof value.q === 'string' ? value.q : '',
    }
  } catch {
    return { ...EMPTY_FILTERS }
  }
}

/** 筛选条件这次打开里都留着：从题目回来、切标签回来都不变。 */
export function loadFilters(): ZoneFilters {
  try {
    return parseFilters(typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return { ...EMPTY_FILTERS }
  }
}

export function saveFilters(filters: ZoneFilters): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  } catch {
    /* 隐私模式写不进去：本页还留着 */
  }
}

export function filtersActive(filters: ZoneFilters): boolean {
  return filters.chapter !== '' || filters.difficulty !== 'all' || filters.status !== 'all' || filters.q.trim() !== ''
}

/** 筛选条件 → 请求参数；“全部”就是不传。 */
export function zoneQuery(filters: ZoneFilters, extra: Pick<PracticeQuery, 'cursor' | 'limit'> = {}): PracticeQuery {
  const q = filters.q.trim()
  return {
    ...(filters.chapter ? { chapter: filters.chapter } : {}),
    ...(filters.difficulty === 'all' ? {} : { difficulty: filters.difficulty }),
    ...(filters.status === 'all' ? {} : { status: filters.status }),
    ...(q ? { q } : {}),
    limit: extra.limit ?? ZONE_PAGE_SIZE,
    ...(extra.cursor ? { cursor: extra.cursor } : {}),
  }
}

/** 随机来一道只看章节和难度（服务端只会给没做完的）。 */
export function randomFilter(filters: ZoneFilters): { chapter?: string; difficulty?: DifficultyBand } {
  return {
    ...(filters.chapter ? { chapter: filters.chapter } : {}),
    ...(filters.difficulty === 'all' ? {} : { difficulty: filters.difficulty }),
  }
}

/** 结果总数：难度分面算的是“其余条件都满足”的题数。 */
export function resultCount(facets: PracticeFacets | null | undefined, filters: ZoneFilters): number | null {
  if (!facets) return null
  if (filters.difficulty !== 'all') return facets.difficulty[filters.difficulty]
  return facets.difficulty.easy + facets.difficulty.medium + facets.difficulty.hard
}

/** 回到页面时刷新：一页装得下已加载的题就整页换（状态筛选可能让题消失），否则只更新看得到的状态。 */
export function mergeRefreshed(
  current: readonly PracticeItem[],
  refreshed: readonly PracticeItem[],
  refreshedAll: boolean,
): PracticeItem[] {
  if (refreshedAll) return [...refreshed]
  const byId = new Map(refreshed.map((item) => [item.problemId, item]))
  return current.map((item) => byId.get(item.problemId) ?? item)
}

export type SolutionStep = 'locked' | 'offer' | 'approach' | 'full' | 'unavailable'

/** 这一刻界面显示哪一步。 */
export function solutionStep(solution: PracticeSolution): SolutionStep {
  if (solution.level === 'full') return 'full'
  if (solution.level === 'approach') return 'approach'
  if (!solution.hasApproach && !solution.hasFull) return 'unavailable'
  return solution.canReveal ? 'offer' : 'locked'
}

/** 还能不能再往下看一级，看哪一级。没有整理好思路但有参考证明时，直接提供完整证明。 */
export function nextReveal(solution: PracticeSolution): 'approach' | 'full' | null {
  if (!solution.canReveal) return null
  if (solution.level === 'none') {
    if (solution.hasApproach) return 'approach'
    return solution.hasFull ? 'full' : null
  }
  if (solution.level === 'approach') return solution.hasFull ? 'full' : null
  return null
}
