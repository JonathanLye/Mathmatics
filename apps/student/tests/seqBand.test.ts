import { describe, expect, it } from 'vitest'
import { computeSeqBand, describeSeqBand, seqBandParams } from '@/utils/seqBand'
import type { VisualSpec } from '@/types/attempt'

// #26：N(ε) = 最小的 N，使 N < n ≤ nMax 的点都在带内（03 §7.1）。
describe('seq-band N(ε)（03 §7.1）', () => {
  const expr = '(3*n+1)/(n+2)'

  it.each([
    [1, 3],
    [0.5, 8],
    [0.2, 23],
  ])('ε=%s → N=%i（a_n=(3n+1)/(n+2) 收敛到 3）', (epsilon, expected) => {
    const result = computeSeqBand({ expr, limit: 3, epsilon, nMax: 60 })
    expect(result).not.toBeNull()
    expect(result?.n).toBe(expected)
  })

  it('ε 足够大时所有点都在带内 → N = 0', () => {
    const result = computeSeqBand({ expr, limit: 3, epsilon: 2, nMax: 60 })
    expect(result?.n).toBe(0)
    expect(result?.insideCount).toBe(60)
    expect(describeSeqBand(result!)).toContain('从第 1 项起')
  })

  it('视野内找不到满足条件的 N → null，并提示调大 ε', () => {
    const result = computeSeqBand({ expr, limit: 3, epsilon: 0.01, nMax: 60 })
    expect(result).not.toBeNull()
    expect(result?.n).toBeNull()
    expect(describeSeqBand(result!)).toContain('调大')
  })

  it('带内点计数随 ε 变化', () => {
    const big = computeSeqBand({ expr, limit: 3, epsilon: 1, nMax: 60 })
    const small = computeSeqBand({ expr, limit: 3, epsilon: 0.1, nMax: 60 })
    expect(big!.insideCount).toBeGreaterThan(small!.insideCount)
  })

  it('表达式解析失败时返回 null（不显示图解）', () => {
    expect(computeSeqBand({ expr: 'rm -rf /', limit: 3, epsilon: 1, nMax: 60 })).toBeNull()
  })

  it('微课种子里的 seq-band 参数：默认 ε=0.3 → N=3', () => {
    const spec: VisualSpec = {
      type: 'seq-band',
      title: 'ε 带',
      params: {
        expr: '1+(-1)^n/n',
        limit: 1,
        epsilon: { min: 0.02, max: 0.6, init: 0.3, step: 0.01 },
        nMax: 60,
        showN: true,
      },
    }
    const params = seqBandParams(spec)
    expect(params).toEqual({ expr: '1+(-1)^n/n', limit: 1, epsilon: 0.3, nMax: 60 })
    expect(computeSeqBand(params!)?.n).toBe(3)
  })

  it('seqBandParams 拒绝非 seq-band / 缺参数', () => {
    expect(seqBandParams({ type: 'number-line', params: {} })).toBeNull()
    expect(seqBandParams({ type: 'seq-band', params: {} })).toBeNull()
    expect(seqBandParams({ type: 'seq-band', params: { expr: 'n', limit: 0 } })).toBeNull()
  })
})
