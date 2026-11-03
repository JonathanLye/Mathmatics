/**
 * 学生端 API 客户端（P0：mock 适配层）。
 *
 * - 契约真源：10-开发文档/contracts/openapi.yaml；#18/#19（B）未完成前，本文件用 mock reducer 驱动 UI。
 * - 真实接口接入（issue #24）：把 USE_MOCK 换成 false 并实现 fetch 分支；写请求需带
 *   Idempotency-Key / If-Match，409 STATE_STALE 用响应 state 覆盖 —— 不在本单范围。
 * - 前端永远不做判定：这里只模拟「服务端会返回什么 state」，不实现层/预算/门槛逻辑。
 */
import { createMockState, DEFAULT_MOCK, mockRecognition, type MockKey } from '@/mocks/attemptStates'
import {
  mockLesson,
  mockNotebook,
  mockSelfcheckItems,
  mockSummaryQuestions,
  mockTransferLayers,
  mockTransferNotStarted,
  mockTransferProblem,
  mockTransferStem,
} from '@/mocks/laterLayers'
import { SELFCHECK_ADAPTIVE_CONFIG } from '@/components/selfcheck/adaptView'
import type {
  AttemptState,
  HelpIntent,
  HelpResult,
  HintPreview,
  LayerId,
  LessonView,
  LineDraft,
  Note,
  NotebookView,
  ProofLine,
  Recognition,
} from '@/types/attempt'

const USE_MOCK = true
const LATENCY = 160

const sleep = (ms = LATENCY) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export interface HomeData {
  greeting: string
  weeklyOwn: number
  weeklyTotal: number
  ongoing: Array<{ id: string; title: string; layerTitle: string; mock: MockKey }>
  pending: Array<{ id: string; title: string; dueText: string }>
  completed: Array<{ id: string; title: string; independence: number | null }>
}

export const mockHome: HomeData = {
  greeting: '你好，S-7K2Q9M',
  weeklyOwn: 3,
  weeklyTotal: 4,
  ongoing: [{ id: 'attempt-epsN', title: '数列极限 · ε-N', layerTitle: '第 3 层 · 构造与推导', mock: 'l3-active' }],
  pending: [{ id: 'attempt-series', title: '交错级数 · 收敛性', dueText: '周五 23:59 截止' }],
  completed: [{ id: 'attempt-epsN-done', title: '数列极限 · ε-N', independence: 0.75 }],
}

export async function fetchHome(): Promise<HomeData> {
  await sleep()
  return clone(mockHome)
}

export async function fetchAttempt(mock: MockKey = DEFAULT_MOCK): Promise<AttemptState> {
  await sleep()
  return createMockState(mock)
}

/** 第 1 层：提交定义 → 服务端返回下一层 state（mock：L1 done / L2 active） */
export async function submitDef(state: AttemptState, text: string): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.def = { ...(next.def ?? {}), submissions: (next.def?.submissions ?? 0) + 1, last: text, lessonSuggested: false }
  next.layers = next.layers.map((l) => (l.layer === 'L1' ? { ...l, status: 'done' as const } : l.layer === 'L2' ? { ...l, status: 'active' as const } : l))
  next.currentLayer = 'L2'
  next.serverTime = new Date().toISOString()
  return next
}

/** 第 2 层：提交骨架 → L3 active */
export async function submitFramework(state: AttemptState, text: string): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.frame = { ...(next.frame ?? {}), last: text, templateShown: true }
  next.layers = next.layers.map((l) =>
    l.layer === 'L1' ? { ...l, status: 'done' as const } :
    l.layer === 'L2' ? { ...l, status: 'done' as const } :
    l.layer === 'L3' ? { ...l, status: 'active' as const } : l,
  )
  next.currentLayer = 'L3'
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 跳层：POST /attempts/{id}/layers/{L}/skip（06 §3.2 · openapi.yaml skipLayer）。
 *
 * 跳层是独立操作，不是「把已掌握，跳过当文本提交」：不写 def.last / frame.last，也不增加提交计数。
 * mock：把该层标为 skipped（openapi LayerStatus 有独立状态）、下一层置为 active 并切过去。
 * TODO(#24)：接真实接口时改为 POST /attempts/{id}/layers/{layer}/skip，带 Idempotency-Key；
 * 409 STATE_STALE 用响应里的 state 覆盖，422/429 的错误文案直接展示服务端 message。
 */
export async function skipLayer(state: AttemptState, layer: LayerId): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  // 只处理当前层；重复点/过期请求不推进（真实接口由幂等键与服务端判定兜底）。
  if (next.currentLayer !== layer) return next
  const idx = next.layers.findIndex((l) => l.layer === layer)
  if (idx === -1) return next
  const nextLayer = next.layers[idx + 1]
  next.stateVersion += 1
  next.layers = next.layers.map((l) =>
    l.layer === layer
      ? { ...l, status: 'skipped' as const }
      : nextLayer && l.layer === nextLayer.layer
        ? { ...l, status: 'active' as const }
        : l,
  )
  if (nextLayer) {
    next.currentLayer = nextLayer.layer
    // 跳到第 4 层之后的层时，服务端会一并下发展开所需的数据（01 §L4–L6）。
    if (nextLayer.layer === 'L5') next.transfer = clone(mockTransferNotStarted)
    if (nextLayer.layer === 'L6') {
      next.transfer =
        next.transfer && next.transfer.status !== 'completed'
          ? { ...next.transfer, status: 'skipped' }
          : next.transfer
      next.summary = { questions: [...mockSummaryQuestions], answers: [], followup: null }
    }
  }
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 看通用骨架：POST /attempts/{id}/framework/template（06 §3.2 · openapi.yaml viewFrameTemplate）。
 *
 * 通用骨架属于形式部分，不计透露量；服务端记录「看过模板」并返回 frame.templateShown=true 的新 state。
 * 前端不自己置 templateShown —— 模板是否展开只看服务端下发的 state（刷新/重连后仍保持）。
 * TODO(#24)：接真实接口时改为 POST /attempts/{id}/framework/template，带 Idempotency-Key；
 * 409 STATE_STALE 用响应里的 state 覆盖。
 */
export async function viewFrameTemplate(state: AttemptState): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  // 只有第 2 层能看通用骨架；其他层原样返回（真实接口返回 409 WRONG_LAYER）。
  if (next.currentLayer !== 'L2') return next
  next.stateVersion += 1
  next.frame = { ...(next.frame ?? {}), templateShown: true }
  next.serverTime = new Date().toISOString()
  return next
}

/** 第 3 层：加入一行 → 服务端返回 state（mock：追加行 + 行内批注） */
export async function addLine(state: AttemptState, draft: LineDraft): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  const lines = next.steps?.lines ?? []
  const n = lines.length + 1
  const lineId = mockUuid()
  lines.push({
    lineId,
    n,
    statement: draft.statement,
    justification: draft.justification ?? '',
    provenance: draft.input.provenance,
    keys: [],
    inkId: null,
  })
  next.steps = { lines, canFinish: lines.length >= 2 }
  next.stateVersion += 1
  // 写完一行后门槛满足：下一条提示重新可预览（01 §4：自上一条提示后又提交过一行）
  next.help = { ...next.help, needAttempt: false, waitSec: 0 }
  // mock 批注：依据为空时追问；否则「衔接上了」
  if (!draft.justification) {
    next.notes = [
      ...next.notes,
      {
        noteId: mockUuid(),
        kind: 'annotation',
        who: '批注',
        text: '依据没写。它由哪条定义或已证结论得到？',
        lineId,
        level: null,
        cost: null,
        lessonConceptId: null,
        at: new Date().toISOString(),
      },
    ]
  } else {
    next.notes = [
      ...next.notes,
      {
        noteId: mockUuid(),
        kind: 'annotation',
        who: '批注',
        text: '这一行和前面衔接上了。',
        lineId,
        level: null,
        cost: null,
        lessonConceptId: null,
        at: new Date().toISOString(),
      },
    ]
  }
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 第 3 层：写完了（POST /finish）。
 * mock：L3 done、L4 active，并由服务端挑 3 道自检题下发（01 §L4：一题依据、一题作用、一题逻辑地位）。
 */
export async function finishSteps(state: AttemptState): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.layers = next.layers.map((l) =>
    l.layer === 'L3' ? { ...l, status: 'done' as const } : l.layer === 'L4' ? { ...l, status: 'active' as const } : l,
  )
  next.currentLayer = 'L4'
  next.selfcheck = { items: mockSelfcheckItems.map((item) => ({ ...item })), records: [] }
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 第 1–2 层：取微课（GET /attempts/{id}/lesson/{conceptId}）。
 * mock 返回概念库的预写微课（seed concepts.json 的 seq-limit）；真实接口 #24 按 conceptId 下发。
 * 微课文本已由服务端过闸门，前端只渲染。
 */
export async function fetchLesson(state: AttemptState, conceptId?: string): Promise<LessonView> {
  await sleep()
  const topic = conceptId ?? state.def?.conceptId ?? mockLesson.conceptId
  return clone({ ...mockLesson, conceptId: topic })
}

/**
 * 第 4 层：回答一道自检题（POST /attempts/{id}/selfcheck/{itemId}）。
 *
 * mock 判定口径（P0 规则兜底，01 §L4）：≥4 字即 accepted；不足 4 字 followup（只追问、不给答案）。
 * 每次作答写入 mock 的 passed 记录（契约里由服务端判定并下发；records 是 #47 自适应接线的 mock 扩展）。
 * 完成条件（mock reducer 判定，前端不判）：全部 accepted，或每题都用满 maxAttempts → L5 active。
 * TODO(#24)：接真实接口时带 Idempotency-Key；判定/追问/记录都来自服务端。
 */
export async function submitSelfcheck(state: AttemptState, itemId: string, text: string): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.currentLayer !== 'L4' || !next.selfcheck) return next
  const item = next.selfcheck.items.find((i) => i.itemId === itemId)
  if (!item) return next
  const maxAttempts = SELFCHECK_ADAPTIVE_CONFIG.maxAttempts ?? 2
  if (item.status === 'accepted' || (item.attempts ?? 0) >= maxAttempts) return next
  next.stateVersion += 1
  const answer = text.trim()
  const passed = answer.length >= 4
  item.answer = answer
  item.status = passed ? 'accepted' : 'followup'
  item.attempts = (item.attempts ?? 0) + 1
  next.selfcheck.records = [...(next.selfcheck.records ?? []), { itemId, passed }]
  const finished = next.selfcheck.items.every(
    (i) => i.status === 'accepted' || (i.attempts ?? 0) >= maxAttempts,
  )
  if (finished) advanceToTransferLayer(next)
  next.serverTime = new Date().toISOString()
  return next
}

/** L4 → L5：服务端在进入 L5 时准备迁移题；子作答要等学生点「开始迁移题」才创建。 */
function advanceToTransferLayer(next: AttemptState): void {
  next.layers = next.layers.map((l) =>
    l.layer === 'L4' ? { ...l, status: 'done' as const } : l.layer === 'L5' ? { ...l, status: 'active' as const } : l,
  )
  next.currentLayer = 'L5'
  next.transfer = clone(mockTransferNotStarted)
}

// ------------------------------------------------------------------ 第 5 层：迁移题子作答

function classifyTransferKeys(statement: string): string[] {
  const keys: string[] = []
  if (statement.includes('|x-1|') || statement.includes('|x − 1|') || statement.includes('|x - 1|')) keys.push('K1')
  if (statement.includes('δ') || statement.includes('delta')) keys.push('K2')
  if (statement.includes('ε') || statement.includes('varepsilon')) keys.push('K3')
  return keys
}

/** mock 判定「写完了」：≥2 行、每行有依据、关键步骤覆盖 ≥2 个（P0 只校齐全，不校逻辑顺序）。 */
function transferCanFinish(lines: readonly ProofLine[]): boolean {
  if (lines.length < 2) return false
  if (!lines.every((line) => (line.justification ?? '').trim().length > 0)) return false
  const keys = new Set(lines.flatMap((line) => line.keys ?? []))
  return keys.size >= 2
}

function renumberLines(lines: ProofLine[]): ProofLine[] {
  return lines.map((line, index) => ({ ...line, n: index + 1 }))
}

function transferNote(hasJustification: boolean, lineId: string, hasKeys: boolean): Note {
  return {
    noteId: mockUuid(),
    kind: 'annotation',
    who: '批注',
    text: !hasJustification
      ? '依据没写。它由哪条定义或已证结论得到？'
      : hasKeys
        ? '这一行和前面衔接上了。'
        : '这一行和要证的结论是什么关系？它的依据是哪条定义或定理？',
    lineId,
    level: null,
    cost: null,
    lessonConceptId: null,
    at: new Date().toISOString(),
  }
}

/**
 * 第 5 层：开始迁移题（POST /attempts/{id}/transfer）。
 * 契约返回的是**子作答 state**：kind=transfer、parentAttemptId=主题作答、六层只启用 L3（seed epsN-T1）。
 * mock 在这里直接构造子作答 state；真接口由服务端创建子作答并返回。
 * TODO(#24)：真实接口带 Idempotency-Key；题目包/预算/层配置由服务端下发。
 */
export async function startTransfer(state: AttemptState): Promise<AttemptState> {
  await sleep()
  const attemptId = mockUuid()
  const now = new Date().toISOString()
  const child: AttemptState = {
    attemptId,
    parentAttemptId: state.attemptId,
    stateVersion: 1,
    kind: 'transfer',
    status: 'active',
    mode: state.mode,
    problem: clone(mockTransferProblem),
    currentLayer: 'L3',
    layers: mockTransferLayers(),
    budget: { revealUsed: 0, revealMax: 1, keysOwn: 0, keysTotal: 3 },
    steps: { lines: [], canFinish: false },
    transfer: { childAttemptId: attemptId, stem: mockTransferStem, status: 'active' },
    notes: [],
    help: {
      hintAvailable: true,
      nextLevel: 'H2',
      nextCost: 0.5,
      waitSec: 0,
      needAttempt: false,
      rapidLockUntil: null,
      exhausted: false,
      flagged: false,
      stuckOffer: false,
    },
    integrity: { ...state.integrity, locked: false, warnings: 0 },
    serverTime: now,
  }
  return child
}

/**
 * 第 5 层：加入一行（POST /attempts/{childAttemptId}/lines）。
 * mock：追加行 + 近似归类 + 行内批注（依据没写/衔接/关系问句），并重算「写完了」判定。
 * TODO(#24)：真实接口由引擎归类，批注来自题目包预写文本。
 */
export async function addTransferLine(state: AttemptState, draft: LineDraft): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.kind !== 'transfer' || next.status !== 'active' || !next.steps) return next
  const lineId = mockUuid()
  const line: ProofLine = {
    lineId,
    n: (next.steps.lines ?? []).length + 1,
    statement: draft.statement.trim(),
    justification: (draft.justification ?? '').trim(),
    provenance: draft.input.provenance,
    keys: classifyTransferKeys(draft.statement),
    inkId: null,
  }
  const lines = [...(next.steps.lines ?? []), line]
  next.steps = { lines, canFinish: transferCanFinish(lines) }
  next.stateVersion += 1
  next.notes = [...next.notes, transferNote(Boolean(line.justification), lineId, (line.keys?.length ?? 0) > 0)]
  next.serverTime = new Date().toISOString()
  return next
}

/** 第 5 层：修改一行（PATCH /lines/{lineId}；mock 重新归类并更新 canFinish）。 */
export async function editTransferLine(state: AttemptState, lineId: string, draft: LineDraft): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.kind !== 'transfer' || next.status !== 'active' || !next.steps) return next
  if (!next.steps.lines.some((line) => line.lineId === lineId)) return next
  const lines = next.steps.lines.map((line) =>
    line.lineId === lineId
      ? {
          ...line,
          statement: draft.statement.trim(),
          justification: (draft.justification ?? '').trim(),
          provenance: draft.input.provenance,
          keys: classifyTransferKeys(draft.statement),
        }
      : line,
  )
  next.steps = { lines, canFinish: transferCanFinish(lines) }
  next.stateVersion += 1
  next.serverTime = new Date().toISOString()
  return next
}

/** 第 5 层：删除一行（DELETE /lines/{lineId}，软删除；mock 直接移出并重排行号）。 */
export async function deleteTransferLine(state: AttemptState, lineId: string): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.kind !== 'transfer' || next.status !== 'active' || !next.steps) return next
  const lines = renumberLines(next.steps.lines.filter((line) => line.lineId !== lineId))
  next.steps = { lines, canFinish: transferCanFinish(lines) }
  next.stateVersion += 1
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 第 5 层：写完了（POST /attempts/{childAttemptId}/finish）。
 * mock 判定（state.steps.canFinish 由 addLine 维护）：达标 → completed；不达标 → 只追加一条批注，不给答案。
 * TODO(#24)：真实接口由服务端判定并返回 state；不达标文案来自题目包预写文本。
 */
export async function finishTransfer(state: AttemptState): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.kind !== 'transfer' || next.status !== 'active' || !next.steps) return next
  if (!next.steps.canFinish) {
    next.notes = [
      ...next.notes,
      {
        noteId: mockUuid(),
        kind: 'annotation',
        who: '批注',
        text: '还有一处需要的结论没有出现。回到骨架看看：链条哪里断了？',
        lineId: null,
        level: null,
        cost: null,
        lessonConceptId: null,
        at: new Date().toISOString(),
      },
    ]
    next.serverTime = new Date().toISOString()
    return next
  }
  next.status = 'completed'
  next.layers = next.layers.map((l) => (l.layer === 'L3' ? { ...l, status: 'done' as const } : l))
  next.budget = { ...next.budget, keysOwn: Math.max(next.budget.keysOwn, 2) }
  next.completion = {
    done: true,
    independence: 0.9,
    reviewAvailable: false,
    leanCard: { theorems: ['Filter.Tendsto', 'Metric.tendsto_atTop'] },
  }
  next.stateVersion += 1
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 证明本「稍后重做」：为同一道题发起一份新作答（mock POST /student/assignments/{id}/attempt）。
 * 返回全新的 main state（从 L1 开始），由证明本页暂存后交给做题页（跨页交接见 stores/attempt.ts）。
 * TODO(#24)：真实接口按 assignmentId/problemId 创建新作答并返回 state。
 */
export async function startRedo(sourceAttemptId?: string): Promise<AttemptState> {
  await sleep()
  const next = clone(createMockState('l1-active'))
  next.attemptId = mockUuid()
  next.parentAttemptId = sourceAttemptId ?? null
  next.stateVersion = 1
  next.status = 'active'
  next.currentLayer = 'L1'
  next.serverTime = new Date().toISOString()
  return next
}


/**
 * 迁移题子作答完成之后，服务端返回**父作答**的新 state：L5 done → L6 active 并下发总结五问。
 * （openapi /transfer 只返回子作答 state；父作答状态由 /attempts/{id} 重新拉取或服务端推送，#24）
 * mock：父作答已 completed 时原样返回（从完成页「再做一道迁移题」的场景）。
 * TODO(#24)：真实接口在子作答 finish 后由服务端推进父作答，前端按父 state 渲染。
 */
export async function completeTransferParent(parent: AttemptState): Promise<AttemptState> {
  await sleep()
  const next = clone(parent)
  if (next.status === 'completed') return next
  if (next.currentLayer !== 'L5') return next
  next.stateVersion += 1
  next.transfer = { ...(next.transfer ?? {}), status: 'completed' }
  next.layers = next.layers.map((l) =>
    l.layer === 'L5' ? { ...l, status: 'done' as const } : l.layer === 'L6' ? { ...l, status: 'active' as const } : l,
  )
  next.currentLayer = 'L6'
  next.summary = { questions: [...mockSummaryQuestions], answers: [], followup: null }
  next.serverTime = new Date().toISOString()
  return next
}

/**
 * 第 6 层：提交五问总结（POST /attempts/{id}/summary）。
 * mock：L6 done、attempt completed，返回完成页信息（独立度 / mathlib4 对照只列定理名与步骤名）。
 * TODO(#24)：追问/要点比对在服务端；P0 只校齐全，不校验逻辑顺序。
 */
export async function submitSummary(state: AttemptState, answers: string[]): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  if (next.currentLayer !== 'L6' || !next.summary) return next
  next.stateVersion += 1
  next.summary = { ...next.summary, answers: answers.slice(0, next.summary.questions.length), followup: null }
  next.layers = next.layers.map((l) => (l.layer === 'L6' ? { ...l, status: 'done' as const } : l))
  next.status = 'completed'
  next.budget = { ...next.budget, keysOwn: Math.max(next.budget.keysOwn, 3) }
  next.completion = {
    done: true,
    independence: 0.75,
    reviewAvailable: false,
    leanCard: {
      theorems: ['Filter.Tendsto', 'Metric.tendsto_atTop'],
      steps: [
        { keyId: 'K1', label: '化简 |aₙ−3|' },
        { keyId: 'K2', label: '放大到关于 n 的简单式子' },
        { keyId: 'K3', label: '取 N 只依赖 ε' },
        { keyId: 'K4', label: '串成链，落到 < ε' },
      ],
    },
  }
  next.serverTime = new Date().toISOString()
  return next
}

/** 证明本（GET /student/notebook）：mock 返回已完成作业列表；cards[].mock 仅 mock 阶段用来「回到该题」。 */
export async function fetchNotebook(): Promise<NotebookView> {
  await sleep()
  return clone(mockNotebook)
}

/** 可领取的预览。revealAfter 是「领取后的累计透露量」（不是秒；见 08 事件字典 hint.deliver.revealAfter）。 */
function previewFor(state: AttemptState, level: 'H2' | 'H3' | 'H4', cost: number): HintPreview {
  const used = state.budget.revealUsed
  const max = state.budget.revealMax
  const allowed = used + cost <= max
  return {
    level,
    cost,
    revealAfter: used + cost,
    allowed,
    reason: allowed ? null : 'budget',
    waitSec: 0,
    previewToken: allowed ? 'mock-preview-token' : null,
    softLanding: allowed ? [] : ['back_to_definition', 'open_lesson', 'park_and_next', 'flag_teacher'],
  }
}

/**
 * 被门槛挡住 / 额度用完的预览：与 B 的 blockedPreview 一致，只有 { allowed:false, reason, waitSec }，
 * 没有 level/cost（契约字段全可选；06 §3.4「不能领取时 preview.allowed=false」）。
 */
function blockedPreview(reason: NonNullable<HintPreview['reason']>, waitSec: number | null = null): HintPreview {
  return { allowed: false, reason, waitSec }
}

/** H0/H1 不计透露量：直接以 note 返回，没有 preview（06 §3.4）。 */
function freeHintNote(level: 'H0' | 'H1', text: string): Note {
  return {
    noteId: mockUuid(),
    kind: 'hint',
    who: level + ' · 追问',
    text,
    lineId: null,
    level,
    cost: 0,
    lessonConceptId: null,
    at: new Date().toISOString(),
  }
}

/** 自由提问的回显（02 §7：署名「你」） */
function studentEchoNote(text: string): Note {
  return {
    noteId: mockUuid(),
    kind: 'student',
    who: '你',
    text: '你问：「' + (text.trim() || '（空）') + '」',
    lineId: null,
    level: null,
    cost: null,
    lessonConceptId: null,
    at: new Date().toISOString(),
  }
}

/** 施压/索要答案的关键词（正式识别在 B 的 #29；这里只让 mock 能走通 pressure 路由）。 */
const PRESSURE_PATTERN = /答案|直接给|老师说|求你了|写给我|给我结果|快点|别问了/

/** 求助：一个入口三种意图 + 自由提问（U9）。mock 只返回结构，路由/施压识别在 B 的 #29。 */
export async function requestHelp(state: AttemptState, intent: HelpIntent, text = ''): Promise<HelpResult> {
  await sleep()
  const next = clone(state)

  // 自由提问：先回显学生原话，再按关键词路由（pressure / concept）
  if (intent === 'free') {
    const echo = studentEchoNote(text)
    const quoted = '「' + (text.trim() || '（空）') + '」'
    if (PRESSURE_PATTERN.test(text)) {
      const note: Note = {
        noteId: mockUuid(),
        kind: 'refusal',
        who: '批注',
        text:
          '你问的是' + quoted +
          '。不提供完整证明或下一步，这一点不会因为任何理由改变。可以先做这个：你要让哪个量小于 $\\varepsilon$？先把它写成最简的样子。',
        lineId: null,
        level: 'H0',
        cost: null,
        lessonConceptId: null,
        at: new Date().toISOString(),
      }
      next.notes = [...next.notes, echo, note]
      return { routed: 'pressure', note, state: next }
    }
    const note: Note = {
      noteId: mockUuid(),
      kind: 'concept',
      who: '助教',
      text:
        '你问的是' + quoted +
        '。先看本题涉及的一个概念：「数列极限」的意思是当 $n$ 足够大以后，$a_n$ 与 $A$ 的距离可以任意小。',
      lineId: null,
      level: 'H0',
      cost: null,
      lessonConceptId: 'seq-limit',
      at: new Date().toISOString(),
    }
    next.notes = [...next.notes, echo, note]
    return { routed: 'concept', note, state: next }
  }

  if (intent === 'stuck') {
    const nextLevel = next.help.nextLevel
    // H0/H1 不计透露量：直接以 note 返回（之前 mock 永远回 preview，把真接口下的免费提示路径掩盖了）
    if (nextLevel === 'H0' || nextLevel === 'H1') {
      const note = freeHintNote(nextLevel, '你打算让哪个量小于 $\\varepsilon$？先把它写成只含 $n$ 的量。')
      next.notes = [...next.notes, note]
      return { routed: 'stuck', note, state: next }
    }
    // 领取过一条提示后要求「再写一行」：blocked preview 只有 reason/waitSec（PR #91 审计 2 的崩溃路径）
    if (next.help.needAttempt) {
      return { routed: 'stuck', preview: blockedPreview('need_attempt', next.help.waitSec ?? null), state: next }
    }
    const level: 'H2' | 'H3' | 'H4' = nextLevel === 'H3' || nextLevel === 'H4' ? nextLevel : 'H2'
    const cost = typeof next.help.nextCost === 'number' ? next.help.nextCost : 0.5
    return { routed: 'stuck', preview: previewFor(next, level, cost), state: next }
  }

  if (intent === 'check_line') {
    const note: Note = {
      noteId: mockUuid(),
      kind: 'annotation',
      who: '批注',
      text: '你这一行的依据写的是哪条？试着把「由什么得到」写清楚。',
      lineId: next.steps?.lines?.[next.steps.lines.length - 1]?.lineId ?? null,
      level: null,
      cost: null,
      lessonConceptId: null,
      at: new Date().toISOString(),
    }
    next.notes = [...next.notes, note]
    return { routed: 'check_line', note, state: next }
  }
  // concept：mock 给一张概念卡片（正式实现由 B 的 /help 返回；#26 微课再展开）
  const conceptNote: Note = {
    noteId: mockUuid(),
    kind: 'concept',
    who: '助教',
    text: '「数列极限」的意思是：当 $n$ 足够大以后，$a_n$ 与 $A$ 的距离可以任意小。这里的关键是先把 $|a_n-A|$ 写成一个只含 $n$ 的量。',
    lineId: null,
    level: 'H0',
    cost: null,
    lessonConceptId: 'seq-limit',
    at: new Date().toISOString(),
  }
  next.notes = [...next.notes, conceptNote]
  return { routed: 'concept', note: conceptNote, state: next }
}

/** 领取预览卡里的提示（mock：记入 notes 并累加透露量）。HintPreview 字段可选，缺 cost/level 也不崩。 */
export async function claimHint(state: AttemptState, preview: HintPreview): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  const cost = typeof preview.cost === 'number' && Number.isFinite(preview.cost) ? preview.cost : 0
  const level = preview.level ?? 'H2'
  next.stateVersion += 1
  next.budget.revealUsed = Math.min(next.budget.revealMax, next.budget.revealUsed + cost)
  next.notes = [
    ...next.notes,
    {
      noteId: mockUuid(),
      kind: 'hint',
      who: level + ' · 透露 ' + cost,
      text: '把 $|a_n-3|$ 单独算出来之后，先看它能不能用一个更简单的、只含 $n$ 的量控制住。',
      lineId: next.steps?.lines?.[next.steps.lines.length - 1]?.lineId ?? null,
      level,
      cost,
      lessonConceptId: null,
      at: new Date().toISOString(),
    },
  ]
  if (next.budget.revealUsed >= next.budget.revealMax) {
    next.help = { ...next.help, exhausted: true, stuckOffer: true }
  } else {
    // 领取后要「再写一行」并停留 waitSec 才能继续（01 §4）：下一次 /help 返回 blocked preview
    next.help = {
      ...next.help,
      needAttempt: true,
      waitSec: 20,
      nextLevel: level === 'H2' ? 'H3' : 'H4',
      nextCost: 1,
      exhausted: false,
    }
  }
  next.serverTime = new Date().toISOString()
  return next
}

/** 手写识别（B 的 #21 未完成，mock 返回两路不一致的示例） */
export async function recognizeInk(_inkJson: string): Promise<Recognition> {
  await sleep(600)
  return clone(mockRecognition)
}

let seq = 0
function mockUuid(): string {
  seq += 1
  const n = String(seq).padStart(12, '0')
  return '00000000-0000-4000-8000-' + n
}
