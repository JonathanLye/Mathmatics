import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '@/components/ui/useToast'
import { REWARD_FLOAT_MS, REWARD_TOAST_GAP_MS, __resetRewardsForTests, rewardFloats, rewardMessages, useRewards, xpText } from '@/motion/useRewards'
import { __resetFeedbackPrefsForTests, setFeedbackTestMode } from '@/motion/useFeedbackPrefs'
import type { RewardsView } from '@/types/attempt'

const REWARDS: RewardsView = {
  xp: 15,
  items: [
    { kind: 'key_own', amount: 10, label: '独立写出关键步骤' },
    { kind: 'layer', amount: 5, label: '完成一层' },
  ],
  badges: [{ id: 'first_step', title: '第一步', desc: 'd' }],
  streak: { current: 4, extended: true },
  goalReached: true,
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetFeedbackPrefsForTests()
  __resetRewardsForTests()
})
afterEach(() => {
  vi.useRealTimers()
  useToast().hide()
  __resetRewardsForTests()
})

describe('奖励文案', () => {
  it('飘字按每一笔经验', () => {
    expect(xpText(10)).toBe('+10 经验')
    expect(rewardFloats(REWARDS)).toEqual(['+10 经验', '+5 经验'])
    expect(rewardFloats(null)).toEqual([])
    expect(rewardFloats({ ...REWARDS, items: [{ kind: 'daily', amount: 0, label: 'x' }] })).toEqual([])
  })

  it('徽章、目标、连胜进轻提示；完成一题时带总经验', () => {
    expect(rewardMessages(REWARDS)).toEqual(['新徽章：第一步', '今日目标达成', '连胜 4 天'])
    expect(rewardMessages(REWARDS, { completion: true })[0]).toBe('这一步拿到 15 经验')
    expect(rewardMessages(null)).toEqual([])
    expect(rewardMessages({ xp: 3, items: [], badges: [] })).toEqual([])
  })
})

describe('useRewards', () => {
  it('轻提示排队，一条放完才放下一条', () => {
    const { present } = useRewards()
    const toast = useToast()
    present(REWARDS)
    expect(toast.state.message).toBe('新徽章：第一步')
    vi.advanceTimersByTime(REWARD_TOAST_GAP_MS)
    expect(toast.state.message).toBe('今日目标达成')
    vi.advanceTimersByTime(REWARD_TOAST_GAP_MS)
    expect(toast.state.message).toBe('连胜 4 天')
  })

  it('测验模式：什么都不显示', () => {
    setFeedbackTestMode(true)
    const { present, floats } = useRewards()
    present(REWARDS, { completion: true })
    vi.advanceTimersByTime(1000)
    expect(useToast().state.message).toBe('')
    expect(floats.value).toEqual([])
  })

  it('没有 rewards 时不动；飘字到点自己消失', () => {
    const { present, floats } = useRewards()
    present(null)
    expect(useToast().state.message).toBe('')
    present({ xp: 10, items: [{ kind: 'key_own', amount: 10, label: 'x' }], badges: [] })
    vi.advanceTimersByTime(10)
    expect(floats.value.map((f) => f.text)).toEqual(['+10 经验'])
    vi.advanceTimersByTime(REWARD_FLOAT_MS + 10)
    expect(floats.value).toEqual([])
  })
})
