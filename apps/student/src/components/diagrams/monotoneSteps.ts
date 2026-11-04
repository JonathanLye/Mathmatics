/**
 * 单调性相邻项对比（03 §7 的 monotone-steps）：比较 uₙ 与 uₙ₊₁。
 *
 * - 只展示差值符号/单调方向，不做「是否收敛」「是否可用判别法」等业务判定；
 * - 受限表达式求值（./expr.ts），非有限项标记 invalid 并停止；
 * - 交互：拖动 n 看当前相邻两项的差。
 */
import { compileExpr, isFiniteNumber } from './expr'

export interface MonotoneSample {
  n: number
  current: number
  next: number
  diff: number
  /** 差值符号：-1 递减 / 0 相等 / 1 递增。 */
  sign: -1 | 0 | 1
}

export type MonotoneDirection = 'increasing' | 'decreasing' | 'mixed' | 'unknown'

export interface MonotoneStepsView {
  expr: string
  nMax: number
  /** 当前选中的 n（1..nMax-1）。 */
  n: number
  samples: MonotoneSample[]
  /** 仅对有定义样本的展示性判定：全部递增/全部递减/混合/无法判定。 */
  direction: MonotoneDirection
  directionLabel: string
  current: MonotoneSample | null
  valid: boolean
}

const DEFAULT_NMAX = 20
const MIN_NMAX = 5
const MAX_NMAX = 400

const DIRECTION_LABEL: Record<MonotoneDirection, string> = {
  increasing: '递增（uₙ₊₁ > uₙ）',
  decreasing: '递减（uₙ₊₁ < uₙ）',
  mixed: '不单调（差值符号有变化）',
  unknown: '无法判定（存在未定义项）',
}

function signOf(value: number): -1 | 0 | 1 {
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

/** 计算相邻项差值视图；表达式非法/参数不可用返回 null。 */
export function computeMonotoneSteps(
  rawExpr: unknown,
  options: { nMax?: number; n?: number } = {},
): MonotoneStepsView | null {
  const compiled = compileExpr(rawExpr)
  if (!compiled) return null
  const rawMax = Number(options.nMax)
  const nMax = Number.isFinite(rawMax) ? Math.min(MAX_NMAX, Math.max(MIN_NMAX, Math.round(rawMax))) : DEFAULT_NMAX

  const samples: MonotoneSample[] = []
  let finite = true
  for (let k = 1; k <= nMax; k += 1) {
    const current = compiled.evaluate({ n: k })
    const next = compiled.evaluate({ n: k + 1 })
    if (!isFiniteNumber(current) || !isFiniteNumber(next)) {
      finite = false
      break
    }
    const diff = next - current
    if (!isFiniteNumber(diff)) {
      finite = false
      break
    }
    samples.push({ n: k, current, next, diff, sign: signOf(diff) })
  }
  if (samples.length === 0) return null

  const signs = new Set(samples.map((sample) => sample.sign))
  let direction: MonotoneDirection
  if (!finite) direction = 'unknown'
  else if (signs.size === 1 && signs.has(1)) direction = 'increasing'
  else if (signs.size === 1 && signs.has(-1)) direction = 'decreasing'
  else if (signs.size === 1 && signs.has(0)) direction = 'mixed'
  else direction = 'mixed'

  // 滑块范围是 1..samples.length（样本数 = nMax，因为 u_{k+1} 也能取到），夹在样本内。
  const currentN = Math.min(samples.length, Math.max(1, Math.round(Number(options.n ?? 1)) || 1))
  const safeN = currentN
  return {
    expr: String(rawExpr).trim(),
    nMax,
    n: safeN,
    samples,
    direction,
    directionLabel: DIRECTION_LABEL[direction],
    current: samples[safeN - 1] ?? null,
    valid: finite,
  }
}

/** 把项号映射到 x 像素（1..nMax）。 */
export function projectN(n: number, width: number, padding: { left: number; right: number }, nMax: number): number {
  const innerWidth = Math.max(1, width - padding.left - padding.right)
  const safeMax = Math.max(1, nMax)
  const ratio = safeMax === 1 ? 0 : (n - 1) / (safeMax - 1)
  return padding.left + Math.min(1, Math.max(0, ratio)) * innerWidth
}
