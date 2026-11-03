import { describe, expect, it } from 'vitest'
import { adaptiveHint, selfcheckAdaptiveInput, selfcheckProgress, SELFCHECK_ADAPTIVE_CONFIG } from '@/components/selfcheck/adaptView'
import { nextSelfcheck } from '@/components/selfcheck/adaptive'
import { buildRedoList, levelLabel, REDO_OPTIONS, toCompletedAttemptView } from '@/components/proofbook/redoInput'
import { minN } from '@/components/diagrams/seqBand'
import { mockLesson } from '@/mocks/laterLayers'
import type { NotebookCard, SelfcheckView } from '@/types/attempt'

// #47 接线层：纯函数映射（不带 DOM / 组件），保证 UI 用的就是 #47 的 adaptive / redo / diagrams 纯逻辑。

const NOW = Date.parse('2026-11-03T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

function selfcheckView(): SelfcheckView {
  return {
    items: [
      { itemId: 'SC1', question: 'q1', status: 'followup', dimension: 'basis', attempts: 1 },
      { itemId: 'SC2', question: 'q2', status: 'open', dimension: 'role', attempts: 0 },
      { itemId: 'SC3', question: 'q3', status: 'open', dimension: 'logic', attempts: 0 },
    ],
    records: [{ itemId: 'SC1', passed: false }],
  }
}

describe('自检自适应接线（adaptView）', () => {
  it('把 SelfcheckView 映射成 adaptive 输入（维度缺省按顺序兜底）', () => {
    const input = selfcheckAdaptiveInput({
      items: [{ itemId: 'A', question: 'q', status: 'open' }],
    })
    expect(input.items[0]).toMatchObject({ itemId: 'A', dimension: 'basis' })
    expect(input.records).toEqual([])
    expect(input.config).toEqual(SELFCHECK_ADAPTIVE_CONFIG)
  })

  it('答错一题后：先做下一道没做过的题（提示"先做下一题"）', () => {
    const input = selfcheckAdaptiveInput(selfcheckView())
    const decision = nextSelfcheck(input.items, input.records, input.config)
    expect(decision.action).toBe('next')
    expect(decision.nextItemId).toBe('SC2')
    expect(decision.waitQuestions).toBe(1)
    const hint = adaptiveHint(decision)
    expect(hint.kind).toBe('wait')
    expect(hint.text).toContain('先做下一题')
  })

  it('隔一道题之后重试答错题；次数用尽后结束', () => {
    const input = selfcheckAdaptiveInput(selfcheckView())
    const records = [...input.records, { itemId: 'SC2', passed: true }]
    const retry = nextSelfcheck(input.items, records, input.config)
    expect(retry.action).toBe('retry')
    expect(retry.nextItemId).toBe('SC1')
    expect(retry.attemptNo).toBe(2)
    expect(adaptiveHint(retry).kind).toBe('retry')

    const allFailedTwice = nextSelfcheck(
      input.items,
      [
        { itemId: 'SC1', passed: false },
        { itemId: 'SC2', passed: false },
        { itemId: 'SC2', passed: false },
        { itemId: 'SC1', passed: false },
        { itemId: 'SC3', passed: false },
        { itemId: 'SC3', passed: false },
      ],
      input.config,
    )
    expect(allFailedTwice.action).toBe('done')
  })

  it('进度统计：已通过 / 次数用尽', () => {
    const view: SelfcheckView = {
      items: [
        { itemId: 'A', question: 'q', status: 'accepted', attempts: 1 },
        { itemId: 'B', question: 'q', status: 'followup', attempts: 2 },
      ],
    }
    const decision = nextSelfcheck(selfcheckAdaptiveInput(view).items, selfcheckAdaptiveInput(view).records)
    expect(selfcheckProgress(view, decision)).toEqual({ passed: 1, total: 2, exhausted: 1 })
  })
})

const CARDS: NotebookCard[] = [
  {
    attemptId: 'a-dependent',
    problemId: 'p1',
    title: '依赖题',
    completedAt: daysAgo(10),
    independence: 0.4,
    kind: 'main',
  },
  {
    attemptId: 'a-teacher',
    problemId: 'p2',
    title: '老师标记题',
    completedAt: daysAgo(6),
    independence: 0.9,
    redoRecommended: true,
    kind: 'main',
  },
  {
    attemptId: 'a-hinted',
    problemId: 'p3',
    title: '有提示题',
    completedAt: daysAgo(12),
    independence: 0.62,
    kind: 'transfer',
  },
  {
    attemptId: 'a-recent',
    problemId: 'p4',
    title: '刚做完的题',
    completedAt: daysAgo(1),
    independence: 0.3,
    kind: 'main',
  },
]

describe('证明本「稍后重做」接线（redoInput）', () => {
  it('只推依赖/教师标记；有提示默认不推；冷却期内不推', () => {
    const list = buildRedoList(CARDS, { ...REDO_OPTIONS, now: NOW })
    expect(list.total).toBe(2)
    expect(list.redoable.map((entry) => entry.sourceAttemptId)).toEqual(['a-teacher', 'a-dependent'])
    expect(list.skippedRecent).toBe(1)
  })

  it('教师标记排在独立度前面；分档文案与独立度一致', () => {
    const list = buildRedoList(CARDS, { ...REDO_OPTIONS, now: NOW })
    expect(list.next?.title).toBe('老师标记题')
    expect(list.next?.reason).toContain('老师/系统标记')
    expect(levelLabel(0.4)).toBe('依赖')
    expect(levelLabel(0.62)).toBe('有提示')
    expect(levelLabel(0.9)).toBe('独立')
    expect(levelLabel(null)).toBe('未知')
  })

  it('toCompletedAttemptView：无 problemId 用 attemptId 兜底、缺 completedAt 有兜底', () => {
    const view = toCompletedAttemptView({ attemptId: 'x', title: 't' })
    expect(view.problemId).toBe('x')
    expect(view.completedAt).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('微课 seq-band 接线（预生成序列点 → #98 图解，不再有第二套 expr 求值）', () => {
  it('微课 s1 预生成概念例子 a_n=1+(-1)^n/n 的序列点（60 个），N(ε) 由 diagrams/seqBand.ts 计算', () => {
    const visual = mockLesson.steps[0]?.visual
    expect(visual?.type).toBe('seq-band')
    const points = visual?.params.points ?? []
    expect(points).toHaveLength(60)
    expect(points[0]).toEqual({ n: 1, a: 0 })
    expect(visual?.params.epsilon?.init).toBe(0.3)
    // ε=0.3 时：1/n < 0.3 → n > 3.33，最后一个带外点 n=3 → N=3
    expect(minN(points, Number(visual?.params.limit), 0.3).N).toBe(3)
  })

  it('abs-triangle（#47 mock 扩展）仍在微课数据里（#98 图解组件渲染）', () => {
    expect(mockLesson.steps.some((step) => step.visual?.type === 'abs-triangle')).toBe(true)
  })
})
