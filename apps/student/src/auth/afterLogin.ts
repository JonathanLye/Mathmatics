/** 登录 / 设密码之后的去向（登录页与设置密码页共用）：先设密码 → 年龄分档 → 同意书 → 首页。 */
import { ageGateFor } from '@/auth/ageBand'
import { shouldGoWelcome } from '@/composables/useOnboarding'
import type { MeView } from '@/types/attempt'

/** 首次设置的欢迎页（昵称、每日目标、默认输入）。 */
export const WELCOME_ROUTE = '/pages/welcome/index'

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

/**
 * 登录 / 设密码之后的完整去向：在 planAfterLogin 的基础上，已签同意书、走到首页之前再看一眼欢迎页。
 * 欢迎页要读设置（要求已签同意书），所以只在 planAfterLogin 给出首页时才问；读不到设置就直接去首页，不拦学生。
 * 中途退出再登录也走这里：设密码 → 年龄 → 同意 → 欢迎页 → 首页，停在哪一步，下次就从哪一步继续。
 */
export async function resolveAfterLogin(
  me: MeView | null,
  consented: boolean,
  welcomeNeeded: () => Promise<boolean> = shouldGoWelcome,
): Promise<{ url: AfterLoginRoute | typeof WELCOME_ROUTE; pending: string }> {
  const plan = planAfterLogin(me, consented)
  if (plan.url === '/pages/home/index' && (await welcomeNeeded())) return { url: WELCOME_ROUTE, pending: '' }
  return plan
}
