/**
 * 第 4 层自检的自适应选题（issue #47 P1-2「自检自适应」）。
 *
 * 依据 01 §L4：学生针对自己写的证明回答 3 个局部问题（依据 / 作用 / 逻辑地位或条件），
 * 答错只追问一句、不给答案；题库是导入时生成、教师审核过的 selfcheckBank。
 * 引擎（B 的 #19/#26）负责实际判定 passed，本模块只根据 passed 记录决定「下一题」：
 *  - 先补没做过的题（按维度顺序，可选同维度优先级）；
 *  - 答错的题按 interval 策略重试（retryGap = 0 立即重试，>0 隔几道其它题；maxAttempts 封顶）；
 *  - 全部做完/用尽次数 → done；可选 reviewAfter 在答对若干条记录后安排一次回顾。
 *
 * 纯逻辑：不读 DOM、不发请求；输入输出都可 JSON 序列化，便于单测与回放。
 * 注意：本模块不产生任何学生可见的数学内容（01 §系统禁止），reason 只描述流程。
 */

export type SelfcheckDimension = 'basis' | 'role' | 'logic' | 'condition' | 'module' | 'transfer'

/** selfcheckBank 里的一道题（服务端下发时至少带 itemId + dimension）。 */
export interface SelfcheckItem {
  itemId: string
  dimension: SelfcheckDimension
  /** 同一维度内的优先顺序（小的先做）；缺省相等。 */
  priority?: number
}

/** 一条作答记录（服务端按时间正序下发；同一道题可能重复出现）。 */
export interface SelfcheckRecord {
  itemId: string
  passed: boolean
}

export interface AdaptiveConfig {
  /** 每题最多试几次（含第一次）；达到后放弃该题。默认 2。 */
  maxAttempts?: number
  /** 答错后隔几道其它题再重试；0 = 立即重试。默认 1。 */
  retryGap?: number
  /** 答对后隔多少条记录安排一次回顾；0/缺省 = 不回顾。 */
  reviewAfter?: number
  /** 维度优先顺序；缺省依据 → 作用 → 逻辑地位 → 条件 → 模块 → 迁移。 */
  dimensionOrder?: readonly SelfcheckDimension[]
}

export type AdaptiveAction = 'next' | 'retry' | 'review' | 'done'

export interface AdaptiveDecision {
  action: AdaptiveAction
  /** 下一题的 itemId；done 时为 null。 */
  nextItemId: string | null
  /** 这道题接下来是第几次作答（done 为 0）。 */
  attemptNo: number
  /** 距重试到期还差几道其它题：立即重试 0，未到期 >0，其它情况 null。 */
  waitQuestions: number | null
  /** 给 UI / 事件日志的一句话理由（不含答案内容）。 */
  reason: string
}

export interface SelfcheckSummary {
  item: SelfcheckItem
  /** 已作答次数 */
  attempts: number
  /** 最近一次是否通过；没做过为 null */
  latestPassed: boolean | null
  /** 最近一次记录在 records 中的下标；没做过为 -1 */
  lastIndex: number
  /** 最近一次作答之后又过了多少条记录 */
  recordsSinceLastAttempt: number
  /** 累计答错次数 */
  failedAttempts: number
}

const DEFAULT_DIMENSION_ORDER: readonly SelfcheckDimension[] = ['basis', 'role', 'logic', 'condition', 'module', 'transfer']
const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_RETRY_GAP = 1

function dimensionRank(dimension: SelfcheckDimension, order: readonly SelfcheckDimension[]): number {
  const index = order.indexOf(dimension)
  return index === -1 ? order.length : index
}

function compareNewItems(left: SelfcheckSummary, right: SelfcheckSummary, order: readonly SelfcheckDimension[]): number {
  const rankDiff = dimensionRank(left.item.dimension, order) - dimensionRank(right.item.dimension, order)
  if (rankDiff !== 0) return rankDiff
  const priorityDiff = (left.item.priority ?? 0) - (right.item.priority ?? 0)
  if (priorityDiff !== 0) return priorityDiff
  return left.item.itemId < right.item.itemId ? -1 : left.item.itemId > right.item.itemId ? 1 : 0
}

/** 把 items + records 汇总成每题的作答摘要（未知 itemId 的记录会被忽略）。 */
export function summarizeSelfcheck(
  items: readonly SelfcheckItem[],
  records: readonly SelfcheckRecord[],
): SelfcheckSummary[] {
  const known = new Set(items.map((item) => item.itemId))
  return items.map((item) => {
    const attempts: Array<{ passed: boolean; index: number }> = []
    records.forEach((record, index) => {
      if (record.itemId === item.itemId && known.has(record.itemId)) attempts.push({ passed: record.passed, index })
    })
    const last = attempts[attempts.length - 1]
    return {
      item,
      attempts: attempts.length,
      latestPassed: last === undefined ? null : last.passed,
      lastIndex: last === undefined ? -1 : last.index,
      recordsSinceLastAttempt: last === undefined ? -1 : records.length - 1 - last.index,
      failedAttempts: attempts.filter((attempt) => !attempt.passed).length,
    }
  })
}

function decide(
  action: AdaptiveAction,
  item: SelfcheckItem | null,
  attemptNo: number,
  waitQuestions: number | null,
  reason: string,
): AdaptiveDecision {
  return { action, nextItemId: item === null ? null : item.itemId, attemptNo, waitQuestions, reason }
}

/**
 * 决定下一道自检题。
 * @param items   本轮可用的 selfcheckBank 子集（服务端挑好的 3 道或更多）
 * @param records 该作答已产生的 passed 记录（时间正序，可重复）
 * @param config  自适应参数（maxAttempts / retryGap / reviewAfter / dimensionOrder）
 */
export function nextSelfcheck(
  items: readonly SelfcheckItem[],
  records: readonly SelfcheckRecord[],
  config: AdaptiveConfig = {},
): AdaptiveDecision {
  const maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const retryGap = Math.max(0, config.retryGap ?? DEFAULT_RETRY_GAP)
  const reviewAfter = Math.max(0, config.reviewAfter ?? 0)
  const dimensionOrder = config.dimensionOrder ?? DEFAULT_DIMENSION_ORDER

  if (items.length === 0) return decide('done', null, 0, null, '没有可用的自检题')

  const known = new Set(items.map((item) => item.itemId))
  const knownRecords = records.filter((record) => known.has(record.itemId))
  const summaries = summarizeSelfcheck(items, knownRecords)

  // 1) 到期的重试：先错先重试；间隔没到就往后放
  const dueRetries = summaries
    .filter(
      (summary) =>
        summary.latestPassed === false &&
        summary.attempts < maxAttempts &&
        summary.recordsSinceLastAttempt >= retryGap,
    )
    .sort((left, right) => left.lastIndex - right.lastIndex)
  const retry = dueRetries[0]
  if (retry !== undefined) {
    return decide(
      'retry',
      retry.item,
      retry.attempts + 1,
      retryGap === 0 ? 0 : null,
      retryGap === 0 ? '上次答错，立即重试一次' : `上次答错，已隔 ${retryGap} 道题，重试一次`,
    )
  }

  // 2) 没做过的题：按维度顺序 → 同维度优先级 → itemId 稳定排序
  const unseen = summaries.filter((summary) => summary.attempts === 0).sort((left, right) => compareNewItems(left, right, dimensionOrder))
  const firstUnseen = unseen[0]
  if (firstUnseen !== undefined) {
    const deferred = summaries
      .filter((summary) => summary.latestPassed === false && summary.attempts < maxAttempts)
      .sort((left, right) => left.lastIndex - right.lastIndex)[0]
    const waitQuestions =
      deferred === undefined ? null : Math.max(0, retryGap - deferred.recordsSinceLastAttempt)
    return decide(
      'next',
      firstUnseen.item,
      firstUnseen.attempts + 1,
      waitQuestions,
      `按维度顺序先做未做过的题（${firstUnseen.item.dimension}）`,
    )
  }

  // 3) 回顾：答对后经过 reviewAfter 条其它记录，再回顾一次
  if (reviewAfter > 0) {
    const dueReviews = summaries
      .filter(
        (summary) =>
          summary.latestPassed === true && summary.recordsSinceLastAttempt >= reviewAfter && summary.attempts > 0,
      )
      .sort((left, right) => left.lastIndex - right.lastIndex)
    const review = dueReviews[0]
    if (review !== undefined) {
      return decide('review', review.item, review.attempts + 1, null, `答对后隔 ${reviewAfter} 条记录回顾一次`)
    }
  }

  // 4) 还有答错但间隔没到的题：给出下一题（等待期由 UI 用 waitQuestions 提示）
  const pendingRetries = summaries
    .filter((summary) => summary.latestPassed === false && summary.attempts < maxAttempts)
    .sort((left, right) => left.lastIndex - right.lastIndex)
  const pending = pendingRetries[0]
  if (pending !== undefined) {
    const waitQuestions = Math.max(0, retryGap - pending.recordsSinceLastAttempt)
    return decide(
      'next',
      pending.item,
      pending.attempts + 1,
      waitQuestions,
      waitQuestions > 0 ? `先做别的题：还差 ${waitQuestions} 道题到重试` : '重试',
    )
  }

  // 5) 全部答对，或所有题都用尽次数 → 结束
  const unfinished = summaries.filter((summary) => summary.latestPassed !== true)
  if (unfinished.length === 0) return decide('done', null, 0, null, '全部自检题已通过')
  return decide('done', null, 0, null, '自检题已用完（含未通过的题），结束本轮')
}
