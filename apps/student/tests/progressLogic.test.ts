import { describe, expect, it } from 'vitest'
import { badgeFraction, badgeIcon, earnedBadges, goalFraction, goalReached, nextBadge, shanghaiDay, weekDots, type BadgeView } from '@/components/progressLogic'

const badge = (over: Partial<BadgeView> = {}): BadgeView => ({ id: 'x', title: 't', desc: 'd', earnedAt: null, ...over })

describe('上海日期', () => {
  it('跨零点按东八区算', () => {
    expect(shanghaiDay(Date.UTC(2026, 10, 5, 15, 59))).toBe('2026-11-05')
    expect(shanghaiDay(Date.UTC(2026, 10, 5, 16, 0))).toBe('2026-11-06')
  })
})

describe('一周七个点', () => {
  const week = ['02', '03', '04', '05', '06', '07', '08'].map((d, i) => ({ day: '2026-11-' + d, xp: i < 2 ? 10 : 0, keys: i < 2 ? 1 : 0 }))

  it('学过的、请假的、今天、过去、未来', () => {
    const dots = weekDots({ week, streak: { current: 2, best: 2, freezeAvailable: false, usedFreezeDays: ['2026-11-04'] } }, '2026-11-06')
    expect(dots.map((d) => d.state)).toEqual(['done', 'done', 'freeze', 'past', 'today', 'future', 'future'])
    expect(dots.map((d) => d.label).join('')).toBe('一二三四五六日')
    expect(dots.filter((d) => d.isToday).map((d) => d.day)).toEqual(['2026-11-06'])
  })

  it('今天已经学了就是 done，不再是 today', () => {
    const dots = weekDots({ week: week.map((w) => ({ ...w, xp: 5 })), streak: { current: 1, best: 1, freezeAvailable: true, usedFreezeDays: [] } }, '2026-11-06')
    expect(dots[4]).toMatchObject({ state: 'done', isToday: true })
  })
})

describe('今日目标', () => {
  it('比例夹在 0–1，目标坏值当 0', () => {
    expect(goalFraction({ keysToday: 2, dailyGoal: 4 })).toBe(0.5)
    expect(goalFraction({ keysToday: 9, dailyGoal: 3 })).toBe(1)
    expect(goalFraction({ keysToday: 9, dailyGoal: 0 })).toBe(0)
    expect(goalFraction(null)).toBe(0)
  })

  it('达成', () => {
    expect(goalReached({ keysToday: 3, dailyGoal: 3 })).toBe(true)
    expect(goalReached({ keysToday: 2, dailyGoal: 3 })).toBe(false)
    expect(goalReached(null)).toBe(false)
  })
})

describe('徽章', () => {
  it('下一枚：进度最靠前的未得徽章', () => {
    const list = [
      badge({ id: 'a', earnedAt: '2026-11-01T00:00:00.000Z' }),
      badge({ id: 'b' }),
      badge({ id: 'c', progress: { current: 1, target: 7 } }),
      badge({ id: 'd', progress: { current: 2, target: 3 } }),
    ]
    expect(nextBadge(list)?.id).toBe('d')
    expect(earnedBadges(list).map((b) => b.id)).toEqual(['a'])
  })

  it('没有进度时取目录第一枚；全拿到返回 null', () => {
    expect(nextBadge([badge({ id: 'b' }), badge({ id: 'c' })])?.id).toBe('b')
    expect(nextBadge([badge({ earnedAt: 'x' })])).toBeNull()
    expect(nextBadge([])).toBeNull()
  })

  it('进度比例和图标', () => {
    expect(badgeFraction(badge({ earnedAt: 'x' }))).toBe(1)
    expect(badgeFraction(badge())).toBe(0)
    expect(badgeFraction(badge({ progress: { current: 1, target: 4 } }))).toBe(0.25)
    expect(badgeFraction(badge({ progress: { current: 1, target: 0 } }))).toBe(0)
    expect(badgeIcon('streak_7')).toBe('flame')
    expect(badgeIcon('没见过')).toBe('star')
  })
})
