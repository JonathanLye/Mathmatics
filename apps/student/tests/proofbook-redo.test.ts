import { describe, expect, it } from 'vitest'

import {
  independenceLevel,
  independenceOf,
  listRedoable,
  type CompletedAttemptView,
} from '@/components/proofbook/redo'

/** issue #47 P1-2：证明本「稍后重做」纯逻辑（6+ 用例）。 */

const NOW = '2026-11-03T12:00:00.000Z'

function attempt(overrides: Partial<CompletedAttemptView> = {}): CompletedAttemptView {
  return {
    attemptId: 'attempt-1',
    problemId: 'epsN',
    title: '数列极限 · ε-N',
    completedAt: '2026-11-01T10:00:00.000Z',
    kind: 'main',
    independence: 0.2,
    ...overrides,
  }
}

describe('证明本「稍后重做」：列表、排序与入口数据', () => {
  it('空输入 → 空列表、next = null', () => {
    const result = listRedoable([], { now: NOW })
    expect(result.redoable).toEqual([])
    expect(result.next).toBeNull()
    expect(result.total).toBe(0)
    expect(result.skippedRecent).toBe(0)
  })

  it('依赖题入列，并给出重做入口数据', () => {
    const result = listRedoable([attempt({ independence: 0.2 })], { now: NOW })
    expect(result.total).toBe(1)
    const entry = result.next
    expect(entry).not.toBeNull()
    expect(entry).toMatchObject({
      attemptId: 'attempt-1',
      sourceAttemptId: 'attempt-1',
      problemId: 'epsN',
      independence: 0.2,
      level: 'dependent',
    })
    expect(entry?.entry).toEqual({
      mode: 'redo',
      attemptId: 'attempt-1',
      problemId: 'epsN',
      assignmentId: null,
      problemVersion: null,
    })
  })

  it('独立题（≥0.85）不推；有提示题（0.5–0.85）默认不推、includeHinted 时推', () => {
    const list = [attempt({ attemptId: 'a-ind', problemId: 'p-ind', independence: 0.9 }), attempt({ attemptId: 'a-hint', problemId: 'p-hint', independence: 0.6 })]
    expect(listRedoable(list, { now: NOW }).total).toBe(0)
    const hinted = listRedoable(list, { now: NOW, includeHinted: true })
    expect(hinted.total).toBe(1)
    expect(hinted.next).toMatchObject({ attemptId: 'a-hint', level: 'hinted' })
  })

  it('教师/系统标记的题即使独立度高也入列，且排在最前', () => {
    const result = listRedoable(
      [
        attempt({ attemptId: 'low', problemId: 'p-low', independence: 0.1 }),
        attempt({ attemptId: 'flagged', problemId: 'p-flagged', independence: 0.95, redoRecommended: true }),
      ],
      { now: NOW },
    )
    expect(result.total).toBe(2)
    expect(result.next?.attemptId).toBe('flagged')
    expect(result.next?.reason).toContain('标记')
    expect(result.redoable.map((entry) => entry.attemptId)).toEqual(['flagged', 'low'])
  })

  it('同一题多次完成：只保留最新一条，标记取并集', () => {
    const result = listRedoable(
      [
        attempt({ attemptId: 'old', completedAt: '2026-10-20T10:00:00.000Z', redoRecommended: true }),
        attempt({ attemptId: 'new', completedAt: '2026-11-01T10:00:00.000Z', independence: 0.1 }),
      ],
      { now: NOW },
    )
    expect(result.total).toBe(1)
    expect(result.next?.attemptId).toBe('new')
    expect(result.next?.reason).toContain('标记')
  })

  it('排序：标记 > 独立度升序 > 完成时间倒序', () => {
    const result = listRedoable(
      [
        attempt({ attemptId: 'mid', problemId: 'p-mid', independence: 0.3, completedAt: '2026-10-30T10:00:00.000Z' }),
        attempt({ attemptId: 'low', problemId: 'p-low', independence: 0.1, completedAt: '2026-10-31T10:00:00.000Z' }),
        attempt({ attemptId: 'tie-new', problemId: 'p-tie-new', independence: 0.4, completedAt: '2026-11-02T10:00:00.000Z' }),
        attempt({ attemptId: 'tie-old', problemId: 'p-tie-old', independence: 0.4, completedAt: '2026-10-25T10:00:00.000Z' }),
      ],
      { now: NOW },
    )
    expect(result.redoable.map((entry) => entry.attemptId)).toEqual(['low', 'mid', 'tie-new', 'tie-old'])
  })

  it('冷却期：最近 N 天完成的不推，计入 skippedRecent', () => {
    const list = [
      attempt({ attemptId: 'fresh', problemId: 'p-fresh', completedAt: '2026-11-03T10:00:00.000Z' }),
      attempt({ attemptId: 'old', problemId: 'p-old', completedAt: '2026-10-01T10:00:00.000Z' }),
    ]
    const result = listRedoable(list, { now: NOW, cooldownDays: 1 })
    expect(result.total).toBe(1)
    expect(result.next?.attemptId).toBe('old')
    expect(result.skippedRecent).toBe(1)
  })

  it('limit 截断：total 是截断前数量，next 是第一条', () => {
    const list = ['a', 'b', 'c'].map((id, index) =>
      attempt({ attemptId: id, problemId: `p-${id}`, independence: 0.1 + index * 0.1, completedAt: `2026-10-0${index + 1}T10:00:00.000Z` }),
    )
    const result = listRedoable(list, { now: NOW, limit: 2 })
    expect(result.redoable).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.next?.attemptId).toBe('a')
  })

  it('独立度未知（无 independence / keysTotal）不猜：默认不推，标记时推', () => {
    const unknown = attempt({ attemptId: 'unknown', problemId: 'p-unknown', independence: null })
    expect(listRedoable([unknown], { now: NOW }).total).toBe(0)
    const flagged = listRedoable([{ ...unknown, redoRecommended: true }], { now: NOW })
    expect(flagged.total).toBe(1)
    expect(flagged.next?.level).toBe('unknown')
  })

  it('独立度兜底公式：1 − revealUsed / keysTotal，并夹到 0–1', () => {
    expect(independenceOf({ ...attempt(), independence: null, revealUsed: 2, keysTotal: 4 })).toBe(0.5)
    expect(independenceOf({ ...attempt(), independence: null, revealUsed: 9, keysTotal: 4 })).toBe(0)
    expect(independenceOf({ ...attempt(), independence: null, revealUsed: 0, keysTotal: 0 })).toBeNull()
  })

  it('独立度分档：≥0.85 独立 / 0.5–0.85 有提示 / <0.5 依赖 / 未知', () => {
    expect(independenceLevel(0.9)).toBe('independent')
    expect(independenceLevel(0.6)).toBe('hinted')
    expect(independenceLevel(0.4)).toBe('dependent')
    expect(independenceLevel(null)).toBe('unknown')
    expect(independenceLevel(0.5, 0.6)).toBe('dependent')
  })
})
