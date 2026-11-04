/**
 * 函数图像 + ε-δ 带子（03 §7 的 func-band）：
 * 水平带 A±ε（A=params.limit），竖直带 x₀±δ（x₀=params.at），δ 由数值扫描求最大可用值。
 *
 * - 纯计算/坐标范围；不执行数据里的代码（受限表达式由 ./expr.ts 解析）；
 * - 「最大可用 δ」是数值近似：从 x₀ 起以 step=1e-3 向两侧扫描，遇到 |f(x)−A| ≥ ε 就停；
 *   图上必须标注「数值近似」，不能当成严格证明；
 * - 不做任何层/预算/判定，只展示。
 */
import { compileExpr, isFiniteNumber, type CompiledExpr } from './expr'

export interface FuncBandEpsilon {
  min: number
  max: number
  init: number
  step: number
}

export interface FuncBandSpec {
  expr: string
  limit: number
  at: number
  epsilon: FuncBandEpsilon
  xRange: [number, number]
  yRange: [number, number] | null
}

export interface FuncBandPoint {
  x: number
  y: number
}

export interface FuncBandView {
  points: FuncBandPoint[]
  epsilon: number
  limit: number
  at: number
  delta: number | null
  /** δ 为数值扫描近似（03 §7 要求标「数值近似」）。 */
  deltaApprox: true
  bandLow: number
  bandHigh: number
  xRange: [number, number]
  yRange: [number, number]
  xTicks: number[]
  yTicks: number[]
  valid: boolean
}

export const FUNC_BAND_DELTA_STEP = 1e-3
const DEFAULT_EPSILON: FuncBandEpsilon = { min: 0.05, max: 0.8, init: 0.4, step: 0.01 }
const SAMPLE_COUNT = 161

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function readRange(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const left = Number(raw[0])
  const right = Number(raw[1])
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null
  return [left, right]
}

/** 从 VisualSpec.params 读取 func-band 参数；缺 expr/limit/at 返回 null。 */
export function readFuncBandSpec(params: unknown): FuncBandSpec | null {
  if (params === null || typeof params !== 'object') return null
  const source = params as {
    expr?: unknown
    limit?: unknown
    at?: unknown
    epsilon?: Record<string, unknown>
    xRange?: unknown
    yRange?: unknown
  }
  if (typeof source.expr !== 'string') return null
  const limit = Number(source.limit)
  const at = Number(source.at)
  if (!Number.isFinite(limit) || !Number.isFinite(at)) return null

  const epsilonRaw = source.epsilon ?? {}
  const min = clampNumber(epsilonRaw.min, 1e-4, 10, DEFAULT_EPSILON.min)
  const max = Math.max(min + 1e-4, clampNumber(epsilonRaw.max, min + 1e-4, 10, DEFAULT_EPSILON.max))
  const init = clampNumber(epsilonRaw.init, min, max, DEFAULT_EPSILON.init)
  const step = clampNumber(epsilonRaw.step, 1e-4, max - min, DEFAULT_EPSILON.step)

  const xRange = readRange(source.xRange) ?? [at - 2, at + 2]
  const safeRange: [number, number] = xRange[0] < at && xRange[1] > at ? xRange : [at - 2, at + 2]
  return {
    expr: source.expr,
    limit,
    at,
    epsilon: { min, max, init, step },
    xRange: safeRange,
    yRange: readRange(source.yRange),
  }
}

/**
 * 数值扫描最大可用 δ（步长 step=1e-3）：从 x₀ 向两侧逐步扩大，
 * 任一侧出现 |f(x)−A| ≥ ε 或函数值非有限时停止，返回上一步的 δ（可能为 0）。
 * 返回 null 表示 ε 非正/参数非法。
 */
export function findMaxDelta(
  compiled: CompiledExpr,
  limit: number,
  at: number,
  epsilon: number,
  options: { step?: number; maxDelta?: number } = {},
): number | null {
  if (!isFiniteNumber(epsilon) || epsilon <= 0) return null
  if (!isFiniteNumber(at) || !isFiniteNumber(limit)) return null
  const step = isFiniteNumber(options.step) && (options.step as number) > 0 ? (options.step as number) : FUNC_BAND_DELTA_STEP
  const maxDelta = isFiniteNumber(options.maxDelta) && (options.maxDelta as number) > 0 ? (options.maxDelta as number) : 2
  const maxK = Math.min(2000, Math.floor(maxDelta / step))
  let lastOk = 0
  for (let k = 1; k <= maxK; k += 1) {
    for (const sign of [1, -1] as const) {
      const x = at + sign * k * step
      const value = compiled.evaluate({ x })
      if (!isFiniteNumber(value)) return lastOk
      if (Math.abs(value - limit) >= epsilon) return lastOk
    }
    lastOk = k * step
  }
  return lastOk
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return []
  const rawStep = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let value = start; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toFixed(6)))
  return ticks
}

/** 计算函数带子视图；表达式非法/曲线点不足返回 null。 */
export function computeFuncBand(
  params: unknown,
  options: { epsilon?: number; samples?: number } = {},
): FuncBandView | null {
  const spec = readFuncBandSpec(params)
  if (!spec) return null
  const compiled = compileExpr(spec.expr)
  if (!compiled) return null

  const epsilon = clampNumber(options.epsilon ?? spec.epsilon.init, spec.epsilon.min, spec.epsilon.max, spec.epsilon.init)
  const sampleCount = Math.min(401, Math.max(11, Math.round(options.samples ?? SAMPLE_COUNT)))
  const [xMin, xMax] = spec.xRange
  const points: FuncBandPoint[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const x = xMin + ((xMax - xMin) * index) / (sampleCount - 1)
    const y = compiled.evaluate({ x })
    if (isFiniteNumber(y)) points.push({ x, y })
  }
  if (points.length < 2) return null

  const maxDelta = Math.max(1e-3, Math.min(2, (xMax - xMin) / 2))
  const delta = findMaxDelta(compiled, spec.limit, spec.at, epsilon, { step: FUNC_BAND_DELTA_STEP, maxDelta })
  const bandLow = spec.limit - epsilon
  const bandHigh = spec.limit + epsilon

  let yMin = bandLow
  let yMax = bandHigh
  if (spec.yRange) {
    yMin = spec.yRange[0]
    yMax = spec.yRange[1]
  } else {
    for (const point of points) {
      yMin = Math.min(yMin, point.y)
      yMax = Math.max(yMax, point.y)
    }
    if (delta !== null) {
      // δ 区间里的函数值也要在视野内
      const edgeValues = [compiled.evaluate({ x: spec.at - delta }), compiled.evaluate({ x: spec.at + delta })]
      for (const value of edgeValues) {
        if (isFiniteNumber(value)) {
          yMin = Math.min(yMin, value)
          yMax = Math.max(yMax, value)
        }
      }
    }
    const span = yMax - yMin
    const pad = span > 0 ? span * 0.1 : 1
    yMin -= pad
    yMax += pad
  }

  return {
    points,
    epsilon,
    limit: spec.limit,
    at: spec.at,
    delta,
    deltaApprox: true,
    bandLow,
    bandHigh,
    xRange: spec.xRange,
    yRange: [yMin, yMax],
    xTicks: niceTicks(spec.xRange[0], spec.xRange[1]),
    yTicks: niceTicks(yMin, yMax),
    valid: true,
  }
}

/** 映射到 SVG 像素坐标（组件画曲线/带子用）。 */
export function projectFuncBandPoint(
  point: FuncBandPoint,
  geometry: { width: number; height: number; padding: { left: number; right: number; top: number; bottom: number } },
  view: { xRange: [number, number]; yRange: [number, number] },
): { x: number; y: number } {
  const { padding } = geometry
  const innerWidth = Math.max(1, geometry.width - padding.left - padding.right)
  const innerHeight = Math.max(1, geometry.height - padding.top - padding.bottom)
  const xRange = view.xRange[1] - view.xRange[0] || 1
  const yRange = view.yRange[1] - view.yRange[0] || 1
  const xRatio = Math.min(1, Math.max(0, (point.x - view.xRange[0]) / xRange))
  const yRatio = Math.min(1, Math.max(0, (point.y - view.yRange[0]) / yRange))
  return { x: padding.left + xRatio * innerWidth, y: padding.top + (1 - yRatio) * innerHeight }
}
