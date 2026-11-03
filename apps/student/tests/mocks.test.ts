import { describe, expect, it } from 'vitest'
import { createMockState, DEFAULT_MOCK, isMockKey, MOCK_LABELS, parseMockKey, type MockKey } from '@/mocks/attemptStates'
import { useAttempt } from '@/stores/attempt'

// #9 DoD：4 份典型 AttemptState 必须存在，且结构符合学生端渲染需要。
// #26 追加 l3-ready / l4-active / l5-active / l6-active 四份，用来走 L3→L4→L5→L6→完成页 全流程。
const KEYS: MockKey[] = ['l1-active', 'l3-active', 'l3-exhausted', 'l3-ready', 'l4-active', 'l5-active', 'l6-active', 'completed']

describe('典型 AttemptState（issue #9 / #26）', () => {
  it('状态都有中文标签与默认 mock', () => {
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

  it('④ 第 3 层可写完了：有行且 canFinish=true', () => {
    const s = createMockState('l3-ready')
    expect(s.currentLayer).toBe('L3')
    expect(s.steps?.canFinish).toBe(true)
    expect((s.steps?.lines ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('⑤ 第 4 层自检：3 道题、均为 open', () => {
    const s = createMockState('l4-active')
    expect(s.currentLayer).toBe('L4')
    expect(s.selfcheck?.items).toHaveLength(3)
    expect(s.selfcheck?.items.every((item) => item.status === 'open')).toBe(true)
  })

  it('⑥ 第 5 层迁移题：transfer=active 且有题面', () => {
    const s = createMockState('l5-active')
    expect(s.currentLayer).toBe('L5')
    expect(s.transfer?.status).toBe('active')
    expect(s.transfer?.stem).toContain('$')
  })

  it('⑦ 第 6 层总结：五问、answers 为空', () => {
    const s = createMockState('l6-active')
    expect(s.currentLayer).toBe('L6')
    expect(s.summary?.questions).toHaveLength(5)
    expect(s.summary?.answers).toHaveLength(0)
  })

  it('⑧ 本题完成：status=completed、completion.done、总结五问已答', () => {
    const s = createMockState('completed')
    expect(s.status).toBe('completed')
    expect(s.completion?.done).toBe(true)
    expect(s.summary?.answers).toHaveLength(5)
  })
})

// PR #87 审计回归：?mock=constructor / toString 曾绕过 `in` 校验 → createMockState(undefined) → 白屏。
describe('非法 mock 键不命中 Object.prototype（PR #87 回归）', () => {
  const BAD_KEYS = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'prototype']

  it.each(BAD_KEYS)('isMockKey / parseMockKey 拒绝 %s', (key) => {
    expect(isMockKey(key)).toBe(false)
    expect(parseMockKey(key)).toBeNull()
    expect(parseMockKey([key])).toBeNull()
  })

  it('createMockState 收到非法键也返回可渲染状态（不抛错、不 undefined）', () => {
    for (const key of BAD_KEYS) {
      const s = createMockState(key as MockKey)
      expect(s).toBeTruthy()
      expect(s.problem?.title).toBeTruthy()
      expect(s.layers).toHaveLength(6)
    }
  })

  it('setMock 收到非法键回退 DEFAULT_MOCK，再切回合法键正常', () => {
    const { state, mockKey, setMock } = useAttempt()
    setMock('toString' as MockKey)
    expect(mockKey.value).toBe(DEFAULT_MOCK)
    expect(state.value.problem?.title).toBeTruthy()
    setMock('completed')
    expect(mockKey.value).toBe('completed')
    expect(state.value.status).toBe('completed')
  })

  it('parseMockKey 接受合法键 / 数组首值 / 空值', () => {
    expect(parseMockKey('l3-active')).toBe('l3-active')
    expect(parseMockKey(['completed', 'l1-active'])).toBe('completed')
    expect(parseMockKey(undefined)).toBeNull()
    expect(parseMockKey(null)).toBeNull()
    expect(parseMockKey(42)).toBeNull()
  })
})
