/** 登录 / 设密码之后的去向（登录页与设置密码页共用）：先设密码 → 年龄分档 → 同意书 → 首页。 */
import { ageGateFor } from '@/auth/ageBand'
import type { MeView } from '@/types/attempt'

export type AfterLoginRoute = '/pages/set-password/index' | '/pages/age/index' | '/pages/consent/index' | '/pages/home/index'

export interface AfterLoginPlan {
  /** 立即 redirectTo 的页面。 */
  url: AfterLoginRoute
  /** 年龄页 / 设密码页做完之后继续去的页面（走 session.setPendingRoute）；没有则为空。 */
  pending: string
}

/**
 * 纯函数：只根据服务端 Me 排下一站，不做合规判断。
 * - needsPassword → 设密码页（成功后再按同样的规则走一遍）；
 * - 年龄分档为 null / <14 → 年龄页，原目标记在 pending；
 * - 否则同意书或首页。
 */
export function planAfterLogin(me: MeView | null, consented: boolean): AfterLoginPlan {
  const target = consented ? '/pages/home/index' : '/pages/consent/index'
  if (me?.needsPassword === true) return { url: '/pages/set-password/index', pending: '' }
  const decision = ageGateFor(me?.ageBand)
  if (decision === 'need-age' || decision === 'blocked') return { url: '/pages/age/index', pending: target }
  return { url: target, pending: '' }
}
