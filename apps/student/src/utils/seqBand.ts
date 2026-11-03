/**
 * seq-band 图解计算（03 §7.1）：数列点 (n, aₙ)、水平带 A±ε，N(ε) 由点的实际位置算出来。
 *
 * 规则（03 §7 表格）：
 * N(ε) = 最小的 N，使 N < n ≤ nMax 的点都在带内。
 * 所以 N 就是「视野内最后一个落在带外的 n」；如果所有点都在带内，N = 0（从第 1 项起就在带内）；
 * 如果最后一个落带外的点就是 nMax，说明视野内找不到满足条件的 N（图只画到 nMax 项），返回 null。
 *
 * 这里只做纯计算，不碰 DOM；UI 见 components/SeqBandDiagram.vue。
 */
import { compileExpr, ExprError } from './expr'
import type { VisualSpec } from '@/types/attempt'

export interface SeqBandPoint {
  n: number
  value: number
  inBand: boolean
}

export interface SeqBandResult {
  epsilon: number
  limit: number
  nMax: number
  points: SeqBandPoint[]
  /** 最小的 N（0 ≤ N < nMax）；null 表示视野内（n ≤ nMax）找不到，需要调大 ε 或 nMax。 */
  n: number | null
  /** 带内点的个数，用于文案「视野内 60 个点里 57 个在带内」。 */
  insideCount: number
}

export interface SeqBandParams {
  expr: string
  limit: number
  epsilon: number
  nMax: number
}

const DEFAULT_N_MAX = 60

/** 从 VisualSpec 取出 seq-band 参数；字段不全/非法返回 null（前端不显示图解，只显示文字）。 */
export function seqBandParams(spec: VisualSpec): SeqBandParams | null {
  if (!spec || spec.type !== 'seq-band') return null
  const params = spec.params || {}
  const expr = typeof params.expr === 'string' ? params.expr : ''
  const limit = Number(params.limit)
  const epsilon = Number(params.epsilon?.init ?? params.epsilon?.min)
  const nMaxRaw = Number(params.nMax ?? DEFAULT_N_MAX)
  const nMax = Number.isFinite(nMaxRaw) ? Math.min(400, Math.max(5, Math.round(nMaxRaw))) : DEFAULT_N_MAX
  if (!expr || !Number.isFinite(limit) || !Number.isFinite(epsilon) || epsilon <= 0) return null
  return { expr, limit, epsilon, nMax }
}

/** 按给定 ε 计算点与 N(ε)。表达式解析失败时返回 null。 */
export function computeSeqBand(params: SeqBandParams): SeqBandResult | null {
  let fn: (vars: Record<string, number>) => number
  try {
    fn = compileExpr(params.expr)
  } catch (e) {
    if (e instanceof ExprError) return null
    throw e
  }
  const points: SeqBandPoint[] = []
  let lastOut = 0
  let insideCount = 0
  let hasFinite = false
  for (let n = 1; n <= params.nMax; n += 1) {
    let value: number
    try {
      value = fn({ n })
    } catch {
      value = Number.NaN
    }
    const finite = Number.isFinite(value)
    if (finite) hasFinite = true
    const inBand = finite && Math.abs(value - params.limit) < params.epsilon
    if (inBand) insideCount += 1
    else lastOut = n
    points.push({ n, value, inBand })
  }
  const n = !hasFinite || lastOut >= params.nMax ? null : lastOut
  return { epsilon: params.epsilon, limit: params.limit, nMax: params.nMax, points, n, insideCount }
}

/** UI 文案：当前 ε 下从第几项起都在带内。 */
export function describeSeqBand(result: SeqBandResult): string {
  if (result.n === null) return '图中只画到第 ' + result.nMax + ' 项，视野内还看不到「从某一项起都在带内」，请调大 ε。'
  if (result.n === 0) return '从第 1 项起，' + result.nMax + ' 个点都落在带内（N = 0）。'
  return '从第 ' + (result.n + 1) + ' 项起都在带内（N = ' + result.n + '）。'
}
