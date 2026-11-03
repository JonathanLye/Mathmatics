/**
 * 学生端 API 客户端（P0：mock 适配层）。
 *
 * - 契约真源：10-开发文档/contracts/openapi.yaml；#18/#19（B）未完成前，本文件用 mock reducer 驱动 UI。
 * - 真实接口接入（issue #24）：把 USE_MOCK 换成 false 并实现 fetch 分支；写请求需带
 *   Idempotency-Key / If-Match，409 STATE_STALE 用响应 state 覆盖 —— 不在本单范围。
 * - 前端永远不做判定：这里只模拟「服务端会返回什么 state」，不实现层/预算/门槛逻辑。
 */
import { createMockState, DEFAULT_MOCK, mockRecognition, type MockKey } from '@/mocks/attemptStates'
import type { AttemptState, HelpIntent, HelpResult, HintPreview, LayerId, LineDraft, Recognition } from '@/types/attempt'

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
  if (nextLayer) next.currentLayer = nextLayer.layer
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

/** 第 3 层：写完了（mock 推进到 L4） */
export async function finishSteps(state: AttemptState): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.layers = next.layers.map((l) =>
    l.layer === 'L3' ? { ...l, status: 'done' as const } : l.layer === 'L4' ? { ...l, status: 'active' as const } : l,
  )
  next.currentLayer = 'L4'
  next.serverTime = new Date().toISOString()
  return next
}

function previewFor(state: AttemptState, level: 'H2' | 'H3' | 'H4', cost: number): HintPreview {
  const used = state.budget.revealUsed
  const max = state.budget.revealMax
  const allowed = used + cost <= max
  return {
    level,
    cost,
    revealAfter: 20,
    allowed,
    reason: allowed ? null : 'budget',
    waitSec: 0,
    previewToken: allowed ? 'mock-preview-token' : null,
    softLanding: ['back_to_definition', 'open_lesson', 'park_and_next', 'flag_teacher'],
  }
}

/** 求助：一个入口三种意图（U9）。mock 只返回结构，路由/施压识别在 B 的 #29。 */
export async function requestHelp(state: AttemptState, intent: HelpIntent, text = ''): Promise<HelpResult> {
  await sleep()
  const next = clone(state)
  if (intent === 'stuck') {
    const preview = previewFor(next, (next.help.nextLevel as 'H2' | 'H3' | 'H4') ?? 'H2', next.help.nextCost ?? 0.5)
    return { routed: 'stuck', preview, state: next }
  }
  if (intent === 'check_line') {
    next.notes = [
      ...next.notes,
      {
        noteId: mockUuid(),
        kind: 'annotation',
        who: '批注',
        text: '你这一行的依据写的是哪条？试着把「由什么得到」写清楚。',
        lineId: next.steps?.lines?.[next.steps.lines.length - 1]?.lineId ?? null,
        level: null,
        cost: null,
        lessonConceptId: null,
        at: new Date().toISOString(),
      },
    ]
    return { routed: 'check_line', state: next }
  }
  // concept：mock 给一张概念卡片（正式实现由 B 的 /help 返回；#26 微课再展开）
  next.notes = [
    ...next.notes,
    {
      noteId: mockUuid(),
      kind: 'concept',
      who: '助教',
      text: '「数列极限」的意思是：当 $n$ 足够大以后，$a_n$ 与 $A$ 的距离可以任意小。这里的关键是先把 $|a_n-A|$ 写成一个只含 $n$ 的量。',
      lineId: null,
      level: 'H0',
      cost: null,
      lessonConceptId: 'seq-limit',
      at: new Date().toISOString(),
    },
  ]
  return { routed: 'concept', state: next }
}

/** 领取预览卡里的提示（mock：把 H2 记入 notes 并累加透露量） */
export async function claimHint(state: AttemptState, preview: HintPreview): Promise<AttemptState> {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.budget.revealUsed = Math.min(next.budget.revealMax, next.budget.revealUsed + preview.cost)
  next.notes = [
    ...next.notes,
    {
      noteId: mockUuid(),
      kind: 'hint',
      who: preview.level + ' · 透露 ' + preview.cost,
      text: '把 $|a_n-3|$ 单独算出来之后，先看它能不能用一个更简单的、只含 $n$ 的量控制住。',
      lineId: next.steps?.lines?.[next.steps.lines.length - 1]?.lineId ?? null,
      level: preview.level,
      cost: preview.cost,
      lessonConceptId: null,
      at: new Date().toISOString(),
    },
  ]
  if (next.budget.revealUsed >= next.budget.revealMax) next.help = { ...next.help, exhausted: true, stuckOffer: true }
  next.serverTime = new Date().toISOString()
  return next
}

/** 手写识别（B 的 #21 未完成，mock 返回两路不一致的示例） */
export async function recognizeInk(_inkJson: string): Promise<Recognition> {
  await sleep(600)
  return clone(mockRecognition) as Recognition
}

let seq = 0
function mockUuid(): string {
  seq += 1
  const n = String(seq).padStart(12, '0')
  return '00000000-0000-4000-8000-' + n
}
