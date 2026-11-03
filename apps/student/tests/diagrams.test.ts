import { describe, expect, it } from 'vitest'

import {
  intervalFor,
  mapX,
  niceSpan,
  niceStep,
  spanOf,
  triangleBounds,
} from '@/components/diagrams/absTriangle'
import {
  bandOf,
  inBand,
  minN,
  nTicks,
  projectN,
  projectPoint,
  sampleSeqPoints,
  SAMPLE_A,
} from '@/components/diagrams/seqBand'
import { thresholdCurve, transferQuantities, transferRows } from '@/components/diagrams/transfer'

/** issue #47 P1-2：图解模板的纯函数计算（组件本身由 typecheck/build 验证）。 */

describe('图解①：绝对值展开 / 三角不等式', () => {
  it('同号的 a、b：|a+b| = |a|+|b|，等号成立', () => {
    const bounds = triangleBounds(3, 2)
    expect(bounds.absSum).toBe(5)
    expect(bounds.absTotal).toBe(5)
    expect(bounds.gap).toBe(0)
    expect(bounds.equality).toBe(true)
  })

  it('异号的 a、b：|a+b| < |a|+|b|，差值是 gap', () => {
    const bounds = triangleBounds(3, -1)
    expect(bounds.absSum).toBe(2)
    expect(bounds.absTotal).toBe(4)
    expect(bounds.gap).toBe(2)
    expect(bounds.equality).toBe(false)
  })

  it('含 0 时等号仍成立（|a+0| = |a|）', () => {
    expect(triangleBounds(-3, 0).equality).toBe(true)
  })

  it('|x − center| ≤ r 展开成 [center−r, center+r]', () => {
    expect(intervalFor(3, 0.5)).toEqual({ min: 2.5, max: 3.5 })
    const empty = intervalFor(1, -1)
    expect(empty.min).toBeGreaterThan(empty.max)
  })

  it('显示区间：单点有兜底，多值有 10% 余量，刻度取 1/2/5×10^k', () => {
    expect(spanOf([2, 2])).toEqual({ min: 1, max: 3 })
    const padded = spanOf([0, 10])
    expect(padded.min).toBeLessThan(0)
    expect(padded.max).toBeGreaterThan(10)
    expect([1, 2, 5, 10, 20, 50]).toContain(niceStep(10, 4) * 2)
    const nice = niceSpan({ min: -1.2, max: 3.7 })
    expect(nice.min).toBeLessThanOrEqual(-1.2)
    expect(nice.max).toBeGreaterThanOrEqual(3.7)
  })

  it('mapX：左端留 padding、右端留 padding、越界被夹住、零跨度居中', () => {
    const span = { min: -2, max: 2 }
    expect(mapX(-2, span, 320, 16)).toBe(16)
    expect(mapX(2, span, 320, 16)).toBe(304)
    expect(mapX(-100, span, 320, 16)).toBe(16)
    expect(mapX(100, span, 320, 16)).toBe(304)
    expect(mapX(5, { min: 5, max: 5 }, 320, 16)).toBe(16 + (320 - 32) / 2)
  })
})

describe('图解②：ε–N 配对关系图（seq-band）', () => {
  it('水平带是 A±ε', () => {
    expect(bandOf(3, 0.5)).toEqual({ low: 2.5, high: 3.5 })
  })

  it('带内判定用严格不等式（|a_n−A| = ε 视为带外，与定义一致）', () => {
    expect(inBand({ n: 1, a: 3.49 }, 3, 0.5)).toBe(true)
    expect(inBand({ n: 1, a: 3.5 }, 3, 0.5)).toBe(false)
    expect(inBand({ n: 1, a: 2.5 }, 3, 0.5)).toBe(false)
  })

  it('epsN 示例：ε=0.5 时 N(ε) = 8（所有 n>8 的项都进带）', () => {
    const points = sampleSeqPoints(20)
    const result = minN(points, SAMPLE_A, 0.5)
    expect(result.N).toBe(8)
    expect(result.maxOutsideN).toBe(8)
    for (const point of points) {
      if (point.n > 8) expect(Math.abs(point.a - SAMPLE_A)).toBeLessThan(0.5)
    }
  })

  it('ε=1 时 N(ε) = 3（带外最大项号就是 N）', () => {
    const result = minN(sampleSeqPoints(20), SAMPLE_A, 1)
    expect(result.N).toBe(3)
    expect(result.outside.map((point) => point.n)).toEqual([1, 2, 3])
  })

  it('空序列 / ε≤0 无阈值；全部在带内时约定 N = 0', () => {
    expect(minN([], 3, 0.5).N).toBeNull()
    expect(minN([{ n: 1, a: 3 }], 3, 0).N).toBeNull()
    expect(minN([{ n: 1, a: 3.1 }], 3, 0.5).N).toBe(0)
  })

  it('坐标映射：projectN 端点 + projectPoint 落在画布内', () => {
    const geometry = { width: 320, height: 196, padding: { left: 34, right: 14, top: 22, bottom: 40 } }
    expect(projectN(1, geometry, 20)).toBe(34)
    expect(projectN(20, geometry, 20)).toBe(320 - 14)
    const projected = projectPoint({ n: 10, a: 3 }, geometry, { nMax: 20, yMin: 2, yMax: 4 })
    expect(projected.x).toBeGreaterThanOrEqual(34)
    expect(projected.x).toBeLessThanOrEqual(320 - 14)
    expect(projected.y).toBeGreaterThanOrEqual(22)
    expect(projected.y).toBeLessThanOrEqual(196 - 40)
  })

  it('n 轴刻度从 1 开始且不越界', () => {
    const ticks = nTicks(20, 5)
    expect(ticks[0]).toBe(1)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(20)
    expect(nTicks(0)).toEqual([])
  })
})

describe('图解③：迁移题思路图（ε-N → ε-δ）', () => {
  it('由 ε 计算两侧阈值：N = ⌈5/ε⌉、δ = ε/2', () => {
    const quantities = transferQuantities(0.1)
    expect(quantities.seqN).toBe(50)
    expect(quantities.funcDelta).toBeCloseTo(0.05, 10)
    expect(quantities.funcCenter).toBe(1)
  })

  it('ε 非正数抛 RangeError（图上不画无效阈值）', () => {
    expect(() => transferQuantities(0)).toThrow(RangeError)
    expect(() => transferQuantities(-0.1)).toThrow(RangeError)
  })

  it('对照行覆盖四个证明骨架步骤，且点出唯一需要换的对象', () => {
    const rows = transferRows(transferQuantities(0.2))
    expect(rows).toHaveLength(4)
    expect(rows[0]?.seq).toContain('任取 ε')
    expect(rows[1]?.seq).toContain('N')
    expect(rows[1]?.func).toContain('δ')
    expect(rows[2]?.seq).toContain('n > N')
    expect(rows[2]?.func).toContain('0 < |x − 1| < δ')
    expect(rows[3]?.seq).toContain('|a_n − A| < ε')
    expect(rows.every((row) => row.note.length > 0)).toBe(true)
  })

  it('阈值随 ε 的曲线：ε 越大 N 越小、δ 越大，且都不为 0', () => {
    const curve = thresholdCurve(0.2, 24)
    expect(curve).toHaveLength(24)
    expect(curve[0]?.seqN).toBeGreaterThanOrEqual(curve[curve.length - 1]?.seqN ?? 0)
    expect(curve[0]?.funcDelta).toBeLessThanOrEqual(curve[curve.length - 1]?.funcDelta ?? 0)
    expect(curve.every((sample) => sample.funcDelta > 0)).toBe(true)
  })
})
