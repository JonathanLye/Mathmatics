/**
 * 提示预览卡的纯逻辑（issue #16；单测 apps/student/tests/hintPreview.test.ts）。
 *
 * 只做「服务端 HintPreview → 学生可见文案」的翻译与格式化：
 * - 不重算门槛/预算/判定（08 §8 AI 规则 3）：allowed 只透传服务端字段；
 * - HintPreview 的字段全部可选（blocked preview 只有 allowed/reason/waitSec），
 *   缺 level 时不渲染标题/成本，缺 cost 不崩；秒数一律用服务端 waitSec。
 */
import type { BudgetView, HintPreview } from '@/types/attempt'

/** 0.5 显示成 0.5、1 显示成 1；缺字段/非数字显示「—」而不是抛错。 */
export function formatRevealAmount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** H0–H4 口径（00-README §5）：H2 方向 / H3 局部一步 / H4 示范一行。 */
const LEVEL_TITLE: Record<'H2' | 'H3' | 'H4', string> = {
  H2: '方向提示',
  H3: '局部一步',
  H4: '示范一行',
}

/** 有 level 才有标题；blocked preview（无 level）只渲染原因行（02 §4.8）。 */
export function previewTitle(preview: HintPreview): string {
  const level = preview.level
  if (!level) return ''
  return '下一条：' + (LEVEL_TITLE[level] ?? '提示')
}

/** 成本行；没有 cost（blocked preview / 免费提示）时返回空串。 */
export function previewCostLine(preview: HintPreview, budget?: BudgetView | null): string {
  if (typeof preview.cost !== 'number' || !Number.isFinite(preview.cost)) return ''
  const cost = formatRevealAmount(preview.cost)
  if (!budget) return '这条会用掉提示额度 ' + cost + '。'
  const remain = Math.max(0, budget.revealMax - budget.revealUsed - preview.cost)
  return (
    '这条会用掉提示额度 ' + cost +
    '（你已用 ' + formatRevealAmount(budget.revealUsed) + ' / ' + formatRevealAmount(budget.revealMax) + '），剩余 ' +
    formatRevealAmount(remain) + '。'
  )
}

/** 可领取只取服务端 preview.allowed；前端不自己放开门槛。 */
export function previewAllowed(preview: HintPreview): boolean {
  return preview.allowed === true
}

/** 可领取时的下一级提示（不写死秒数；20 秒门槛来自 01 §4，由服务端 waitSec/nextCost 驱动）。 */
export const PREVIEW_ALLOWED_GUIDANCE = '领取后，下一级要等你再写一行。'

/** 不可领取原因：只翻译服务端 reason；dwell 的剩余秒数由页面倒计时传入。 */
export function previewReasonText(preview: HintPreview, remainSec?: number | null): string {
  const remain =
    typeof remainSec === 'number' && Number.isFinite(remainSec) ? Math.max(0, Math.floor(remainSec)) : null
  const wait =
    typeof preview.waitSec === 'number' && Number.isFinite(preview.waitSec) ? Math.max(0, Math.floor(preview.waitSec)) : null
  switch (preview.reason) {
    case 'need_attempt':
      return '先自己写完下一行，再来领取。'
    case 'dwell':
      return remain !== null && remain > 0 ? '还要再停留 ' + remain + ' 秒，才能领取。' : '停留时间已到，可以重新获取预览。'
    case 'rapid_lock':
      return wait !== null && wait > 0 ? '刚连续点了几次，先歇 ' + wait + ' 秒再来。' : '刚连续点了几次，过一会儿再来。'
    case 'budget':
      return '本题提示额度已用完，不再升级提示。'
    case 'layer':
      return '当前层还不能领取提示。'
    case 'test_mode':
      return '测验模式不提供提示。'
    case 'complete':
      return '本题已经完成。'
    default:
      return preview.allowed === true ? '' : '现在还不能领取。'
  }
}

/** 不可领取时是否值得给「重新获取预览」（test_mode/complete/layer 重试无意义）。 */
export function previewCanRetry(preview: HintPreview): boolean {
  if (preview.allowed === true) return false
  return preview.reason !== 'test_mode' && preview.reason !== 'complete' && preview.reason !== 'layer'
}

/** dwell 倒计时初始值（服务端 waitSec；非 dwell 返回 null）。 */
export function previewDwellSeconds(preview: HintPreview): number | null {
  if (preview.reason !== 'dwell') return null
  const sec = Number(preview.waitSec)
  return Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
}

/** 额度用完的软着陆出路（01 §4.4 / 06 §3.4；页面、抽屉、卡片共用同一份文案）。 */
export type SoftLandingActionId = 'back_to_definition' | 'open_lesson' | 'park_and_next' | 'flag_teacher'

export const SOFT_LANDING_LABELS: Record<string, string> = {
  back_to_definition: '回到定义',
  open_lesson: '看讲解',
  park_and_next: '先做下一题',
  flag_teacher: '求助老师',
}

export const SOFT_LANDING_ORDER: SoftLandingActionId[] = [
  'back_to_definition',
  'open_lesson',
  'park_and_next',
  'flag_teacher',
]

/** /flag-teacher 已实现（U15）：软着陆出路都可点；是否真能找老师由 state.help.canFlag 决定（见抽屉）。 */
export function softLandingAvailable(_action: string): boolean {
  return true
}

export function softLandingLabel(action: string): string {
  return SOFT_LANDING_LABELS[action] ?? action
}

/** 卡片里的软着陆按钮（服务端 softLanding 原样顺序；未知 id 原串兜底）。 */
export function previewSoftLandingItems(
  actions?: string[] | null,
): Array<{ id: string; label: string; disabled: boolean }> {
  return (actions ?? []).map((id) => ({
    id,
    label: softLandingLabel(id),
    disabled: !softLandingAvailable(id),
  }))
}
