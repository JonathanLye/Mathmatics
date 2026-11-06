/**
 * 把服务端返回的作答交给做题页。
 * 真实模式走 ?attemptId=（刷新也能接上）；mock 模式没有服务端，state 通过 store 跨页交接。
 * from 告诉做题页从哪来，完成后可以回到那里（错题 → 错题）。
 */
import { isMockMode, setMockMode } from '@/api/client'
import { setPendingAttempt } from '@/stores/attempt'
import type { AttemptState } from '@/types/attempt'

export type PracticeOrigin = 'path' | 'zone' | 'mistakes' | 'redo' | 'teacher'

export function practiceUrl(attemptId: string, from: PracticeOrigin, mock: boolean): string {
  const query = 'from=' + from
  return '/pages/practice/index?' + (mock ? query : 'attemptId=' + encodeURIComponent(attemptId) + '&' + query)
}

export function openPractice(state: AttemptState, from: PracticeOrigin): void {
  const mock = isMockMode()
  if (mock) setPendingAttempt(state)
  uni.navigateTo({ url: practiceUrl(state.attemptId, from, mock) })
}

/** e2e 和联调：页面带 ?api=real 时走真实接口（同首页、做题页的约定）。 */
export function applyApiOverride(query: Record<string, unknown> | undefined): void {
  if (query?.api === 'real') setMockMode(false)
}
