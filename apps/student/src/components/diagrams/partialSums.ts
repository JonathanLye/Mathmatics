/**
 * 部分和折线（03 §7 的 partial-sums）：一条或多条级数的部分和 Sₙ（n=1..nMax）。
 *
 * - 纯计算/坐标范围；不执行数据里的代码（受限表达式由 ./expr.ts 解析）；
 * - 每一列只累加有限项；某项非有限（NaN/Infinity）时该级数标记 invalid，不画它；
 * - 交互：拖动「n 上限」滑块只看前 n 项的部分和（累加展示，不做收敛判定）。
 */
import { compileExpr, isFiniteNumber } from './expr'

export interface PartialSumSeriesInput {
  expr: string
  label: string
}

export interface PartialSumPoint {
  n: number
  value: number
}

export interface PartialSumSeriesView {
  label: string
  expr: string
  /** 前 nMax 项的部分和点（只包含有限点；遇到非有限项即停止）。 */
  points: PartialSumPoint[]
  /** n 上限位置的部分和；无有效点时 null。 */
  finalSum: number | null
  valid: boolean
}

export interface PartialSumsView {
  series: PartialSumSeriesView[]
  nMax: number
  /** 当前滑块的上限 n（1..nMax）。 */
  n: number
  yMin: number
  yMax: number
  /** x 轴刻度（1..nMax 的整数步长）。 */
  xTicks: number[]
  valid: boolean
}

export const PARTIAL_SUMS_DEFAULT_NMAX = 30
const MIN_NMAX = 5
const MAX_NMAX = 400
const MAX_SERIES = 3

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

/** 从 VisualSpec.params.series 读取序列定义（最多 3 条，非法项丢弃）。 */
export function readSeries(raw: unknown): PartialSumSeriesInput[] {
  if (!Array.isArray(raw)) return []
  const result: PartialSumSeriesInput[] = []
  for (const item of raw.slice(0, MAX_SERIES)) {
    if (item === null || typeof item !== 'object') continue
    const candidate = item as { expr?: unknown; label?: unknown }
    if (typeof candidate.expr !== 'string') continue
    result.push({
      expr: candidate.expr,
      label: typeof candidate.label === 'string' && candidate.label.length > 0 ? candidate.label : candidate.expr,
    })
  }
  return result
}

/** n 轴刻度：从 1 到 nMax，最多 count 个。 */
export function nTicks(nMax: number, count = 5): number[] {
  const safeMax = clampInt(nMax, MIN_NMAX, MAX_NMAX, PARTIAL_SUMS_DEFAULT_NMAX)
  const stride = Math.max(1, Math.ceil(safeMax / Math.max(1, count)))
  const ticks: number[] = [1]
  for (let n = 1 + stride; n <= safeMax; n += stride) ticks.push(n)
  return ticks
}

/**
 * 计算部分和视图；参数不可用/所有级数都非法时返回 null（调用方只显示文字，不画图）。
 * n 为滑块上限：只累加到 n，但坐标范围用 nMax 稳定，避免拖动时轴乱跳。
 */
export function computePartialSums(
  rawSeries: unknown,
  options: { nMax?: number; n?: number } = {},
): PartialSumsView | null {
  const seriesInput = readSeries(rawSeries)
  if (seriesInput.length === 0) return null
  const nMax = clampInt(options.nMax ?? PARTIAL_SUMS_DEFAULT_NMAX, MIN_NMAX, MAX_NMAX, PARTIAL_SUMS_DEFAULT_NMAX)
  const currentN = clampInt(options.n ?? nMax, 1, nMax, nMax)

  const series: PartialSumSeriesView[] = []
  const yValues: number[] = []
  for (const input of seriesInput) {
    const compiled = compileExpr(input.expr)
    if (!compiled) {
      series.push({ label: input.label, expr: input.expr, points: [], finalSum: null, valid: false })
      continue
    }
    let sum = 0
    const points: PartialSumPoint[] = []
    let valid = true
    for (let k = 1; k <= nMax; k += 1) {
      const term = compiled.evaluate({ n: k })
      if (!isFiniteNumber(term)) {
        valid = false
        break
      }
      sum += term
      if (!isFiniteNumber(sum)) {
        valid = false
        break
      }
      points.push({ n: k, value: sum })
      yValues.push(sum)
    }
    series.push({
      label: input.label,
      expr: input.expr,
      points,
      finalSum: valid && points.length > 0 ? (points[currentN - 1]?.value ?? points[points.length - 1]?.value ?? null) : null,
      valid: valid && points.length > 0,
    })
  }

  const validSeries = series.filter((item) => item.valid)
  if (validSeries.length === 0) return null

  yValues.push(0)
  const rawMin = Math.min(...yValues)
  const rawMax = Math.max(...yValues)
  const span = rawMax - rawMin
  const pad = span > 0 ? span * 0.1 : 1
  return {
    series,
    nMax,
    n: currentN,
    yMin: rawMin - pad,
    yMax: rawMax + pad,
    xTicks: nTicks(nMax),
    valid: true,
  }
}

/** 把 (n, Sₙ) 映射到 SVG 像素坐标（组件画折线用；与 seqBand 一致的映射）。 */
export function projectPartialSum(
  point: PartialSumPoint,
  geometry: { width: number; height: number; padding: { left: number; right: number; top: number; bottom: number } },
  view: { nMax: number; yMin: number; yMax: number },
): { x: number; y: number } {
  const { padding } = geometry
  const innerWidth = Math.max(1, geometry.width - padding.left - padding.right)
  const innerHeight = Math.max(1, geometry.height - padding.top - padding.bottom)
  const nMax = Math.max(1, view.nMax)
  const ratio = nMax === 1 ? 0 : (point.n - 1) / (nMax - 1)
  const x = padding.left + Math.min(1, Math.max(0, ratio)) * innerWidth
  const range = view.yMax - view.yMin || 1
  const y = padding.top + (1 - (point.value - view.yMin) / range) * innerHeight
  return { x, y }
}
