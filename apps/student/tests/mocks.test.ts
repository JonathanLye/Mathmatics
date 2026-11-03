import { describe, expect, it } from 'vitest'
import { createMockState, DEFAULT_MOCK, isMockKey, MOCK_LABELS, parseMockKey, type MockKey } from '@/mocks/attemptStates'
import { useAttempt } from '@/stores/attempt'

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
