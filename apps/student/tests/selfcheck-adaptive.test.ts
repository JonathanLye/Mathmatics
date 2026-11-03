import { describe, expect, it } from 'vitest'

import {
  nextSelfcheck,
  summarizeSelfcheck,
  type AdaptiveConfig,
  type SelfcheckItem,
  type SelfcheckRecord,
} from '@/components/selfcheck/adaptive'

/** issue #47 P1-2：L4 自检自适应纯逻辑（8+ 用例：全对/部分错/全错/空/重复）。 */

const ITEMS: SelfcheckItem[] = [
  { itemId: 'q-basis', dimension: 'basis' },
  { itemId: 'q-role', dimension: 'role' },
  { itemId: 'q-logic', dimension: 'logic' },
]

const pass = (itemId: string): SelfcheckRecord => ({ itemId, passed: true })
const fail = (itemId: string): SelfcheckRecord => ({ itemId, passed: false })

describe('自检自适应：选题与重试策略', () => {
  it('空题库 → done', () => {
    const decision = nextSelfcheck([], [])
    expect(decision.action).toBe('done')
    expect(decision.nextItemId).toBeNull()
    expect(decision.attemptNo).toBe(0)
  })

  it('空记录 → 按维度顺序出第一题（依据）', () => {
    const decision = nextSelfcheck(ITEMS, [])
    expect(decision.action).toBe('next')
    expect(decision.nextItemId).toBe('q-basis')
    expect(decision.attemptNo).toBe(1)
    expect(decision.waitQuestions).toBeNull()
  })

  it('维度顺序可配置（先作用后依据）', () => {
    const config: AdaptiveConfig = { dimensionOrder: ['role', 'basis', 'logic'] }
    expect(nextSelfcheck(ITEMS, [], config).nextItemId).toBe('q-role')
  })

  it('全对 → done', () => {
    const decision = nextSelfcheck(ITEMS, [pass('q-basis'), pass('q-role'), pass('q-logic')])
    expect(decision.action).toBe('done')
    expect(decision.nextItemId).toBeNull()
  })

  it('答错且 retryGap=0 → 立即重试同一题（第 2 次）', () => {
    const decision = nextSelfcheck(ITEMS, [fail('q-basis')], { retryGap: 0, maxAttempts: 3 })
    expect(decision.action).toBe('retry')
    expect(decision.nextItemId).toBe('q-basis')
    expect(decision.attemptNo).toBe(2)
    expect(decision.waitQuestions).toBe(0)
  })

  it('答错默认间隔 1 题：先出没做过的题，并提示还差几道到重试', () => {
    const decision = nextSelfcheck(ITEMS, [fail('q-basis')])
    expect(decision.action).toBe('next')
    expect(decision.nextItemId).toBe('q-role')
    expect(decision.waitQuestions).toBe(1)
  })

  it('间隔已到 → 重试之前答错的题', () => {
    const decision = nextSelfcheck(ITEMS, [fail('q-basis'), pass('q-role')])
    expect(decision.action).toBe('retry')
    expect(decision.nextItemId).toBe('q-basis')
    expect(decision.attemptNo).toBe(2)
  })

  it('部分错：答对 2 题、答错 1 题且次数用尽 → 跳过错题不再重试（全部用尽 → done）', () => {
    const broken: SelfcheckRecord[] = [
      fail('q-basis'),
      fail('q-basis'),
      pass('q-role'),
      pass('q-logic'),
    ]
    const decision = nextSelfcheck(ITEMS, broken, { maxAttempts: 2 })
    expect(decision.action).toBe('done')
    expect(decision.reason).toContain('用完')
  })

  it('全错：次数用尽后本轮结束（不无限重试）', () => {
    const allWrong: SelfcheckRecord[] = ITEMS.flatMap((item) => [fail(item.itemId), fail(item.itemId)])
    const decision = nextSelfcheck(ITEMS, allWrong, { maxAttempts: 2 })
    expect(decision.action).toBe('done')
    expect(decision.nextItemId).toBeNull()
  })

  it('重复记录以最新一次为准：先对后错 → 还要重试（maxAttempts 3）', () => {
    const records = [pass('q-basis'), fail('q-basis')]
    const decision = nextSelfcheck(ITEMS, records, { retryGap: 0, maxAttempts: 3 })
    expect(decision.action).toBe('retry')
    expect(decision.nextItemId).toBe('q-basis')
    expect(decision.attemptNo).toBe(3)
  })

  it('重复记录：先错后对 → 视为已通过（不会重试）', () => {
    const decision = nextSelfcheck(ITEMS, [fail('q-basis'), pass('q-basis')])
    expect(decision.action).toBe('next')
    expect(decision.nextItemId).toBe('q-role')
  })

  it('reviewAfter：全对后隔 2 条记录回顾最早答对的题', () => {
    const records = [pass('q-basis'), pass('q-role'), pass('q-logic')]
    const decision = nextSelfcheck(ITEMS, records, { reviewAfter: 2 })
    expect(decision.action).toBe('review')
    expect(decision.nextItemId).toBe('q-basis')
    expect(decision.attemptNo).toBe(2)
  })

  it('未知 itemId 的记录被忽略（不污染选题）', () => {
    const decision = nextSelfcheck(ITEMS, [{ itemId: 'q-unknown', passed: false }])
    expect(decision.action).toBe('next')
    expect(decision.nextItemId).toBe('q-basis')
  })

  it('summarizeSelfcheck 汇总每题次数/最近结果/错误数', () => {
    const summary = summarizeSelfcheck(ITEMS, [fail('q-basis'), pass('q-basis'), pass('q-role')])
    const basis = summary.find((entry) => entry.item.itemId === 'q-basis')
    expect(basis).toMatchObject({ attempts: 2, latestPassed: true, failedAttempts: 1, recordsSinceLastAttempt: 1 })
    expect(summary.find((entry) => entry.item.itemId === 'q-logic')?.attempts).toBe(0)
  })
})
