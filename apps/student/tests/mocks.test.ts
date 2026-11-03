import { describe, expect, it } from 'vitest'
import { createMockState, DEFAULT_MOCK, MOCK_LABELS, type MockKey } from '@/mocks/attemptStates'

// #9 DoD：4 份典型 AttemptState 必须存在，且结构符合学生端渲染需要。
const KEYS: MockKey[] = ['l1-active', 'l3-active', 'l3-exhausted', 'completed']

describe('典型 AttemptState（issue #9）', () => {
  it('四个状态都有中文标签与默认 mock', () => {
    expect(Object.keys(MOCK_LABELS).sort()).toEqual([...KEYS].sort())
    expect(KEYS).toContain(DEFAULT_MOCK)
  })

  it.each(KEYS)('%s 结构完整（AttemptState 必需字段）', (key) => {
    const s = createMockState(key)
    expect(s.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof s.stateVersion).toBe('number')
    expect(s.layers).toHaveLength(6)
    expect(s.layers.map((l) => l.layer)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
    expect(s.problem.stem).toContain('$')
    expect(Array.isArray(s.notes)).toBe(true)
    expect(s.help).toBeTruthy()
    expect(s.budget.revealMax).toBeGreaterThan(0)
  })

  it('① L1 进行中：currentLayer=L1、无证明行', () => {
    const s = createMockState('l1-active')
    expect(s.currentLayer).toBe('L1')
    expect(s.steps?.lines ?? []).toHaveLength(0)
  })

  it('② L3 进行中：有 2 行 + 行内批注', () => {
    const s = createMockState('l3-active')
    expect(s.currentLayer).toBe('L3')
    expect(s.steps?.lines?.length).toBe(2)
    expect(s.notes.some((n) => n.kind === 'annotation' && Boolean(n.lineId))).toBe(true)
  })

  it('③ 透露额度用尽：help.exhausted 且 revealUsed=revealMax', () => {
    const s = createMockState('l3-exhausted')
    expect(s.help.exhausted).toBe(true)
    expect(s.budget.revealUsed).toBe(s.budget.revealMax)
  })

  it('④ 本题完成：status=completed 且 completion.done', () => {
    const s = createMockState('completed')
    expect(s.status).toBe('completed')
    expect(s.completion?.done).toBe(true)
  })
})
