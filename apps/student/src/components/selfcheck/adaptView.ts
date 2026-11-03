/**
 * 自检自适应接线（#47 adaptive.ts ↔ #26 SelfcheckForm / mock state）。
 *
 * 纯逻辑：把服务端下发的 SelfcheckView 映射成 adaptive.nextSelfcheck 的输入，并给出 UI 提示文案。
 * - 契约 SelfcheckView 只有 items(itemId/question/status/answer)；维度与 passed 记录是 #47 本地 mock 扩展，
 *   真实接口（#24）由服务端下发维度/记录，或在服务端完成选题（这里只是 P1 前端演示接线）。
 * - 前端不判定对错：passed 来自 state 里的 records（mock 由 reducer 写入；真实接口来自服务端）。
 */
import type { SelfcheckItem, SelfcheckView } from '@/types/attempt'
import type { AdaptiveConfig, AdaptiveDecision, SelfcheckDimension, SelfcheckItem as AdaptiveItem, SelfcheckRecord } from './adaptive'

/** 与 mock reducer 共用的自适应参数（真接口里来自班级设置/引擎，#24）。 */
export const SELFCHECK_ADAPTIVE_CONFIG: AdaptiveConfig = { maxAttempts: 2, retryGap: 1 }

const DIMENSION_ORDER: readonly SelfcheckDimension[] = ['basis', 'role', 'logic', 'condition', 'module', 'transfer']

/** 服务端没下发 dimension 时的兜底：按题序映射到默认维度顺序（仅 mock 容错）。 */
function dimensionOf(item: SelfcheckItem, index: number): SelfcheckDimension {
  if (item.dimension) return item.dimension
  return DIMENSION_ORDER[index % DIMENSION_ORDER.length]
}

export interface SelfcheckAdaptiveInput {
  items: AdaptiveItem[]
  records: SelfcheckRecord[]
  config: AdaptiveConfig
  /** itemId → 原始题目（UI 渲染题面/状态用）。 */
  byId: Record<string, SelfcheckItem>
}

/** 把服务端 state 映射成自适应输入。records 缺省时按 item.status === 'accepted' 兜底。 */
export function selfcheckAdaptiveInput(view: SelfcheckView | null | undefined): SelfcheckAdaptiveInput {
  const items = view?.items ?? []
  const byId: Record<string, SelfcheckItem> = {}
  const adaptiveItems: AdaptiveItem[] = items.map((item, index) => {
    byId[item.itemId] = item
    return { itemId: item.itemId, dimension: dimensionOf(item, index), priority: index }
  })
  const records: SelfcheckRecord[] =
    view?.records && view.records.length > 0
      ? view.records.map((record) => ({ itemId: record.itemId, passed: record.passed }))
      : items
          .filter((item) => item.status === 'accepted')
          .map((item) => ({ itemId: item.itemId, passed: true }))
  return { items: adaptiveItems, records, config: SELFCHECK_ADAPTIVE_CONFIG, byId }
}

export type AdaptiveHintKind = 'retry' | 'next' | 'wait' | 'done'

export interface AdaptiveHint {
  kind: AdaptiveHintKind
  text: string
}

/** UI 提示：先做下一题 / 稍后回来重试 / 再试一次 / 完成。文案不含任何题目的数学内容。 */
export function adaptiveHint(decision: AdaptiveDecision): AdaptiveHint {
  if (decision.action === 'done') return { kind: 'done', text: decision.reason }
  if (decision.action === 'retry') return { kind: 'retry', text: '这题上次答错了，再试一次：' + decision.reason }
  if (decision.action === 'review') return { kind: 'retry', text: '回顾一下这道题：' + decision.reason }
  if (decision.waitQuestions !== null && decision.waitQuestions > 0) {
    return {
      kind: 'wait',
      text: '先做下一题：刚才那题答错了，还要再经过 ' + decision.waitQuestions + ' 道题才回来重试。',
    }
  }
  return { kind: 'next', text: '按顺序做下一道没做过的题。' }
}

/** 已通过 / 待重试 / 跳过（次数用尽）的题数统计（UI 进度用）。 */
export function selfcheckProgress(view: SelfcheckView | null | undefined, decision: AdaptiveDecision): { passed: number; total: number; exhausted: number } {
  const items = view?.items ?? []
  const maxAttempts = SELFCHECK_ADAPTIVE_CONFIG.maxAttempts ?? 2
  const passed = items.filter((item) => item.status === 'accepted').length
  const exhausted = items.filter((item) => item.status !== 'accepted' && (item.attempts ?? 0) >= maxAttempts).length
  const total = items.length
  return { passed, total, exhausted }
}
