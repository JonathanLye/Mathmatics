/**
 * 奖励提示：把作答写接口带回的 rewards 变成一串轻提示和“+10 经验”飘字。
 *
 * 用法（做题页）：每次 await 写接口之后 `rewards.present(consumeRewards())`；页面放一个 <RewardFloats /> 显示飘字。
 * 只负责提示，不计算奖励（规则都在服务端）。测验模式下什么都不显示，也不响。
 */
import { computed, readonly, ref, type ComputedRef, type DeepReadonly, type Ref } from 'vue'
import { useToast } from '@/components/ui/useToast'
import type { RewardsView } from '@/types/attempt'
import { playSfx } from './sfx'
import { feedbackAllowed, useFeedbackPrefs } from './useFeedbackPrefs'

export interface RewardFloat {
  id: number
  text: string
}

export const REWARD_FLOAT_MS = 1400
export const REWARD_TOAST_GAP_MS = 2400

export function xpText(amount: number): string {
  return `+${amount} 经验`
}

/** 飘字：每一笔经验一条（按提交顺序）。 */
export function rewardFloats(rewards: RewardsView | null | undefined): string[] {
  return (rewards?.items ?? []).filter((item) => item.amount > 0).map((item) => xpText(item.amount))
}

/** 轻提示：徽章和里程碑总是提示；completion=true（完成一题）时把这一笔的总经验也说出来。 */
export function rewardMessages(rewards: RewardsView | null | undefined, options: { completion?: boolean } = {}): string[] {
  if (!rewards) return []
  const out: string[] = []
  if (options.completion && rewards.xp > 0) out.push(`这一步拿到 ${rewards.xp} 经验`)
  for (const badge of rewards.badges ?? []) out.push(`新徽章：${badge.title}`)
  if (rewards.goalReached) out.push('今日目标达成')
  if (rewards.streak?.extended) out.push(`连胜 ${rewards.streak.current} 天`)
  return out
}

const floats = ref<RewardFloat[]>([])
const queue: string[] = []
let nextId = 1
let toastTimer: ReturnType<typeof setTimeout> | null = null

function pumpToasts(): void {
  if (toastTimer || queue.length === 0) return
  useToast().show(queue.shift() as string, { tone: 'ok', duration: REWARD_TOAST_GAP_MS - 200 })
  toastTimer = setTimeout(() => {
    toastTimer = null
    pumpToasts()
  }, REWARD_TOAST_GAP_MS)
}

function pushFloat(text: string, delay: number): void {
  setTimeout(() => {
    const id = nextId++
    floats.value = [...floats.value, { id, text }]
    setTimeout(() => {
      floats.value = floats.value.filter((f) => f.id !== id)
    }, REWARD_FLOAT_MS)
  }, delay)
}

export interface RewardsHandle {
  floats: DeepReadonly<Ref<RewardFloat[]>>
  muted: ComputedRef<boolean>
  present: (rewards: RewardsView | null | undefined, options?: { completion?: boolean }) => void
}

export function useRewards(): RewardsHandle {
  const prefs = useFeedbackPrefs()

  function present(rewards: RewardsView | null | undefined, options: { completion?: boolean } = {}): void {
    if (!rewards || prefs.muted.value) return
    const texts = rewardFloats(rewards)
    if (feedbackAllowed('motion')) texts.forEach((text, i) => pushFloat(text, i * 220))
    const messages = rewardMessages(rewards, options)
    if (messages.length === 0) return
    queue.push(...messages)
    playSfx(rewards.badges?.length || rewards.goalReached ? 'celebrate' : 'streak')
    pumpToasts()
  }

  return { floats: readonly(floats), muted: computed(() => prefs.muted.value), present }
}

/** 测试隔离。 */
export function __resetRewardsForTests(): void {
  floats.value = []
  queue.length = 0
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = null
  nextId = 1
}
