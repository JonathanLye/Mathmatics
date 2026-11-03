/**
 * 学生端 API 客户端（issue #24：接真实接口）。
 *
 * - 契约真源：`packages/contracts/openapi.yaml`（servers: /api/v1）。真实模式下本文件按契约调接口；
 *   传输细节（Cookie、CSRF 头、If-Match、Idempotency-Key、错误分类）在 `api/http.ts`。
 * - USE_MOCK 是开发/离线 Demo 开关：默认开；`VITE_USE_MOCK=false` 或 `setMockMode(false)` 走真实接口。
 * - 写请求：带 If-Match（= 当前 state.stateVersion）与 Idempotency-Key；同一逻辑提交的重试复用同一个键
 *   （键按「操作 + 作答 + 请求体」缓存，见 keyFor）。
 * - 409 STATE_STALE：不重放业务逻辑，直接把 detail.state 作为最新状态返回，由页面覆盖本地 state。
 * - ASSIGNMENT_CLOSED 等终态错误原样抛出（ApiError.terminal），由页面提示、不重试。
 * - 前端永远不做判定：这里只做「请求 → 服务端 state」的搬运。
 */

import {
  ApiError,
  createHttpClient,
  errorMessage,
  isApiError,
  isUuid,
  newIdempotencyKey,
  type FetchLike,
  type HttpClient,
  type HttpMethod,
} from './http'
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
  AssignmentCardView,
  ConsentChoices,
  ConsentDoc,
  HelpIntent,
  HelpResult,
  HintPreview,
  InputMeta,
  InputProvenance,
  LayerId,
  LessonView,
  LineDraft,
  MeView,
  Note,
  NotebookView,
  ProofLine,
  Recognition,
  StudentHomeView,
} from '@/types/attempt'

export { ApiError, errorMessage, isApiError }

const ENV_USE_MOCK = import.meta.env?.VITE_USE_MOCK
const DEFAULT_USE_MOCK = ENV_USE_MOCK === undefined ? true : ENV_USE_MOCK !== 'false'

let USE_MOCK = DEFAULT_USE_MOCK
let activeHttp: HttpClient = createHttpClient()

const LATENCY = 160
const sleep = (ms = LATENCY) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** 弱网重试：只重试可重试错误（NETWORK / 429 / 5xx），最多两次；同一请求的幂等键由调用方固定。 */
async function withRetry<T>(action: () => Promise<T>, maxAttempts = 2): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      if (attempt < maxAttempts && isApiError(error) && error.retryable) {
        await sleep(400)
        continue
      }
      throw error
    }
  }
}

/** 是否 mock 模式；页面据此决定显示 MockSwitcher / 提示文案。 */
export function isMockMode(): boolean {
  return USE_MOCK
}

/** 开发/演示时手动切换；#24 起页面也可以在真实模式运行。 */
export function setMockMode(value: boolean): void {
  USE_MOCK = value
}

export interface TestClientOptions {
  fetchImpl?: FetchLike
  base?: string
  mock?: boolean
}

/** 测试注入：假 fetch + 强制 mock/真实模式。 */
export function configureClientForTests(options: TestClientOptions = {}): void {
  activeHttp = createHttpClient({ fetchImpl: options.fetchImpl, base: options.base })
  if (options.mock !== undefined) USE_MOCK = options.mock
  idempotencyKeys.clear()
}

/** 测试隔离：恢复默认（mock 开、默认 http、清空幂等键缓存）。 */
export function __resetClientForTests(): void {
  USE_MOCK = DEFAULT_USE_MOCK
  activeHttp = createHttpClient()
  idempotencyKeys.clear()
  cachedDeviceId = null
  lastStateStaleAt = 0
}

const idempotencyKeys = new Map<string, string>()

function keyFor(scope: string, attemptId: string, body: unknown): string {
  const cacheKey = `${scope}|${attemptId}|${JSON.stringify(body)}`
  const existing = idempotencyKeys.get(cacheKey)
  if (existing !== undefined) return existing
  const key = newIdempotencyKey()
  idempotencyKeys.set(cacheKey, key)
  if (idempotencyKeys.size > 200) {
    const oldest = idempotencyKeys.keys().next().value
    if (oldest !== undefined) idempotencyKeys.delete(oldest)
  }
  return key
}

let lastStateStaleAt = 0
/** 最近一次写请求是否收到过 409 STATE_STALE（页面可提示「已同步到最新状态」）。 */
export function consumeStateStaleFlag(): boolean {
  const stale = lastStateStaleAt > 0
  lastStateStaleAt = 0
  return stale
}

function isAttemptState(value: unknown): value is AttemptState {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<AttemptState>
  return typeof candidate.attemptId === 'string' && typeof candidate.stateVersion === 'number'
}

interface WriteOptions {
  /** 调用方若重试，传入同一个键；不传则按请求体缓存生成。 */
  idempotencyKey?: string
  /** 重试时必须复用同一个 draftId（InputMeta.draftId）。 */
  draftId?: string
}

let draftSeq = 0
function newDraftId(): string {
  draftSeq += 1
  return `00000000-0000-4000-8000-${String(draftSeq).padStart(12, '0')}`
}

function newUuid(): string {
  return newIdempotencyKey()
}

function inputMeta(provenance: InputProvenance, draftId: string): InputMeta {
  return { provenance, draftId }
}

async function writeState(
  path: string,
  body: unknown,
  options: { ifMatch?: number; idempotencyKey: string },
): Promise<AttemptState> {
  return writeStateWith('POST', path, body, options)
}

/** 同 writeState，但支持 PATCH/DELETE（#12/#47 的行改写/删除走这里）。 */
async function writeStateWith(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: { ifMatch?: number; idempotencyKey: string },
): Promise<AttemptState> {
  try {
    const result = await withRetry(() =>
      activeHttp.request<{ state: AttemptState }>(path, {
        method,
        body,
        ifMatch: options.ifMatch,
        idempotencyKey: options.idempotencyKey,
      }),
    )
    if (!isAttemptState(result.data?.state)) {
      throw new ApiError({ status: result.status, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
    }
    return result.data.state
  } catch (error) {
    if (isApiError(error) && error.code === 'STATE_STALE' && isAttemptState(error.staleState)) {
      lastStateStaleAt = Date.now()
      return error.staleState
    }
    throw error
  }
}

const DEVICE_STORAGE_KEY = 'pg.deviceId'
let cachedDeviceId: string | null = null

interface StorageLike {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

function safeStorage(): StorageLike | null {
  const globalWithStorage = globalThis as {
    uni?: { getStorageSync?: (key: string) => unknown; setStorageSync?: (key: string, value: unknown) => void }
    localStorage?: Storage
  }
  try {
    const uniApi = globalWithStorage.uni
    if (typeof uniApi?.getStorageSync === 'function' && typeof uniApi.setStorageSync === 'function') {
      return { get: (key) => uniApi.getStorageSync?.(key), set: (key, value) => uniApi.setStorageSync?.(key, value) }
    }
    if (globalWithStorage.localStorage) {
      const storage = globalWithStorage.localStorage
      return { get: (key) => storage.getItem(key), set: (key, value) => storage.setItem(key, String(value)) }
    }
  } catch {
    // 隐私模式/SSR 下 storage 不可用：退回内存，不影响本次会话
  }
  return null
}

export function getDeviceId(): string {
  if (cachedDeviceId !== null) return cachedDeviceId
  const storage = safeStorage()
  const stored = storage?.get(DEVICE_STORAGE_KEY)
  if (typeof stored === 'string' && isUuid(stored)) {
    cachedDeviceId = stored
    return stored
  }
  const id = newUuid()
  try {
    storage?.set(DEVICE_STORAGE_KEY, id)
  } catch {
    // 写不进去就用内存值
  }
  cachedDeviceId = id
  return id
}

export interface HomeItem {
  id: string
  title: string
  layerTitle: string
  mock?: MockKey
  assignmentId?: string
  attemptId?: string | null
}

export interface HomeData {
  greeting: string
  weeklyOwn: number
  weeklyTotal: number
  ongoing: HomeItem[]
  pending: HomeItem[]
  completed: Array<HomeItem & { independence: number | null }>
}

export const mockHome: HomeData = {
  greeting: '你好，S-7K2Q9M',
  weeklyOwn: 3,
  weeklyTotal: 4,
  ongoing: [{ id: 'attempt-epsN', title: '数列极限 · ε-N', layerTitle: '第 3 层 · 构造与推导', mock: 'l3-active' }],
  pending: [{ id: 'attempt-series', title: '交错级数 · 收敛性', layerTitle: '第 1 层 · 记忆核验', mock: 'l1-active' }],
  completed: [{ id: 'attempt-epsN-done', title: '数列极限 · ε-N', layerTitle: '已完成', independence: 0.75 }],
}

const LAYER_LABELS: Record<LayerId, string> = {
  L1: '第 1 层 · 记忆核验',
  L2: '第 2 层 · 证明骨架',
  L3: '第 3 层 · 构造与推导',
  L4: '第 4 层 · 自检',
  L5: '第 5 层 · 迁移题',
  L6: '第 6 层 · 总结',
}

function layerTitleOf(card: AssignmentCardView): string {
  if (card.currentLayer !== undefined && card.currentLayer !== null) return LAYER_LABELS[card.currentLayer]
  if (card.status === 'scheduled') return '未开始'
  if (card.status === 'closed') return '已关闭'
  if (card.attemptStatus === 'completed') return '已完成'
  return '待开始'
}

function toHomeData(home: StudentHomeView, meView: MeView): HomeData {
  const toItem = (card: AssignmentCardView): HomeItem => ({
    id: card.attemptId ?? card.assignmentId,
    title: card.title,
    layerTitle: layerTitleOf(card),
    assignmentId: card.assignmentId,
    attemptId: card.attemptId ?? null,
  })
  return {
    greeting: `你好，${meView.displayName ?? meView.anonCode}`,
    weeklyOwn: home.week?.keysOwn ?? 0,
    weeklyTotal: home.week?.keysTotal ?? 0,
    ongoing: home.inProgress.map(toItem),
    pending: home.todo.map(toItem),
    completed: home.done.map((card) => ({ ...toItem(card), independence: null })),
  }
}

export async function fetchHome(): Promise<HomeData> {
  if (USE_MOCK) {
  await sleep()
  return clone(mockHome)
  }
  const [home, meView] = await Promise.all([activeHttp.get<StudentHomeView>('/student/home'), getMe()])
  return toHomeData(home, meView)
}

export const mockMe: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-7K2Q9M',
  displayName: null,
  classes: [],
  // mock 演示仍走「登录 → 同意页」流程；真实值以服务端 Me 为准。
  consentRequired: true,
  features: {},
}

/** 服务端 CONSENT_SECTIONS 的镜像（mock/fallback 渲染用；真实模式以 GET /consents 为准）。 */
export const MOCK_CONSENT_SECTIONS: ConsentDoc['sections'] = [
  {
    key: 'service',
    title: '服务所需处理',
    body: '为提供练习功能，需要处理你的学号、作答内容和过程记录。',
    required: true,
  },
  {
    key: 'crossBorderHosting',
    title: '数据存储在中国香港服务器',
    body: '你的数据存储在中国香港的服务器上；不同意则无法使用本版本。',
    required: true,
  },
  {
    key: 'crossBorderModel',
    title: '境外决策模型（可选）',
    body: '去掉身份信息后的作答文本会发送给境外的 Jev 决策模型，用于判断你写的是哪一步。本版本中它只做对比记录，不同意不影响任何功能。',
    required: false,
  },
  {
    key: 'monitoring',
    title: '过程监测',
    body: '为了让老师了解你的练习过程，系统会记录：你写下的每一行（包括手写笔迹、识别和修改）、你什么时候求助、看了哪些提示、在每一层停留多久，以及你离开页面的次数和时长。老师可以查看你的作答过程。这些记录只用于教学和（在你同意的情况下）匿名的教学研究，不用于评分处罚。测验模式下，离开页面过多会锁定本题，需要老师解锁。',
    required: true,
  },
  {
    key: 'research',
    title: '教研使用（可选）',
    body: '匿名化后用于教学研究与论文；不同意不影响使用。撤回后，你的数据会从研究导出中排除。',
    required: false,
  },
]

export const mockConsentDoc: ConsentDoc = {
  version: 'p0-v1',
  sections: MOCK_CONSENT_SECTIONS,
  signed: null,
}

/** POST /auth/student/login：邀请码 + 学号 + deviceId，返回 Me（响应设置 HttpOnly Cookie）。 */
export async function login(inviteCode: string, studentNo: string, deviceId = getDeviceId()): Promise<MeView> {
  if (USE_MOCK) {
    await sleep()
    return clone(mockMe)
  }
  const result = await activeHttp.post<MeView>('/auth/student/login', { inviteCode, studentNo, deviceId })
  return result.data
}

/** POST /auth/logout：作废服务端会话（204）。 */
export async function logout(): Promise<void> {
  if (USE_MOCK) {
    await sleep()
    return
  }
  await activeHttp.post<void>('/auth/logout')
}

/** GET /me：断线重连/刷新时恢复会话。 */
export async function getMe(): Promise<MeView> {
  if (USE_MOCK) {
    await sleep()
    return clone(mockMe)
  }
  return activeHttp.get<MeView>('/me')
}

/** GET /consents：当前同意书文本 + 本人最近一次签署。 */
export async function getConsents(): Promise<ConsentDoc> {
  if (USE_MOCK) {
    await sleep()
    return clone(mockConsentDoc)
  }
  return activeHttp.get<ConsentDoc>('/consents')
}

/** POST /consents：签署（五个键都必须提交，服务端只接受契约定义的键）。 */
export async function submitConsents(version: string, items: ConsentChoices): Promise<MeView> {
  if (USE_MOCK) {
    await sleep()
    return clone(mockMe)
  }
  const result = await activeHttp.post<MeView>('/consents', { version, items })
  return result.data
}

/** POST /student/assignments/{assignmentId}/attempt：开始或恢复（服务端幂等：已有作答则返回它）。 */
export async function startAttempt(assignmentId: string, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) return fetchAttempt()
  const body = { assignmentId }
  const result = await withRetry(() =>
    activeHttp.post<{ state: AttemptState }>(
      `/student/assignments/${encodeURIComponent(assignmentId)}/attempt`,
      undefined,
      { idempotencyKey: options.idempotencyKey ?? keyFor('start', assignmentId, body) },
    ),
  )
  if (!isAttemptState(result.data?.state)) {
    throw new ApiError({ status: result.status, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
  }
  return result.data.state
}

/** GET /attempts/{attemptId}：断线重连、切回前台时调用。 */
export async function getAttempt(attemptId: string): Promise<AttemptState> {
  if (USE_MOCK) return fetchAttempt()
  const result = await withRetry(() => activeHttp.get<{ state: AttemptState }>(`/attempts/${encodeURIComponent(attemptId)}`))
  if (!isAttemptState(result.state)) {
    throw new ApiError({ status: 200, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
  }
  return result.state
}

/** POST /attempts/{attemptId}/definition：第 1 层提交定义。 */
export async function submitDef(state: AttemptState, text: string, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  next.def = { ...(next.def ?? {}), submissions: (next.def?.submissions ?? 0) + 1, last: text, lessonSuggested: false }
  next.layers = next.layers.map((l) => (l.layer === 'L1' ? { ...l, status: 'done' as const } : l.layer === 'L2' ? { ...l, status: 'active' as const } : l))
  next.currentLayer = 'L2'
  next.serverTime = new Date().toISOString()
  return next
  }
  const body = { text, input: inputMeta('keyboard', options.draftId ?? newDraftId()) }
  return writeState(`/attempts/${state.attemptId}/definition`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('definition', state.attemptId, body),
  })
}

/** POST /attempts/{attemptId}/framework：第 2 层提交证明骨架。 */
export async function submitFramework(state: AttemptState, text: string, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  const body = { text, input: inputMeta('keyboard', options.draftId ?? newDraftId()) }
  return writeState(`/attempts/${state.attemptId}/framework`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('framework', state.attemptId, body),
  })
}

/** POST /attempts/{attemptId}/framework/template：第 2 层看通用骨架（不计透露量）。 */
export async function viewFrameTemplate(state: AttemptState, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
  await sleep()
  const next = clone(state)
  // 只有第 2 层能看通用骨架；其他层原样返回（真实接口返回 409 WRONG_LAYER）。
  if (next.currentLayer !== 'L2') return next
  next.stateVersion += 1
  next.frame = { ...(next.frame ?? {}), templateShown: true }
  next.serverTime = new Date().toISOString()
  return next
  }
  return writeState(`/attempts/${state.attemptId}/framework/template`, undefined, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('framework-template', state.attemptId, {}),
  })
}

/** POST /attempts/{attemptId}/lines：第 3 层加入一行。 */
export async function addLine(state: AttemptState, draft: LineDraft, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  const body = {
    statement: draft.statement,
    ...(draft.justification ? { justification: draft.justification } : {}),
    input: { provenance: draft.input.provenance, draftId: options.draftId ?? draft.input.draftId ?? newDraftId() },
  }
  return writeState(`/attempts/${state.attemptId}/lines`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('lines', state.attemptId, body),
  })
}

/** POST /attempts/{attemptId}/finish：第 3 层「写完了」。 */
export async function finishSteps(state: AttemptState, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  return writeState(`/attempts/${state.attemptId}/finish`, undefined, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('finish', state.attemptId, {}),
  })
}

/** POST /attempts/{attemptId}/selfcheck/{itemId}：第 4 层自检。 */
export async function answerSelfcheck(
  state: AttemptState,
  itemId: string,
  text: string,
  options: WriteOptions = {},
): Promise<AttemptState> {
  if (USE_MOCK) {
    await sleep()
    const next = clone(state)
    next.stateVersion += 1
    next.serverTime = new Date().toISOString()
    return next
  }
  const body = { text, input: inputMeta('keyboard', options.draftId ?? newDraftId()) }
  return writeState(`/attempts/${state.attemptId}/selfcheck/${encodeURIComponent(itemId)}`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('selfcheck', state.attemptId, body),
  })
}

/** POST /attempts/{attemptId}/transfer：第 5 层开始迁移题（返回子作答 state）。 */
export async function startTransfer(state: AttemptState, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  return writeState(`/attempts/${state.attemptId}/transfer`, undefined, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('transfer', state.attemptId, {}),
  })
}

/** POST /attempts/{attemptId}/summary：第 6 层提交五问总结（answers 必须 5 条）。 */
export async function submitSummary(state: AttemptState, answers: string[], options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  const body = { answers, input: inputMeta('keyboard', options.draftId ?? newDraftId()) }
  return writeState(`/attempts/${state.attemptId}/summary`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('summary', state.attemptId, body),
  })
}

/** POST /attempts/{attemptId}/park：先搁置本题。 */
export async function parkAttempt(state: AttemptState, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
    await sleep()
    const next = clone(state)
    next.stateVersion += 1
    next.status = 'parked'
    next.serverTime = new Date().toISOString()
    return next
  }
  return writeState(`/attempts/${state.attemptId}/park`, undefined, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('park', state.attemptId, {}),
  })
}

/** POST /attempts/{attemptId}/layers/{layer}/skip：跳过某层（跳过规则由服务端判定）。 */
export async function skipLayer(state: AttemptState, layer: LayerId, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  return writeState(`/attempts/${state.attemptId}/layers/${layer}/skip`, undefined, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? keyFor('skip', state.attemptId, { layer }),
  })
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

/** POST /attempts/{attemptId}/help：一个入口三种意图 + 自由提问。 */
export async function requestHelp(
  state: AttemptState,
  intent: HelpIntent,
  text = '',
  lineId?: string,
  options: WriteOptions = {},
): Promise<HelpResult> {
  if (USE_MOCK) {
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

  const latestLineId = lineId ?? state.steps?.lines?.[state.steps.lines.length - 1]?.lineId ?? undefined
  const body = {
    intent,
    ...(intent === 'free' ? { text } : {}),
    ...(intent === 'check_line' && latestLineId ? { lineId: latestLineId } : {}),
  }
  const result = await withRetry(() =>
    activeHttp.post<HelpResult>(`/attempts/${state.attemptId}/help`, body, {
      idempotencyKey: options.idempotencyKey ?? keyFor('help', state.attemptId, body),
    }),
  )
  return result.data
}

/** POST /attempts/{attemptId}/hints/claim：领取 H2–H4 提示（必须带 /help 的 previewToken）。 */
export async function claimHint(state: AttemptState, preview: HintPreview, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
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
  const previewToken = preview.previewToken
  if (!previewToken) {
    throw new ApiError({ status: 0, code: 'HINT_PREVIEW_EXPIRED', message: '提示预览已失效，请重新求助' })
  }
  const body = { previewToken }
  const result = await withRetry(() =>
    activeHttp.post<HelpResult>(`/attempts/${state.attemptId}/hints/claim`, body, {
      idempotencyKey: options.idempotencyKey ?? keyFor('claim', state.attemptId, body),
    }),
  )
  if (!isAttemptState(result.data?.state)) {
    throw new ApiError({ status: result.status, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
  }
  return result.data.state
}

export async function fetchAttempt(mock: MockKey = DEFAULT_MOCK): Promise<AttemptState> {
  await sleep()
  return createMockState(mock)
}

/** 手写识别（B 的 #21/#74 未完成：真实模式下没有可调接口，保留 mock）。 */
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

/**
 * 第 1–2 层：取微课（GET /attempts/{id}/lesson/{conceptId}）。
 * mock 返回概念库的预写微课（seed concepts.json 的 seq-limit）；真实接口 #24 按 conceptId 下发。
 * 微课文本已由服务端过闸门，前端只渲染。
 */
export async function fetchLesson(state: AttemptState, conceptId?: string): Promise<LessonView> {
  const topic = conceptId ?? state.def?.conceptId ?? mockLesson.conceptId
  if (USE_MOCK) {
    await sleep()
    return clone({ ...mockLesson, conceptId: topic })
  }
  return withRetry(() =>
    activeHttp.get<LessonView>(`/attempts/${state.attemptId}/lesson/${encodeURIComponent(topic)}`),
  )
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
  if (!USE_MOCK) {
    const body = { text, input: inputMeta('keyboard', newDraftId()) }
    return writeState(`/attempts/${state.attemptId}/selfcheck/${encodeURIComponent(itemId)}`, body, {
      ifMatch: state.stateVersion,
      idempotencyKey: keyFor('selfcheck', state.attemptId, body),
    })
  }
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
 * 第 5 层：加入一行（POST /attempts/{childAttemptId}/lines）。
 * mock：追加行 + 近似归类 + 行内批注（依据没写/衔接/关系问句），并重算「写完了」判定。
 * TODO(#24)：真实接口由引擎归类，批注来自题目包预写文本。
 */
export async function addTransferLine(state: AttemptState, draft: LineDraft): Promise<AttemptState> {
  if (!USE_MOCK) {
    const body = {
      statement: draft.statement,
      ...(draft.justification ? { justification: draft.justification } : {}),
      input: { provenance: draft.input.provenance, draftId: draft.input.draftId ?? newDraftId() },
    }
    return writeState(`/attempts/${state.attemptId}/lines`, body, {
      ifMatch: state.stateVersion,
      idempotencyKey: keyFor('addLine', state.attemptId, body),
    })
  }
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
  if (!USE_MOCK) {
    const body = {
      statement: draft.statement,
      ...(draft.justification ? { justification: draft.justification } : {}),
      input: { provenance: draft.input.provenance, draftId: draft.input.draftId ?? newDraftId() },
    }
    return writeStateWith('PATCH', `/attempts/${state.attemptId}/lines/${encodeURIComponent(lineId)}`, body, {
      ifMatch: state.stateVersion,
      idempotencyKey: keyFor('editLine', state.attemptId, body),
    })
  }
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
  if (!USE_MOCK) {
    return writeStateWith('DELETE', `/attempts/${state.attemptId}/lines/${encodeURIComponent(lineId)}`, undefined, {
      ifMatch: state.stateVersion,
      idempotencyKey: keyFor('deleteLine', state.attemptId, { lineId }),
    })
  }
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
  if (!USE_MOCK) {
    return writeState(`/attempts/${state.attemptId}/finish`, undefined, {
      ifMatch: state.stateVersion,
      idempotencyKey: keyFor('finish', state.attemptId, {}),
    })
  }
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
  if (!USE_MOCK) {
    // 子作答完成后服务端已推进父作答：这里按父 attemptId 重新拉最新 state（openapi GET /attempts/{id}）。
    return getAttempt(parent.attemptId)
  }
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

/** 证明本（GET /student/notebook）：mock 返回已完成作业列表；cards[].mock 仅 mock 阶段用来「回到该题」。 */
export async function fetchNotebook(): Promise<NotebookView> {
  if (!USE_MOCK) return activeHttp.get<NotebookView>('/student/notebook')
  await sleep()
  return clone(mockNotebook)
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

