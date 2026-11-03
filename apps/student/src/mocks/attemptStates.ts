/**
 * 4 份典型 AttemptState（issue #9）。
 * 数据口径：10-开发文档/contracts/openapi.yaml 的 AttemptState + seed/epsN.json 的 public 部分。
 * 用途：无服务端时（#18/#19 未完成）让做题页可切换四种状态，验证 UI 骨架。
 * 注意：这里只放「服务端会下发的 state」，不冒充引擎判定；加行/提交后的状态变化见 api/client.ts 的 mock reducer。
 */
import type { AttemptState, Note, ProblemView } from '@/types/attempt'

const problem: ProblemView = {
  problemId: 'epsN',
  version: 1,
  title: '数列极限 · ε-N',
  stem: '用 $\\varepsilon$-$N$ 定义证明 $\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$。',
  chapter: '第二章 数列极限',
  source: 'v3 原型自编',
  keyCount: 4,
  askChips: ['这一行在做什么？', '什么是充分条件？', 'ε 和 N 是什么关系？'],
}

const now = '2026-11-03T00:30:00.000Z'

const layerTitles: Record<string, string> = {
  L1: '记忆核验',
  L2: '证明骨架',
  L3: '构造与推导',
  L4: '自检',
  L5: '迁移题',
  L6: '总结',
}

function layers(current: string, states: Record<string, string>): AttemptState['layers'] {
  return (['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((id) => ({
    layer: id,
    title: layerTitles[id],
    status: (states[id] ?? 'locked') as AttemptState['layers'][number]['status'],
    enabled: id !== 'L5',
    skippable: id === 'L1' || id === 'L2' || id === 'L4' || id === 'L5',
  }))
}

function base(): AttemptState {
  return {
    attemptId: '11111111-1111-4111-8111-111111111111',
    stateVersion: 7,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem,
    currentLayer: 'L1',
    layers: layers('L1', { L1: 'active' }),
    budget: { revealUsed: 0, revealMax: 2, keysOwn: 0, keysTotal: 4 },
    def: { task: '写出"数列 $\\{a_n\\}$ 以 $A$ 为极限"的定义。可以用量词，也可以先用你自己的话说。', conceptId: 'seq-limit', submissions: 0, last: null, lessonSuggested: false },
    frame: {
      task: '写出这个证明的骨架：开头写什么、结尾要落到什么、中间要构造的是什么。不必写出构造本身。',
      template: '要证 $\\forall\\varepsilon>0\\ \\exists N\\ \\forall n>N:\\ P(n)$。骨架：任取 $\\varepsilon>0$。取 $N=$ ＿（待构造）。则当 $n>N$ 时，$\\cdots<\\varepsilon$。',
      lessonId: 'frame-forall-exists',
      last: null,
      templateShown: false,
    },
    steps: { lines: [], canFinish: false },
    notes: [],
    help: { hintAvailable: true, nextLevel: 'H2', nextCost: 0.5, waitSec: 0, needAttempt: false, rapidLockUntil: null, exhausted: false, flagged: false, stuckOffer: false },
    integrity: { mode: 'practice', locked: false, warnings: 0, maxWarnings: null, notice: null, watermark: null },
    serverTime: now,
  }
}

const line1 = {
  lineId: '22222222-2222-4222-8222-222222222222',
  n: 1,
  statement: '$|a_n-3|=\\left|\\frac{3n+1}{n+2}-3\\right|=\\frac{5}{n+2}$',
  justification: '通分',
  provenance: 'ink' as const,
  keys: [] as string[],
  cls: null,
  path: null,
  inkId: '33333333-3333-4333-8333-333333333333',
}
const line2 = {
  lineId: '44444444-4444-4444-8444-444444444444',
  n: 2,
  statement: '$\\frac{5}{n+2}<\\frac{5}{n}$',
  justification: '',
  provenance: 'keyboard' as const,
  keys: [] as string[],
  cls: null,
  path: null,
  inkId: null,
}

const note1: Note = {
  noteId: '55555555-5555-4555-8555-555555555555',
  kind: 'annotation',
  who: '批注',
  text: '第 1 行和前面衔接上了。',
  lineId: line1.lineId,
  level: null,
  cost: null,
  lessonConceptId: null,
  at: now,
}
const note2: Note = {
  noteId: '66666666-6666-4666-8666-666666666666',
  kind: 'annotation',
  who: '批注',
  text: '依据没写。它由哪条定义或已证结论得到？',
  lineId: line2.lineId,
  level: null,
  cost: null,
  lessonConceptId: null,
  at: now,
}

/** 状态 1：第 1 层进行中（新题/登录后第一天） */
function l1Active(): AttemptState {
  return base()
}

/** 状态 2：第 3 层进行中（有 2 行 + 行内批注） */
function l3Active(): AttemptState {
  const s = base()
  s.stateVersion = 12
  s.currentLayer = 'L3'
  s.layers = layers('L3', { L1: 'done', L2: 'done', L3: 'active' })
  s.def = { ...s.def, submissions: 1, last: '任取 $\\varepsilon>0$，存在 $N$，当 $n>N$ 时 $|a_n-A|<\\varepsilon$。' }
  s.frame = { ...s.frame, last: '任取 ε>0。取 N=5/ε。则当 n>N 时，', templateShown: true }
  s.steps = { lines: [line1, line2], canFinish: false }
  s.budget = { revealUsed: 0.5, revealMax: 2, keysOwn: 1, keysTotal: 4 }
  s.notes = [note1, note2]
  return s
}

/** 状态 3：第 3 层 + 透露额度用尽 + 长时间卡住（软着陆） */
function l3Exhausted(): AttemptState {
  const s = l3Active()
  s.stateVersion = 15
  s.help = {
    hintAvailable: true,
    nextLevel: 'H4',
    nextCost: 0.5,
    waitSec: 0,
    needAttempt: false,
    rapidLockUntil: null,
    exhausted: true,
    flagged: true,
    stuckOffer: true,
  }
  s.budget = { revealUsed: 2, revealMax: 2, keysOwn: 1, keysTotal: 4 }
  s.notes = [
    note1,
    note2,
    {
      noteId: '77777777-7777-4777-8777-777777777777',
      kind: 'hint',
      who: 'H2 · 透露 0.5',
      text: '把 $|a_n-3|$ 单独算出来之后，先看它能不能用一个更简单的、只含 $n$ 的量控制住。',
      lineId: line2.lineId,
      level: 'H2',
      cost: 0.5,
      lessonConceptId: null,
      at: now,
    },
  ]
  return s
}

/** 状态 4：本题完成（第 6 层 / 完成页） */
function completed(): AttemptState {
  const s = l3Active()
  s.stateVersion = 21
  s.status = 'completed'
  s.currentLayer = 'L6'
  s.layers = layers('L6', { L1: 'done', L2: 'done', L3: 'done', L4: 'done', L5: 'skipped', L6: 'done' })
  s.steps = { lines: [line1, line2, { ...line2, lineId: '88888888-8888-4888-8888-888888888888', n: 3, statement: '$\\frac{5}{n}<\\varepsilon$', justification: '取 $N=5/\\varepsilon$' }, { ...line1, lineId: '99999999-9999-4999-8999-999999999999', n: 4, statement: '$\\forall\\varepsilon>0\\ \\exists N\\ \\forall n>N: |a_n-3|<\\varepsilon$', justification: '综上' }], canFinish: true }
  s.budget = { revealUsed: 0.5, revealMax: 2, keysOwn: 3, keysTotal: 4 }
  s.notes = [note1, note2]
  s.completion = {
    done: true,
    independence: 0.75,
    reviewAvailable: true,
    leanCard: { theorems: ['Filter.Tendsto', 'Metric.tendsto_atTop'] },
  }
  return s
}

export type MockKey = 'l1-active' | 'l3-active' | 'l3-exhausted' | 'completed'

export const MOCK_LABELS: Record<MockKey, string> = {
  'l1-active': '① 第 1 层进行中',
  'l3-active': '② 第 3 层进行中',
  'l3-exhausted': '③ 透露额度用尽',
  completed: '④ 本题完成',
}

export function createMockState(key: MockKey): AttemptState {
  switch (key) {
    case 'l1-active': return l1Active()
    case 'l3-active': return l3Active()
    case 'l3-exhausted': return l3Exhausted()
    case 'completed': return completed()
  }
}

export const DEFAULT_MOCK: MockKey = 'l3-active'

/** mock 识别结果（#15 的输入）：两路不一致的示例 */
export const mockRecognition = {
  recogId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'ok' as const,
  text: '$|a_n-3|=\\frac{5}{n+2}$',
  agree: false as const,
  confidence: 0.72,
  rendered: true as const,
  diff: [{ start: 6, end: 11, alt: '5/(n+z)' }],
  lines: [{ text: '$|a_n-3|=\\frac{5}{n+2}$', confidence: 0.72 }],
}
