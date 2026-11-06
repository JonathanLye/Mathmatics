/**
 * 做题页的就地提示：现在该出哪一条。每条只出现一次（settings.onboarding.seen.*），测验模式一条都不出（canShow 负责）。
 * 同一时刻只出一条，优先讲学生正在操作的东西；反馈面板和层间过场开着时先不打断。
 */
import type { OnboardingKey } from './logic'

export interface CoachContext {
  layer: string
  completed: boolean
  composerOpen: boolean
  composerTab: 'hand' | 'keyboard' | 'photo'
  helpOpen: boolean
  /** 预览卡上这条提示要用的额度；没有预览卡或不花额度时为 0。 */
  hintCost: number
  /** 反馈面板正在显示助教的问题。 */
  questionShown: boolean
  /** 反馈面板或层间过场开着。 */
  overlayOpen: boolean
}

export function pickCoachKey(ctx: CoachContext, canShow: (key: OnboardingKey) => boolean): OnboardingKey | null {
  const first = (keys: OnboardingKey[]): OnboardingKey | null => keys.find((key) => canShow(key)) ?? null
  if (ctx.hintCost > 0) return first(['hint.costed'])
  if (ctx.helpOpen) return first(['help.open'])
  if (ctx.composerOpen) {
    const byTab = { hand: 'input.hand', keyboard: 'input.keyboard', photo: 'input.photo' } as const
    return first([byTab[ctx.composerTab]])
  }
  if (ctx.questionShown) return first(['note.first'])
  if (ctx.overlayOpen) return null
  if (ctx.completed) return first(['done.first'])
  const layer = `layer.${ctx.layer}`
  return /^layer\.L[1-6]$/.test(layer) ? first([layer as OnboardingKey]) : null
}
