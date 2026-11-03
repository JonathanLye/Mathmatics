import { describe, expect, it } from 'vitest'
import { createMockState } from '@/mocks/attemptStates'
import {
  addTransferLine,
  completeTransferParent,
  deleteTransferLine,
  editTransferLine,
  fetchLesson,
  fetchNotebook,
  finishTransfer,
  startRedo,
  startTransfer,
  submitSelfcheck,
  submitSummary,
} from '@/api/client'
import type { AttemptState, LineDraft } from '@/types/attempt'

// #26/#47：L3 写完了 → L4 自检（自适应）→ L5 迁移题子作答（完整流程）→ L6 总结 → 完成页 / 证明本。

function lineDraft(statement: string, justification: string): LineDraft {
  return { statement, justification, input: { provenance: 'keyboard', draftId: 'test-' + statement.length } }
}

const SELFCHECK_IDS = ['SC1', 'SC2', 'SC3', 'SC5']

async function allSelfcheckPassed(): Promise<AttemptState> {
  let state = createMockState('l4-active')
  for (const itemId of SELFCHECK_IDS) {
    state = await submitSelfcheck(state, itemId, '由第 1 行通分得到的，N 只依赖 ε。')
  }
  return state
}

async function transferChild(parent: AttemptState): Promise<AttemptState> {
  let child = await startTransfer(parent)
  child = await addTransferLine(child, lineDraft('当 0<|x-1|<δ 时，', '由 |x-1| 的定义'))
  child = await addTransferLine(child, lineDraft('|f(x)-3|=2|x-1|<2δ=ε', '放大与取 δ=ε/2'))
  return child
}

async function toL6(): Promise<AttemptState> {
  const parent = await allSelfcheckPassed()
  const child = await finishTransfer(await transferChild(parent))
  return completeTransferParent(parent)
}

describe('第 4 层自检（mock submitSelfcheck + 自适应记录）', () => {
  it('不足 4 字 → followup，并写入 passed=false 记录', async () => {
    const start = createMockState('l4-active')
    const short = await submitSelfcheck(start, 'SC1', '不知道')
    const item = short.selfcheck?.items.find((i) => i.itemId === 'SC1')
    expect(item?.status).toBe('followup')
    expect(item?.attempts).toBe(1)
    expect(short.selfcheck?.records).toEqual([{ itemId: 'SC1', passed: false }])
    expect(short.currentLayer).toBe('L4')
  })

  it('补一句后 accepted；未全部通过前不推进层', async () => {
    let state = await submitSelfcheck(createMockState('l4-active'), 'SC1', '不知道')
    state = await submitSelfcheck(state, 'SC1', '由第 1 行通分得到')
    expect(state.selfcheck?.items.find((i) => i.itemId === 'SC1')?.status).toBe('accepted')
    expect(state.selfcheck?.records).toHaveLength(2)
    expect(state.currentLayer).toBe('L4')
  })

  it('四题全 accepted（或次数用尽）→ L4 done / L5 active，迁移题 not_started', async () => {
    const state = await allSelfcheckPassed()
    expect(state.currentLayer).toBe('L5')
    expect(state.layers.find((l) => l.layer === 'L4')?.status).toBe('done')
    expect(state.transfer?.status).toBe('not_started')
    expect(state.selfcheck?.items).toHaveLength(4)
  })

  it('某题两次都错 → 次数用尽，仍可完成本轮（mock 封顶 2 次）', async () => {
    let state = createMockState('l4-active')
    state = await submitSelfcheck(state, 'SC1', '短')
    state = await submitSelfcheck(state, 'SC1', '还是短')
    const item = state.selfcheck?.items.find((i) => i.itemId === 'SC1')
    expect(item?.attempts).toBe(2)
    expect(item?.status).toBe('followup')
    for (const id of ['SC2', 'SC3', 'SC5']) state = await submitSelfcheck(state, id, '由第 1 行通分得到')
    expect(state.currentLayer).toBe('L5')
  })
})

describe('第 5 层迁移题子作答（startTransfer / add / edit / delete / finish）', () => {
  it('startTransfer 返回 kind=transfer 的子作答 state：parentAttemptId、六层只启用 L3、预算 1', async () => {
    const parent = await allSelfcheckPassed()
    const child = await startTransfer(parent)
    expect(child.kind).toBe('transfer')
    expect(child.parentAttemptId).toBe(parent.attemptId)
    expect(child.status).toBe('active')
    expect(child.currentLayer).toBe('L3')
    expect(child.problem.problemId).toBe('epsN-T1')
    expect(child.problem.stem).toContain('varepsilon')
    expect(child.layers.filter((l) => l.enabled).map((l) => l.layer)).toEqual(['L3'])
    expect(child.budget.revealMax).toBe(1)
    expect(child.steps?.lines).toHaveLength(0)
  })

  it('加两行（结论+依据）后 canFinish=true，行内出现批注', async () => {
    const child = await transferChild(await allSelfcheckPassed())
    expect(child.steps?.lines).toHaveLength(2)
    expect(child.steps?.canFinish).toBe(true)
    expect(child.steps?.lines[0]?.n).toBe(1)
    expect(child.notes.some((note) => note.kind === 'annotation' && Boolean(note.lineId))).toBe(true)
    expect(child.steps?.lines[0]?.keys?.length).toBeGreaterThan(0)
  })

  it('只有一行 / 没有依据时不达标', async () => {
    let child = await startTransfer(await allSelfcheckPassed())
    child = await addTransferLine(child, lineDraft('当 0<|x-1|<δ 时，', '依据'))
    expect(child.steps?.canFinish).toBe(false)
    let child2 = await startTransfer(await allSelfcheckPassed())
    child2 = await addTransferLine(child2, lineDraft('当 0<|x-1|<δ 时，', ''))
    child2 = await addTransferLine(child2, lineDraft('|f(x)-3|<ε', ''))
    expect(child2.steps?.canFinish).toBe(false)
  })

  it('改写一行会重新归类并重算 canFinish；删除一行会重排行号', async () => {
    let child = await transferChild(await allSelfcheckPassed())
    const first = child.steps!.lines[0].lineId
    child = await editTransferLine(child, first, lineDraft('当 0<|x-1|<δ 时，', '改成更清楚的依据'))
    expect(child.steps?.lines[0]?.justification).toContain('更清楚')
    child = await deleteTransferLine(child, child.steps!.lines[0].lineId)
    expect(child.steps?.lines).toHaveLength(1)
    expect(child.steps?.lines[0]?.n).toBe(1)
    expect(child.steps?.canFinish).toBe(false)
  })

  it('不达标就写完了：只追加批注，不完成；达标后 completed', async () => {
    let child = await startTransfer(await allSelfcheckPassed())
    const rejected = await finishTransfer(child)
    expect(rejected.status).toBe('active')
    expect(rejected.notes.some((note) => note.text.includes('还有一处需要的结论没有出现'))).toBe(true)

    const done = await finishTransfer(await transferChild(await allSelfcheckPassed()))
    expect(done.status).toBe('completed')
    expect(done.completion?.done).toBe(true)
    expect(done.layers.find((l) => l.layer === 'L3')?.status).toBe('done')
  })
})

describe('父作答推进与第 6 层（completeTransferParent / submitSummary）', () => {
  it('子作答完成后父作答 L5 done → L6 active，并下发总结五问', async () => {
    const parent = await allSelfcheckPassed()
    const next = await completeTransferParent(parent)
    expect(next.currentLayer).toBe('L6')
    expect(next.layers.find((l) => l.layer === 'L5')?.status).toBe('done')
    expect(next.transfer?.status).toBe('completed')
    expect(next.summary?.questions).toHaveLength(5)
  })

  it('已完成的父作答原样返回（完成页「再做一道迁移题」场景）', async () => {
    const parent = createMockState('completed')
    const next = await completeTransferParent(parent)
    expect(next.status).toBe('completed')
    expect(next.stateVersion).toBe(parent.stateVersion)
  })

  it('五问提交 → completed，completion.done 且 leanCard 只列定理名/步骤名', async () => {
    const l6 = await toL6()
    const answers = ['证了什么', '分两块', '放大那步', '落到 <ε', '放缩可复用']
    const done = await submitSummary(l6, answers)
    expect(done.status).toBe('completed')
    expect(done.completion?.done).toBe(true)
    expect(done.summary?.answers).toEqual(answers)
    expect(done.layers.find((l) => l.layer === 'L6')?.status).toBe('done')
  })

  it('不在 L6 提交：原样返回', async () => {
    const l5 = await allSelfcheckPassed()
    const state = await submitSummary(l5, ['a', 'b', 'c', 'd', 'e'])
    expect(state.status).not.toBe('completed')
    expect(state.currentLayer).toBe('L5')
  })
})

describe('证明本「稍后重做」与新作答（mock fetchNotebook / startRedo）', () => {
  it('证明本卡片带独立度/教师标记/完成时间（稍后重做分档用）', async () => {
    const notebook = await fetchNotebook()
    expect(notebook.cards.length).toBeGreaterThanOrEqual(4)
    const epsN = notebook.cards.find((card) => card.problemId === 'epsN')
    expect(typeof epsN?.independence).toBe('number')
    expect(notebook.cards.some((card) => card.redoRecommended === true)).toBe(true)
    expect(notebook.cards.every((card) => Boolean(card.completedAt))).toBe(true)
  })

  it('startRedo 返回全新 main 作答（从 L1 开始，parentAttemptId 指向原作答）', async () => {
    const next = await startRedo('11111111-1111-4111-8111-111111111111')
    expect(next.kind).toBe('main')
    expect(next.status).toBe('active')
    expect(next.currentLayer).toBe('L1')
    expect(next.parentAttemptId).toBe('11111111-1111-4111-8111-111111111111')
    expect(next.stateVersion).toBe(1)
  })
})

describe('微课图解（#47 接线）', () => {
  it('微课 5 步：s1 含 seq-band、s2 含 abs-triangle，最后回到定义', async () => {
    const lesson = await fetchLesson(createMockState('l1-active'))
    expect(lesson.steps.length).toBeGreaterThanOrEqual(4)
    expect(lesson.steps[0]?.visual?.type).toBe('seq-band')
    expect(lesson.steps.some((step) => step.visual?.type === 'abs-triangle')).toBe(true)
    expect(lesson.steps[lesson.steps.length - 1]?.kind).toBe('return')
  })
})
