/**
 * 连胜、今日目标、徽章的展示逻辑（无 DOM）。数字都来自 GET /student/progress，这里不算奖励。
 */
import type { IconName } from '@/components/ui/icons'
import type { ProgressView } from '@/types/attempt'

/** Asia/Shanghai 的自然日：服务端的连胜和每周统计都按这个算。 */
export function shanghaiDay(now: number = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export type WeekDotState = 'done' | 'freeze' | 'today' | 'past' | 'future'

export interface WeekDot {
  day: string
  label: string
  state: WeekDotState
  isToday: boolean
}

/** 周一到周日七个点。过去没学的日子只是空着，不标红。 */
export function weekDots(progress: Pick<ProgressView, 'week' | 'streak'>, today: string = shanghaiDay()): WeekDot[] {
  const freeze = new Set(progress.streak.usedFreezeDays)
  return progress.week.map((entry, i) => {
    const isToday = entry.day === today
    let state: WeekDotState
    if (entry.xp > 0 || entry.keys > 0) state = 'done'
    else if (freeze.has(entry.day)) state = 'freeze'
    else if (isToday) state = 'today'
    else state = entry.day < today ? 'past' : 'future'
    return { day: entry.day, label: WEEK_LABELS[i] ?? '', state, isToday }
  })
}

export function goalFraction(progress: Pick<ProgressView, 'keysToday' | 'dailyGoal'> | null | undefined): number {
  if (!progress || progress.dailyGoal <= 0) return 0
  return Math.min(1, Math.max(0, progress.keysToday / progress.dailyGoal))
}

export function goalReached(progress: Pick<ProgressView, 'keysToday' | 'dailyGoal'> | null | undefined): boolean {
  return Boolean(progress && progress.dailyGoal > 0 && progress.keysToday >= progress.dailyGoal)
}

export type BadgeView = ProgressView['badges'][number]

export function earnedBadges(badges: readonly BadgeView[]): BadgeView[] {
  return badges.filter((badge) => Boolean(badge.earnedAt))
}

/** 下一枚：没拿到的里面进度最靠前的；都没有进度时取目录里第一枚；全拿到了返回 null。 */
export function nextBadge(badges: readonly BadgeView[]): BadgeView | null {
  const locked = badges.filter((badge) => !badge.earnedAt)
  if (locked.length === 0) return null
  let best = locked[0]
  let bestRatio = -1
  for (const badge of locked) {
    const ratio = badge.progress && badge.progress.target > 0 ? badge.progress.current / badge.progress.target : 0
    if (ratio > bestRatio) {
      best = badge
      bestRatio = ratio
    }
  }
  return best
}

export function badgeFraction(badge: BadgeView): number {
  if (badge.earnedAt) return 1
  const progress = badge.progress
  if (!progress || progress.target <= 0) return 0
  return Math.min(1, Math.max(0, progress.current / progress.target))
}

export type BadgeIcon = Extract<IconName, 'pen' | 'flame' | 'flag' | 'star' | 'redo' | 'check'> | 'qed'

const BADGE_ICONS: Readonly<Record<string, BadgeIcon>> = {
  first_step: 'pen',
  own_write: 'pen',
  first_done: 'qed',
  streak_3: 'flame',
  streak_7: 'flame',
  streak_30: 'flame',
  unit_clear: 'flag',
  no_hint_clear: 'star',
  redo_success: 'redo',
  daily_goal: 'check',
}

/** 不认识的徽章（目录比前端新）给一颗星。 */
export function badgeIcon(id: string): BadgeIcon {
  return BADGE_ICONS[id] ?? 'star'
}
