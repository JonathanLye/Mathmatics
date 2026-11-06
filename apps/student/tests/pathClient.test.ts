import { beforeEach, describe, expect, it } from 'vitest'

import {
  getAttemptReview,
  getPracticeSolution,
  getStudentPath,
  listPractice,
  randomPracticeProblem,
  revealPracticeSolution,
  startPathItem,
  startPracticeProblem,
  __resetClientForTests,
} from '@/api/client'
import { BANK, UNITS } from '@/mocks/pathBank'
import { __completeMockProblem, __resetPathMockForTests, stemPreview } from '@/mocks/pathMock'

beforeEach(() => {
  __resetClientForTests()
  __resetPathMockForTests()
})

describe('mock 题库', () => {
  it('30 道题、多个单元、每题带解题思路与参考证明，难度覆盖三档', () => {
    expect(BANK).toHaveLength(30)
    expect(UNITS.length).toBeGreaterThanOrEqual(8)
    for (const p of BANK) {
      expect(p.solution.approach.length, p.id).toBeGreaterThan(10)
      expect(p.solution.keyIdeas.length, p.id).toBeGreaterThanOrEqual(1)
      expect(p.solution.keyIdeas.length, p.id).toBeLessThanOrEqual(5)
      expect(p.solution.referenceProof.length, p.id).toBeGreaterThan(10)
    }
    expect(new Set(BANK.map((p) => p.difficulty))).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('题面预览不会把公式切成两半', () => {
    for (const p of BANK) {
      for (const max of [20, 35, 60]) {
        const out = stemPreview(p.stem, max).replace(/…$/, '')
        expect([...out.matchAll(/(?<!\\)\$/g)].length % 2, `${p.id}@${max}`).toBe(0)
      }
    }
  })
})

describe('getStudentPath（mock）', () => {
  it('默认展开第一个没做完的单元，其余只有摘要；后续单元软锁', async () => {
    const path = await getStudentPath()
    expect(path.units.length).toBe(UNITS.length)
    expect(path.units.filter((u) => 'items' in u)).toHaveLength(0)
    // 第一、二单元（第一章）没做完 → 默认第一个单元，第二单元已被软锁（第一单元完成不到 60%）。
    expect(path.current?.chapterNo).toBe(1)
    expect(path.units[1]?.locked).toBe(true)
    expect(path.teacherAssignments).toHaveLength(1)
    expect(path.chapters.map((c) => c.chapterNo)).toEqual([1, 2, 3, 4, 12])
    const second = await getStudentPath(path.units[2]?.id)
    expect(second.current?.id).toBe(path.units[2]?.id)
    expect(second.current?.items.map((i) => i.state)).toEqual(['done', 'done', 'active', 'todo'])
    expect(second.current?.items[3]?.softLocked).toBe(true)
  })

  it('完成 60% 开放下一单元', async () => {
    for (const id of ['sup-1', 'sup-2']) __completeMockProblem(id)
    const path = await getStudentPath()
    expect(path.units[1]?.locked).toBe(false)
  })
})

describe('练习区（mock）', () => {
  it('筛选、分面、游标分页', async () => {
    const all = await listPractice({ limit: 50 })
    expect(all.items).toHaveLength(30)
    expect(all.nextCursor).toBeNull()
    expect(all.facets.difficulty.easy + all.facets.difficulty.medium + all.facets.difficulty.hard).toBe(30)
    const hard = await listPractice({ difficulty: 'hard' })
    expect(hard.items.every((i) => i.difficulty === 'hard')).toBe(true)
    expect(hard.facets.chapters.length).toBeGreaterThan(1)

    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 20; i += 1) {
      const page = await listPractice({ limit: 7, cursor })
      seen.push(...page.items.map((x) => x.problemId))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(all.items.map((i) => i.problemId))
    expect((await listPractice({ q: '夹逼' })).items.map((i) => i.problemId)).toContain('mono-1')
    expect((await listPractice({ status: 'done' })).items.map((i) => i.problemId)).toEqual(['seq-1', 'seq-2'])
  })

  it('随机只给没做完的题；范围做完后 404', async () => {
    for (let i = 0; i < 20; i += 1) expect(['seq-1', 'seq-2']).not.toContain((await randomPracticeProblem()).problemId)
    for (const p of BANK.filter((b) => b.difficulty === 5)) __completeMockProblem(p.id)
    await expect(randomPracticeProblem({ difficulty: 'hard' })).resolves.toBeTruthy()
    for (const p of BANK.filter((b) => b.difficulty >= 4)) __completeMockProblem(p.id)
    await expect(randomPracticeProblem({ difficulty: 'hard' })).rejects.toMatchObject({ status: 404 })
  })

  it('解答分级：未开始不能看；开始后先思路再完整；完成后自动完整', async () => {
    expect(await getPracticeSolution('fn-1')).toMatchObject({ level: 'none', canReveal: false })
    await expect(revealPracticeSolution('fn-1', 'approach')).rejects.toMatchObject({ status: 409 })
    const state = await startPracticeProblem('fn-1')
    expect(state.problem.problemId).toBe('fn-1')
    const approach = await revealPracticeSolution('fn-1', 'approach')
    expect(approach).toMatchObject({ level: 'approach', canReveal: true })
    expect(approach.pitfalls).toBeUndefined()
    expect(approach.referenceProof).toBeUndefined()
    const full = await revealPracticeSolution('fn-1', 'full')
    expect(full.level).toBe('full')
    expect(full.referenceProof).toBeTruthy()
    __completeMockProblem('fn-2')
    expect((await getPracticeSolution('fn-2')).level).toBe('full')
  })

  it('导入题只启用写证明与总结两层；讲评完成后才可看', async () => {
    const state = await startPathItem('fl-1')
    expect(state.currentLayer).toBe('L3')
    expect(state.layers.filter((l) => l.status === 'disabled').map((l) => l.layer)).toEqual(['L1', 'L2', 'L4', 'L5'])
    await expect(getAttemptReview(state.attemptId)).rejects.toMatchObject({ status: 403 })
    __completeMockProblem('fl-1')
    expect((await getAttemptReview(state.attemptId)).proofs).toHaveLength(1)
  })
})
