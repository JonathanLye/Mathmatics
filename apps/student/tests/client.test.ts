import { describe, expect, it } from 'vitest'
import { createMockState } from '@/mocks/attemptStates'
import { skipLayer, viewFrameTemplate } from '@/api/client'

// PR #89 审计 1/2：跳层与看通用骨架必须是独立操作，不能借提交文本实现（06 §3.2 · openapi skipLayer / viewFrameTemplate）。

async function toL2() {
  const s = createMockState('l1-active')
  return skipLayer(s, 'L1')
}

describe('skipLayer（POST /attempts/{id}/layers/{L}/skip）', () => {
  it('L1 跳过：L1 → skipped、L2 → active、currentLayer=L2；不写 def.last、不加提交计数', async () => {
    const s = createMockState('l1-active')
    const next = await skipLayer(s, 'L1')
    expect(next.currentLayer).toBe('L2')
    expect(next.layers.find((l) => l.layer === 'L1')?.status).toBe('skipped')
    expect(next.layers.find((l) => l.layer === 'L2')?.status).toBe('active')
    expect(next.stateVersion).toBe(s.stateVersion + 1)
    expect(next.def?.last ?? null).toBeNull()
    expect(next.def?.submissions ?? 0).toBe(0)
  })

  it('L2 跳过：L2 → skipped、L3 → active、currentLayer=L3；不写 frame.last', async () => {
    const l2 = await toL2()
    const next = await skipLayer(l2, 'L2')
    expect(next.currentLayer).toBe('L3')
    expect(next.layers.find((l) => l.layer === 'L2')?.status).toBe('skipped')
    expect(next.layers.find((l) => l.layer === 'L3')?.status).toBe('active')
    expect(next.frame?.last ?? null).toBeNull()
    expect(next.stateVersion).toBe(l2.stateVersion + 1)
  })

  it('只跳当前层：传错层原样返回（不推进、不涨版本）', async () => {
    const s = createMockState('l1-active')
    const same = await skipLayer(s, 'L2')
    expect(same.currentLayer).toBe('L1')
    expect(same.stateVersion).toBe(s.stateVersion)
    expect(same.layers.find((l) => l.layer === 'L1')?.status).toBe('active')
  })
})

describe('viewFrameTemplate（POST /attempts/{id}/framework/template）', () => {
  it('L2 下返回 frame.templateShown=true 的新 state，不计透露量、不改 frame.last', async () => {
    const l2 = await toL2()
    expect(l2.frame?.templateShown).toBe(false)
    const next = await viewFrameTemplate(l2)
    expect(next.frame?.templateShown).toBe(true)
    expect(next.frame?.last ?? null).toBeNull()
    expect(next.budget).toEqual(l2.budget)
    expect(next.stateVersion).toBe(l2.stateVersion + 1)
  })

  it('不在 L2 时原样返回（真实接口为 409 WRONG_LAYER）', async () => {
    const s = createMockState('l1-active')
    const next = await viewFrameTemplate(s)
    expect(next.stateVersion).toBe(s.stateVersion)
    expect(next.frame?.templateShown).toBeFalsy()
  })
})
