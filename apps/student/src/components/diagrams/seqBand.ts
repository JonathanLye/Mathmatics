/**
 * ε–N 配对关系图（issue #47 P1-2「更多图解模板」之一，对应 03 §7 的 `seq-band`）。
 *
 * 数学含义：给定 A 与 ε>0，先在 y 轴上画水平带 A±ε；再找「阈值」N(ε)：
 * 最小的 N 使所有 n > N 的项都落进带内（即 |a_n − A| < ε）。
 * 图上把 n ≤ N 的点画成灰色（带外），n > N 的点画成主题色（带内），
 * 并在 N 处画竖线；这正是 ε 与 N 的"配对"：ε 由学生/滑块给，N 由带子反推。
 *
 * 本文件只有纯计算与坐标映射；序列点由调用方传入（不执行任何表达式求值，避免注入）。
 */

export interface SeqPoint {
  /** 项号 n ≥ 1 */
  n: number
  /** 第 n 项的数值 a_n */
  a: number
}

export interface BandBounds {
  /** A − ε */
  low: number
  /** A + ε */
  high: number
}

export interface MinNResult {
  /** 最小的 N：所有 n > N 的点都在带内；空序列/非法 ε 时为 null。 */
  N: number | null
  /** 落在带外（|a_n − A| ≥ ε）的点，按 n 升序。 */
  outside: SeqPoint[]
  /** 带外点的最大 n（= N 的来源）；没有带外点时为 null。 */
  maxOutsideN: number | null
}

/** 水平带 A±ε；ε < 0 时返回空带（low > high），由调用方决定是否显示。 */
export function bandOf(A: number, epsilon: number): BandBounds {
  return { low: A - Math.abs(epsilon), high: A + Math.abs(epsilon) }
}

/** 判断一点是否在带内（严格不等式 |a_n − A| < ε，与 ε-N 定义一致）。 */
export function inBand(point: SeqPoint, A: number, epsilon: number): boolean {
  return Math.abs(point.a - A) < Math.abs(epsilon)
}

/**
 * 求 N(ε)：最小的 N 使所有 n > N 的点都在带内。
 * - 没有带外点：N = 0（任意比第一项小的 N 都成立，取约定值 0）；
 * - 空序列或 ε ≤ 0：N = null（没有可展示的阈值）。
 */
export function minN(points: readonly SeqPoint[], A: number, epsilon: number): MinNResult {
  if (points.length === 0 || !(epsilon > 0)) {
    return { N: null, outside: [], maxOutsideN: null }
  }
  const outside = points.filter((point) => !inBand(point, A, epsilon)).sort((left, right) => left.n - right.n)
  if (outside.length === 0) return { N: 0, outside: [], maxOutsideN: null }
  const maxOutsideN = outside[outside.length - 1]?.n ?? 0
  return { N: maxOutsideN, outside, maxOutsideN }
}

/** 生成等宽 x 轴的刻度（n = 1..nMax 的整数步长）。 */
export function nTicks(nMax: number, count = 5): number[] {
  if (!(nMax >= 1) || !Number.isFinite(nMax)) return []
  const stride = Math.max(1, Math.ceil(nMax / Math.max(1, count)))
  const ticks: number[] = [1]
  for (let n = 1 + stride; n <= nMax; n += stride) ticks.push(n)
  return ticks
}

export interface SeqBandGeometry {
  width: number
  height: number
  padding: { left: number; right: number; top: number; bottom: number }
}

/** 把项号 n ∈ [1, nMax] 映射到 SVG 像素横坐标（与 projectPoint 的 x 一致）。 */
export function projectN(n: number, geometry: SeqBandGeometry, nMax: number): number {
  const { padding } = geometry
  const innerWidth = Math.max(1, geometry.width - padding.left - padding.right)
  const safeMax = Math.max(1, nMax)
  if (safeMax === 1) return padding.left + innerWidth / 2
  const ratio = (n - 1) / (safeMax - 1)
  return padding.left + Math.min(1, Math.max(0, ratio)) * innerWidth
}

/** 把 (n, a_n) 映射到 SVG 坐标；n 从 1 到 nMax，y 轴覆盖 [yMin, yMax]。 */
export function projectPoint(
  point: SeqPoint,
  geometry: SeqBandGeometry,
  options: { nMax: number; yMin: number; yMax: number },
): { x: number; y: number } {
  const { padding } = geometry
  const innerWidth = Math.max(1, geometry.width - padding.left - padding.right)
  const innerHeight = Math.max(1, geometry.height - padding.top - padding.bottom)
  const nMax = Math.max(1, options.nMax)
  const yRange = options.yMax - options.yMin || 1
  const x = projectN(point.n, geometry, nMax)
  const y = padding.top + (1 - (point.a - options.yMin) / yRange) * innerHeight
  return { x, y }
}

/** 示例序列（seed epsN：a_n = (3n+1)/(n+2)，A = 3）；图解组件默认用它。 */
export const SAMPLE_A = 3
export function sampleSeqPoints(nMax = 20): SeqPoint[] {
  const points: SeqPoint[] = []
  for (let n = 1; n <= nMax; n += 1) points.push({ n, a: (3 * n + 1) / (n + 2) })
  return points
}
