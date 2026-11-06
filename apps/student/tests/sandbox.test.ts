import { describe, expect, it } from 'vitest'
import { pickCoachKey, type CoachContext } from '@/onboarding/coach'
import { sandboxAsk, sandboxCloseHelp, sandboxDismissFeedback, sandboxFinish, sandboxNextLine, sandboxStart, sandboxWrite } from '@/onboarding/sandbox'

describe('登录前试玩的剧本', () => {
  it('写一行 → 批注 → 求助 → 改写 → 写完，三行走到完成', () => {
    let s = sandboxStart()
    s = sandboxDismissFeedback(sandboxWrite(s))
    expect(s.phase).toBe('write')
    s = sandboxWrite(s)
    expect(s.shown?.tone).toBe('sea')
    s = sandboxDismissFeedback(s)
    expect(s.phase).toBe('ask')
    expect(sandboxNextLine(s)).toBeNull()
    // 没问之前关抽屉，还停在“问问”
    expect(sandboxCloseHelp(s).phase).toBe('ask')
    s = sandboxCloseHelp(sandboxAsk(s))
    expect(s.phase).toBe('fix')
    s = sandboxWrite(s)
    expect(s.lines).toHaveLength(2)
    expect(s.lines[1]?.tone).toBe('ok')
    s = sandboxWrite(sandboxDismissFeedback(s))
    s = sandboxDismissFeedback(s)
    expect(s.lines).toHaveLength(3)
    expect(s.phase).toBe('finish')
    expect(sandboxFinish(s).phase).toBe('done')
  })

  it('反馈开着时先问过了也能接上改写', () => {
    let s = sandboxDismissFeedback(sandboxWrite(sandboxStart()))
    s = sandboxWrite(sandboxAsk(s))
    expect(sandboxDismissFeedback(s).phase).toBe('fix')
  })
})

describe('做题页就地提示选哪一条', () => {
  const base: CoachContext = { layer: 'L3', completed: false, composerOpen: false, composerTab: 'keyboard', helpOpen: false, hintCost: 0, questionShown: false, overlayOpen: false }
  const all = () => true

  it('优先讲正在操作的东西', () => {
    expect(pickCoachKey(base, all)).toBe('layer.L3')
    expect(pickCoachKey({ ...base, composerOpen: true, composerTab: 'hand' }, all)).toBe('input.hand')
    expect(pickCoachKey({ ...base, composerOpen: true, composerTab: 'photo' }, all)).toBe('input.photo')
    expect(pickCoachKey({ ...base, helpOpen: true }, all)).toBe('help.open')
    expect(pickCoachKey({ ...base, helpOpen: true, hintCost: 1 }, all)).toBe('hint.costed')
    expect(pickCoachKey({ ...base, questionShown: true, overlayOpen: true }, all)).toBe('note.first')
    expect(pickCoachKey({ ...base, completed: true }, all)).toBe('done.first')
  })

  it('反馈面板或层间过场开着时不打断', () => {
    expect(pickCoachKey({ ...base, overlayOpen: true }, all)).toBeNull()
  })

  it('canShow 为假（看过了，或测验模式）就什么都不出', () => {
    expect(pickCoachKey(base, () => false)).toBeNull()
    expect(pickCoachKey({ ...base, helpOpen: true }, () => false)).toBeNull()
    expect(pickCoachKey({ ...base, composerOpen: true }, () => false)).toBeNull()
  })
})
