/**
 * 绝对值展开 / 三角不等式图解（issue #47 P1-2「更多图解模板」之一，03 §7）。
 *
 * 数学含义：
 * - 三角不等式：|a + b| ≤ |a| + |b|；数轴上把 a、b 首尾相接，|a+b| 是合位移的长度，
 *   |a|+|b| 是两段路程之和，等号当且仅当 a、b 同号（或至少一个为 0）。
 * - 绝对值的区间展开：|x − center| ≤ r ⇔ x ∈ [center − r, center + r]（Δ-邻域）。
 *
 * 本文件只有纯计算 / 坐标映射，不依赖 DOM；AbsTriangleDiagram.vue 用它渲染 SVG，
 * 单测直接测这里的函数（组件本身在 typecheck/build 阶段验证）。
 */

export interface NumberSpan {
  min: number
  max: number
}

export interface TriangleBounds {
  /** |a| */
  absA: number
  /** |b| */
  absB: number
  /** |a + b|（合位移长度） */
  absSum: number
  /** |a| + |b|（两段路程之和） */
  absTotal: number
  /** absTotal − absSum；0 表示等号成立 */
  gap: number
  /** 等号是否成立（同号或含 0） */
  equality: boolean
}

const EPS = 1e-12

/** 三角不等式两侧的数值；gap 是「兜的圈子多走的路」。 */
export function triangleBounds(a: number, b: number): TriangleBounds {
  const absA = Math.abs(a)
  const absB = Math.abs(b)
  const absSum = Math.abs(a + b)
  const absTotal = absA + absB
  const gap = absTotal - absSum
  return { absA, absB, absSum, absTotal, gap, equality: Math.abs(gap) <= EPS }
}

/** |x − center| ≤ radius 展开成的区间；radius < 0 视为空区间（from > to）。 */
export function intervalFor(center: number, radius: number): NumberSpan {
  return { min: center - radius, max: center + radius }
}

/** 把若干数值点包成带 10% 余量的显示区间；全相等时给 ±1 的兜底，避免除零。 */
export function spanOf(values: readonly number[]): NumberSpan {
  if (values.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = (max - min) * 0.1
  return { min: min - pad, max: max + pad }
}

/** 取 1/2/5 × 10^k 的「好看的」坐标步长（供刻度与 niceSpan 使用）。 */
export function niceStep(span: number, targetTicks = 4): number {
  const raw = Math.abs(span) / Math.max(1, targetTicks)
  if (raw === 0 || !Number.isFinite(raw)) return 1
  const exponent = Math.floor(Math.log10(raw))
  const base = 10 ** exponent
  const fraction = raw / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * base
}

/** 把数值区间扩到 niceStep 的整数倍，得到方便画刻度的显示区间。 */
export function niceSpan(span: NumberSpan, targetTicks = 4): NumberSpan {
  const step = niceStep(span.max - span.min, targetTicks)
  return {
    min: Math.floor(span.min / step) * step,
    max: Math.ceil(span.max / step) * step,
  }
}

/** 把数轴上的 x 映射到 SVG 的像素横坐标（左右各留 padding）。 */
export function mapX(value: number, span: NumberSpan, width: number, padding = 16): number {
  const inner = Math.max(1, width - padding * 2)
  const range = span.max - span.min
  if (range === 0 || !Number.isFinite(range)) return padding + inner / 2
  const ratio = (value - span.min) / range
  return padding + Math.min(1, Math.max(0, ratio)) * inner
}
