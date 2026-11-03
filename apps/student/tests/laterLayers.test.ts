import { describe, expect, it } from 'vitest'
import { createMockState } from '@/mocks/attemptStates'
import {
  completeTransfer,
  fetchLesson,
  fetchNotebook,
  startTransfer,
  submitSelfcheck,
  submitSummary,
} from '@/api/client'

// #26：L3 写完了 → L4 自检 → L5 迁移 → L6 总结 → 完成页 的 mock 状态机。

async function allSelfcheckPassed() {
  let state = createMockState('l4-active')
  for (const itemId of ['SC1', 'SC2', 'SC3']) {
    state = await submitSelfcheck(state, itemId, '由第 1 行通分得到的，N 只依赖 ε。')
  }
  return state
}

async function toL6() {
  let state = await startTransfer(await allSelfcheckPassed())
  state = await completeTransfer(state, '任取 ε>0。取 δ=ε/2。当 0<|x-1|<δ 时，….')
  return state
}

describe('第 4 层自检（mock submitSelfcheck）', () => {
  it('不足 4 字 → followup，不推进层；补一句后 accepted', async () => {
    const start = createMockState('l4-active')
    const short = await submitSelfcheck(start, 'SC1', '不知道')
    const shortItem = short.selfcheck?.items.find((item) => item.itemId === 'SC1')
    expect(shortItem?.status).toBe('followup')
    expect(short.currentLayer).toBe('L4')

    const ok = await submitSelfcheck(start, 'SC1', '由第 1 行通分得到')
    expect(ok.selfcheck?.items.find((item) => item.itemId === 'SC1')?.status).toBe('accepted')
    expect(ok.currentLayer).toBe('L4')
  })

  it('三题全 accepted → L4 done / L5 active，并下发未开始的迁移题（not_started）', async () => {
    const state = await allSelfcheckPassed()
    expect(state.currentLayer).toBe('L5')
    expect(state.layers.find((l) => l.layer === 'L4')?.status).toBe('done')
    expect(state.layers.find((l) => l.layer === 'L5')?.status).toBe('active')
    expect(state.transfer?.status).toBe('not_started')
    expect(state.selfcheck?.items.every((item) => item.status === 'accepted')).toBe(true)
  })

  it('已 accepted 的题重复提交不推进/不涨版本', async () => {
    const start = createMockState('l4-active')
    const once = await submitSelfcheck(start, 'SC1', '由第 1 行通分得到')
    const twice = await submitSelfcheck(once, 'SC1', '再写一次')
    expect(twice.stateVersion).toBe(once.stateVersion)
  })
})

describe('第 5 层迁移题（mock startTransfer / completeTransfer）', () => {
  it('startTransfer 创建子作答并下发迁移题题面', async () => {
    const before = await allSelfcheckPassed()
    const state = await startTransfer(before)
    expect(state.transfer?.status).toBe('active')
    expect(state.transfer?.childAttemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.transfer?.stem).toContain('varepsilon')
    expect(state.stateVersion).toBe(before.stateVersion + 1)
  })

  it('completeTransfer → L5 done / L6 active，并下发总结五问', async () => {
    const l5 = await startTransfer(await allSelfcheckPassed())
    const state = await completeTransfer(l5, '任取 ε>0……')
    expect(state.currentLayer).toBe('L6')
    expect(state.layers.find((l) => l.layer === 'L5')?.status).toBe('done')
    expect(state.summary?.questions).toHaveLength(5)
    expect(state.summary?.answers).toHaveLength(0)
  })

  it('没开始迁移题就提交：原样返回', async () => {
    const notStarted = await allSelfcheckPassed()
    const state = await completeTransfer(notStarted, '随便写点')
    expect(state.currentLayer).toBe('L5')
    expect(state.transfer?.status).toBe('not_started')
  })
})

describe('第 6 层总结与完成页（mock submitSummary）', () => {
  it('五问提交 → completed，completion.done 且 leanCard 只有定理名/步骤名', async () => {
    const l6 = await toL6()
    const answers = ['证了什么', '分两块', '放大那步', '落到 <ε', '放缩可复用']
    const done = await submitSummary(l6, answers)
    expect(done.status).toBe('completed')
    expect(done.completion?.done).toBe(true)
    expect(done.summary?.answers).toEqual(answers)
    expect(done.layers.find((l) => l.layer === 'L6')?.status).toBe('done')
    expect(done.completion?.leanCard?.theorems?.length).toBeGreaterThan(0)
  })

  it('不在 L6 提交：原样返回', async () => {
    const l5 = await startTransfer(await allSelfcheckPassed())
    const state = await submitSummary(l5, ['a', 'b', 'c', 'd', 'e'])
    expect(state.status).not.toBe('completed')
    expect(state.currentLayer).toBe('L5')
  })
})

describe('微课与证明本（mock fetchLesson / fetchNotebook）', () => {
  it('微课 5 步：含 seq-band 图解 + 每步小核验，最后回到定义', async () => {
    const lesson = await fetchLesson(createMockState('l1-active'))
    expect(lesson.conceptId).toBe('seq-limit')
    expect(lesson.steps.length).toBeGreaterThanOrEqual(3)
    expect(lesson.steps.some((step) => step.visual?.type === 'seq-band')).toBe(true)
    expect(lesson.steps.filter((step) => step.check).length).toBeGreaterThanOrEqual(3)
    expect(lesson.steps[lesson.steps.length - 1].kind).toBe('return')
  })

  it('证明本返回已完成列表，且包含本题', async () => {
    const notebook = await fetchNotebook()
    expect(notebook.cards.length).toBeGreaterThanOrEqual(1)
    expect(notebook.cards.some((card) => card.title.includes('数列极限'))).toBe(true)
    expect(notebook.cards.every((card) => typeof card.attemptId === 'string')).toBe(true)
  })
})
