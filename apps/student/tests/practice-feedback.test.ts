import { describe, expect, it } from 'vitest'
import { computeFeedback, computeInterstitial } from '@/components/practice/feedback'
import { layersProgress } from '@/components/practice/practiceProgress'
import { createMockState } from '@/mocks/attemptStates'
import type { AttemptState, Note, ProofLine, RewardsView } from '@/types/attempt'

function l3(): AttemptState {
  return createMockState('l3-active')
}

function bump(state: AttemptState, change: (next: AttemptState) => void): AttemptState {
  const next = JSON.parse(JSON.stringify(state)) as AttemptState
  next.stateVersion += 1
  change(next)
  return next
}

const line = (lineId: string): ProofLine => ({ lineId, n: 9, statement: '一行', justification: '依据' })
const note = (noteId: string, kind: Note['kind'], lineId: string | null, text: string): Note => ({
  noteId,
  kind,
  who: '助教',
  text,
  lineId,
  level: null,
  cost: null,
  lessonConceptId: null,
  at: '2026-11-06T00:00:00.000Z',
})
const REWARDS: RewardsView = { xp: 10, items: [], badges: [] }

describe('提交后的反馈：只比较前后两份 state', () => {
  it('关键步骤多了一个：绿色「衔接上了」，带音效和经验', () => {
    const prev = l3()
    const next = bump(prev, (s) => {
      s.steps!.lines.push(line('new'))
      s.budget.keysOwn += 1
    })
    const view = computeFeedback(prev, next, REWARDS)
    expect(view).toMatchObject({ tone: 'ok', title: '衔接上了', sfx: 'correct', xp: 10, lineId: 'new' })
    expect(view?.body).toContain('关键步骤 2/4')
  })

  it('这一行多了一条助教的问题：蓝色，问题原样显示，没有红色形态', () => {
    const prev = l3()
    const next = bump(prev, (s) => {
      s.steps!.lines.push(line('new'))
      s.notes.push(note('q', 'annotation', 'new', '这个放缩成立的条件是什么？'))
    })
    expect(computeFeedback(prev, next)).toMatchObject({ tone: 'sea', title: '助教想问', body: '这个放缩成立的条件是什么？', sfx: 'gentle-question', xp: 0 })
  })

  it('用掉提示额度：金色，说清用掉多少', () => {
    const prev = l3()
    const next = bump(prev, (s) => {
      s.budget.revealUsed += 0.5
      s.notes.push(note('h', 'hint', null, '想想 n 变大时分母怎么变。'))
    })
    const view = computeFeedback(prev, next)
    expect(view).toMatchObject({ tone: 'bee', sfx: 'hint', body: '想想 n 变大时分母怎么变。' })
    expect(view?.title).toContain('用掉 0.5 提示额度')
  })

  it('既没有关键步骤也没有问题：只说记下了，不给对错信号，也不响', () => {
    const prev = l3()
    const next = bump(prev, (s) => s.steps!.lines.push(line('new')))
    expect(computeFeedback(prev, next)).toMatchObject({ tone: 'sea', title: '记下了', sfx: null })
  })

  it('第 1 层核对没通过：把服务端说缺的那一项搬上来', () => {
    const prev = createMockState('l1-active')
    const next = bump(prev, (s) => {
      s.def = { ...s.def, submissions: 1, feedback: '缺少“存在 $N$”。' }
    })
    expect(computeFeedback(prev, next)).toMatchObject({ tone: 'sea', body: '缺少“存在 $N$”。' })
  })

  it('第 2 层看通用骨架不算一次核对', () => {
    const prev = createMockState('l1-active')
    prev.currentLayer = 'L2'
    prev.frame = { task: 't', templateShown: false, feedback: '骨架里还缺开头' }
    const next = bump(prev, (s) => {
      s.frame = { ...s.frame, templateShown: true, template: '模板' }
    })
    expect(computeFeedback(prev, next)).toBeNull()
  })

  it('测验模式什么都不说，也没有过场', () => {
    const prev = l3()
    prev.mode = 'test'
    const next = bump(prev, (s) => {
      s.steps!.lines.push(line('new'))
      s.budget.keysOwn += 1
      s.currentLayer = 'L4'
    })
    expect(computeFeedback(prev, next, REWARDS)).toBeNull()
    expect(computeInterstitial(prev, next, REWARDS)).toBeNull()
  })

  it('换了一次作答（第一次加载、重做）不反馈；版本没前进也不反馈', () => {
    const prev = l3()
    const other = { ...bump(prev, (s) => s.steps!.lines.push(line('new'))), attemptId: 'another' }
    expect(computeFeedback(prev, other)).toBeNull()
    const same = JSON.parse(JSON.stringify(prev)) as AttemptState
    expect(computeFeedback(prev, same)).toBeNull()
  })
})

describe('层间过场', () => {
  it('一层做完：说刚做了什么，下一层叫什么、要做什么', () => {
    const prev = l3()
    const next = bump(prev, (s) => {
      s.currentLayer = 'L4'
      s.layers = s.layers.map((l) => (l.layer === 'L3' ? { ...l, status: 'done' } : l))
    })
    const view = computeInterstitial(prev, next, REWARDS)
    expect(view).toMatchObject({ from: 'L3', to: 'L4', nextName: '自检', xp: 10 })
    expect(view?.did).toBe('关键步骤都写到了。')
    expect(computeFeedback(prev, next)).toBeNull()
  })

  it('跳过这一层：不说「做完了」', () => {
    const prev = createMockState('l1-active')
    const next = bump(prev, (s) => {
      s.currentLayer = 'L2'
      s.layers = s.layers.map((l) => (l.layer === 'L1' ? { ...l, status: 'skipped' } : l))
    })
    expect(computeInterstitial(prev, next)?.did).toContain('跳过')
  })

  it('完成整道题走完成页，不走过场', () => {
    const prev = createMockState('l6-active')
    const next = bump(prev, (s) => {
      s.status = 'completed'
    })
    expect(computeInterstitial(prev, next)).toBeNull()
  })
})

describe('顶部进度条', () => {
  it('连续的值 + 层间刻度；不启用的层不占位置', () => {
    const layers = createMockState('l3-active').layers
    const all = layersProgress(layers)
    expect(all.ticks).toHaveLength(5)
    expect(all.value).toBeCloseTo(2.5 / 6)
    const imported = layers.map((l) => (l.layer === 'L3' || l.layer === 'L6' ? l : { ...l, status: 'disabled' as const }))
    expect(layersProgress(imported).ticks).toEqual([0.5])
    expect(layersProgress(layers, true).value).toBe(1)
    expect(layersProgress([])).toEqual({ value: 0, ticks: [] })
  })
})
