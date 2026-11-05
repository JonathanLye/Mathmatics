/**
 * #46 严格测验 mock 的「服务端模拟」（仅 mock / e2e 用，绝不参与真实模式）。
 *
 * 真实链路里切出次数与锁定都由服务端维护（11 §5.2：服务端累加 integ.visibility → 锁定 → 教师 unlock）。
 * e2e 没有服务端，所以这里用一个显式的 mock hook 模拟服务端返回新的 state：
 * - away()：等价于服务端收到一次切出后返回 warnings+1（达到阈值则 locked，计数不清零）；
 * - unlock()：等价于教师 attempt.unlock 后返回 active（warnings 保留，阈值 +1 由服务端做）。
 * 页面只 apply 这些 state，不做本地判定。
 */
import type { AttemptState } from '@/types/attempt'

export interface ExamMockApi {
  away: () => AttemptState | null
  unlock: () => AttemptState | null
}

/** 模拟服务端收到一次切出（仅 test 模式且未锁定）。返回新 state；不适用返回 null。 */
export function examMockAway(state: AttemptState): AttemptState | null {
  if (state.mode !== 'test') return null
  if (state.integrity?.locked || state.status === 'locked') return null
  const max = typeof state.integrity?.maxWarnings === 'number' && state.integrity.maxWarnings > 0 ? state.integrity.maxWarnings : 3
  const warnings = Math.min(max, (state.integrity?.warnings ?? 0) + 1)
  const locked = warnings >= max
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: locked ? 'locked' : state.status,
    integrity: { ...state.integrity, mode: 'test', warnings, maxWarnings: max, locked },
  }
}

/** 模拟教师 attempt.unlock：status active、locked=false，warnings 保留（11 §5.2：计数不清零）。 */
export function examMockUnlock(state: AttemptState): AttemptState | null {
  if (state.mode !== 'test') return null
  if (!state.integrity?.locked && state.status !== 'locked') return null
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: 'active',
    integrity: { ...state.integrity, mode: 'test', locked: false, notice: '老师已解锁，继续作答。' },
  }
}

/** 安装 window.__PG_EXAM_MOCK__（仅 mock 构建调用；e2e 用它模拟服务端切出/解锁）。 */
export function installExamMockHook(
  getState: () => AttemptState,
  apply: (next: AttemptState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const api: ExamMockApi = {
    away: () => {
      const next = examMockAway(getState())
      if (next) apply(next)
      return next
    },
    unlock: () => {
      const next = examMockUnlock(getState())
      if (next) apply(next)
      return next
    },
  }
  ;(window as unknown as { __PG_EXAM_MOCK__?: ExamMockApi }).__PG_EXAM_MOCK__ = api
  return () => {
    delete (window as unknown as { __PG_EXAM_MOCK__?: ExamMockApi }).__PG_EXAM_MOCK__
  }
}
