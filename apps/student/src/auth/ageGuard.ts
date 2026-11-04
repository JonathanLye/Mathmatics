/**
 * 年龄门路由守卫（issue #145 / 13 §4）。
 *
 * 用法：受保护页面（同意页 / 首页 / 做题页）的 onLoad 里：
 *   const decision = await enforceAgeGate()
 *   if (!ageGatePassed(decision)) return
 *
 * 只做「送学生去选择页」这一件事：是否可用、能不能改档由服务端决定（409 AGE_BAND_LOCKED / 403 AGE_RESTRICTED）。
 */
import { ageGateAllows, currentHashRoute, type AgeGateDecision } from '@/auth/ageBand'
import { useSession } from '@/stores/session'

export const AGE_PAGE_URL = '/pages/age/index'

/**
 * 检查年龄分档；need-age / blocked 时记录原目标并重定向到年龄选择页。
 * @param currentRoute 原目标（默认取当前 H5 hash 路由，如 /pages/practice/index?mock=...）
 */
export async function enforceAgeGate(currentRoute?: string): Promise<AgeGateDecision> {
  const session = useSession()
  const decision = await session.ensureAgeBand()
  if (decision === 'need-age' || decision === 'blocked') {
    const route = currentRoute ?? currentHashRoute()
    if (route && route !== AGE_PAGE_URL) session.setPendingRoute(route)
    uni.redirectTo({ url: AGE_PAGE_URL })
  }
  return decision
}

/** 守卫是否允许当前页面继续初始化（ok / unknown 放行）。 */
export function ageGatePassed(decision: AgeGateDecision): boolean {
  return decision === 'ok' || decision === 'unknown'
}

/** 纯函数透传，方便测试/页面复用。 */
export { ageGateAllows }
