/**
 * 反馈循环：每次服务端 state 落到页面时，比较前后两份 state，决定弹反馈面板、层间过场，还是什么都不做。
 * 判断在 components/practice/feedback.ts（纯函数）；这里只管开关、音效、震动和奖励的去向。
 */
import { ref } from 'vue'
import { consumeRewards } from '@/api/client'
import { computeFeedback, computeInterstitial, type FeedbackView, type InterstitialView } from '@/components/practice/feedback'
import { vibrate } from '@/motion/haptics'
import { playSfx } from '@/motion/sfx'
import type { AttemptState, RewardsView } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'

export function useFeedback(session: Pick<AttemptSession, 'onTransition'>) {
  const feedback = ref<FeedbackView | null>(null)
  const interstitial = ref<InterstitialView | null>(null)
  /** 完成这次写接口带回的奖励：完成页要累加经验、显示连胜和新徽章。 */
  const completionRewards = ref<RewardsView | null>(null)

  function onTransition(prev: AttemptState, next: AttemptState): void {
    const rewards = consumeRewards()
    if (next.status === 'completed' && prev.status !== 'completed' && next.mode !== 'test') completionRewards.value = rewards
    const between = computeInterstitial(prev, next, rewards)
    if (between) {
      feedback.value = null
      interstitial.value = between
      playSfx('layer-up')
      vibrate('tap')
      return
    }
    const view = computeFeedback(prev, next, rewards)
    // 什么都不用说的状态变化（比如关闭批注）不打断已经开着的面板。
    if (!view) return
    feedback.value = view
    if (view.sfx) playSfx(view.sfx)
    if (view.tone === 'ok') vibrate('tap')
  }
  session.onTransition(onTransition)

  function dismissFeedback(): void {
    feedback.value = null
  }
  function dismissInterstitial(): void {
    interstitial.value = null
  }
  function reset(): void {
    feedback.value = null
    interstitial.value = null
    completionRewards.value = null
  }

  return { feedback, interstitial, completionRewards, dismissFeedback, dismissInterstitial, reset }
}

export type FeedbackHandle = ReturnType<typeof useFeedback>
