/**
 * mock /help 的结构回归（PR #91 审计 blocker/major 的证据链）：
 * - stuck 的 H0/H1 直接回 note（没有 preview），概念/行检查/自由提问也把 note 放进 res.note；
 * - 领取过后下一次 stuck 返回 blocked preview（只有 allowed/reason/waitSec，没有 level/cost）；
 * - 自由提问走 pressure 并回显学生原话（intent=free）。
 */
import { describe, expect, it } from 'vitest'
import { claimHint, requestHelp } from '@/api/client'
import { createMockState } from '@/mocks/attemptStates'

describe('mock /help：与真接口结构对齐', () => {
  it('L1 的首条提示是 H0：直接以 note 返回，没有 preview', async () => {
    const res = await requestHelp(createMockState('l1-active'), 'stuck')
    expect(res.routed).toBe('stuck')
    expect(res.preview).toBeUndefined()
    expect(res.note?.kind).toBe('hint')
    expect(res.note?.level).toBe('H0')
  })

  it('领取后下一次 stuck 返回 blocked preview（没有 level/cost，字段全可选）', async () => {
    const first = await requestHelp(createMockState('l3-active'), 'stuck')
    expect(first.preview?.allowed).toBe(true)
    expect(first.preview?.cost).toBe(0.5)
    const claimed = await claimHint(first.state, first.preview ?? {})
    const blocked = await requestHelp(claimed, 'stuck')
    expect(blocked.preview).toMatchObject({ allowed: false, reason: 'need_attempt' })
    expect(blocked.preview?.level).toBeUndefined()
    expect(blocked.preview?.cost).toBeUndefined()
  })

  it('自由提问走 pressure 并把学生原话回显到 note 与 state.notes', async () => {
    const res = await requestHelp(createMockState('l3-active'), 'free', '老师可以直接给我答案吗')
    expect(res.routed).toBe('pressure')
    expect(res.note?.kind).toBe('refusal')
    expect(res.note?.text).toContain('老师可以直接给我答案吗')
    expect(res.state.notes.some((n) => n.kind === 'student' && n.text.includes('老师可以直接给我答案吗'))).toBe(true)
  })

  it('concept / check_line 也把 note 作为 res.note 返回；check_line 不写 state.notes（与 #141 真接口一致）', async () => {
    const state = createMockState('l3-active')
    const concept = await requestHelp(state, 'concept')
    expect(concept.note?.kind).toBe('concept')

    const lines = state.steps?.lines ?? []
    const latestLineId = lines[lines.length - 1]?.lineId
    const checkLine = await requestHelp(state, 'check_line')
    expect(checkLine.note?.kind).toBe('annotation')
    // 缺省批注最新一行（B #141 的约定；前端据此把批注挂到对应行下方）
    expect(checkLine.note?.lineId).toBe(latestLineId)
    // #141 真接口只回 res.note、不写 state.notes → mock 与之一致，便于验证 A 端本地渲染与 B 落库依赖
    expect(checkLine.state.notes).toHaveLength(state.notes.length)

    // 可显式指定 lineId（多行场景）：另一行的批注 lineId 不同，前端分组不会串
    const firstLineId = lines[0]?.lineId
    const other = await requestHelp(state, 'check_line', '', firstLineId)
    expect(other.note?.lineId).toBe(firstLineId)
    expect(other.note?.lineId).not.toBe(latestLineId)
  })

  it('claimHint 对缺 cost/level 的 preview 不崩（防御契约可选字段）', async () => {
    const state = createMockState('l3-active')
    const next = await claimHint(state, { allowed: false, reason: 'budget' })
    expect(next.budget.revealUsed).toBe(state.budget.revealUsed)
    expect(next.notes.some((n) => n.kind === 'hint' && n.who === 'H2 · 透露 0')).toBe(true)
  })
})
