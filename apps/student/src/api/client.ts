/**
 * 学生端 API 客户端（issue #24：接真实接口）。
 *
 * - 契约真源：`packages/contracts/openapi.yaml`（servers: /api/v1）。真实模式下本文件按契约调接口；
 *   传输细节（Cookie、X-Pg-App 端标识、CSRF 头、If-Match、Idempotency-Key、错误分类、登录失效通知）在 `api/http.ts`。
 * - USE_MOCK 是开发/离线 Demo 开关：默认开；`VITE_USE_MOCK=false` 或 `setMockMode(false)` 走真实接口。
 * - 写请求：带 If-Match（= 当前 state.stateVersion）与 Idempotency-Key；键在「每个用户动作入口」生成一次，
 *   只在同一次调用的 withRetry 重试之间复用，动作结束即丢弃（不同动作即使请求体相同也必须是新键）。
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
  withRetry,
  type FetchLike,
  type HttpClient,
  type HttpMethod,
} from './http'
import { createMockState, DEFAULT_MOCK, mockPhotoRecognition, mockRecognition, type MockKey } from '@/mocks/attemptStates'
import { ImageCompressError } from '@/utils/imageCompress'
import { AGE_BAND_LOCKED_MESSAGE, ageBandFromQuery } from '@/auth/ageBand'
import {
  mockGeneratedLesson,
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
import { COPY, layerLabel, studentName } from '@/copy'
import {
  mockListPractice,
  mockRandomPractice,
  mockReveal,
  mockReview,
  mockSolution,
  mockStartProblem,
  mockStudentPath,
} from '@/mocks/pathMock'
import type {
  AgeBand,
  AttemptState,
  AssignmentCardView,
  ConsentChoices,
  ConsentDoc,
  ConsentSection,
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
  MistakesView,
  NotebookView,
  ProgressView,
  PublishedReview,
  RewardsView,
  SettingsPatch,
  SettingsView,
  FeedbackKind,
  ProofLine,
  Recognition,
  StudentHomeView,
} from '@/types/attempt'
import type {
  DifficultyBand,
  PracticeItem,
  PracticeList,
  PracticeQuery,
  PracticeSolution,
  StudentPath,
} from '@/types/path'

export { ApiError, errorMessage, isApiError }

const ENV_USE_MOCK = import.meta.env?.VITE_USE_MOCK
const DEFAULT_USE_MOCK = ENV_USE_MOCK === undefined ? true : ENV_USE_MOCK !== 'false'

let USE_MOCK = DEFAULT_USE_MOCK
let activeHttp: HttpClient = createHttpClient()

/**
 * mock 的年龄分档（#145）：
 * - 默认 ge18，不阻塞既有 mock 演示/e2e 流程；
 * - ?ageBand=null|lt14|14to17|ge18（H5 hash 查询）覆盖初始值，供年龄分档 e2e；
 * - 年龄选择页提交后写入 override（只能设置一次；再次提交按契约 409 AGE_BAND_LOCKED）。
 */
const DEFAULT_MOCK_AGE_BAND: AgeBand = 'ge18'
const MOCK_AGE_BAND_UNSET = 'unset'
let mockAgeBandOverride: AgeBand | null | typeof MOCK_AGE_BAND_UNSET = MOCK_AGE_BAND_UNSET

/** 从当前 H5 hash 的查询串读 ?ageBand=（null/lt14/14to17/ge18）；无参数/非法 → undefined。 */
function readAgeBandFromUrl(): AgeBand | null | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined
  const hash = window.location.hash || ''
  const queryIndex = hash.indexOf('?')
  if (queryIndex === -1) return undefined
  return ageBandFromQuery(hash.slice(queryIndex + 1))
}

/**
 * mock 模式下的当前年龄分档：override 优先，其次 URL ?ageBand=，最后默认 ge18。
 * URL 覆盖值会**固定**到 override：守卫重定向到 /pages/age/index 后 hash 不再带该参数，
 * 若不固定会退回默认 ge18，e2e「null → 选择」就会看到「已记录」而不是选择页。
 */
function resolveMockAgeBand(): AgeBand | null {
  if (mockAgeBandOverride === MOCK_AGE_BAND_UNSET) {
    const fromUrl = readAgeBandFromUrl()
    if (fromUrl !== undefined) mockAgeBandOverride = fromUrl
  }
  if (mockAgeBandOverride !== MOCK_AGE_BAND_UNSET) return mockAgeBandOverride
  return DEFAULT_MOCK_AGE_BAND
}

/** mock Me（带当前年龄分档）。login/getMe 在 mock 模式都走这里，保证年龄守卫能读到 ageBand。 */
export function mockMeView(): MeView {
  return { ...clone(mockMe), ageBand: resolveMockAgeBand() }
}

/** 测试隔离：把 mock 年龄分档恢复为「未 override」（读取 URL/默认 ge18）。 */
export function __resetMockAgeBandForTests(): void {
  mockAgeBandOverride = MOCK_AGE_BAND_UNSET
}

/** mock 模式默认年龄分档（ge18，不阻塞既有流程）。 */
export const MOCK_DEFAULT_AGE_BAND: AgeBand = DEFAULT_MOCK_AGE_BAND

/** 测试隔离：直接设定 mock 年龄分档（null = 尚未选择）。 */
export function __setMockAgeBandForTests(value: AgeBand | null): void {
  mockAgeBandOverride = value
}

const LATENCY = 160
const sleep = (ms = LATENCY) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// 弱网重试（withRetry）在 http.ts 里统一实现（指数退避，只重试 NETWORK/429/5xx）；
// 同一动作的重试必须复用同一个 Idempotency-Key / If-Match，由这里的 action 闭包固定。

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
}

/** 测试隔离：恢复默认（mock 开、默认 http）。 */
export function __resetClientForTests(): void {
  USE_MOCK = DEFAULT_USE_MOCK
  activeHttp = createHttpClient()
  cachedDeviceId = null
  lastStateStaleAt = 0
  mockAgeBandOverride = MOCK_AGE_BAND_UNSET
}

/**
 * 幂等键约定（IETF draft-ietf-httpapi-idempotency-key-header）：
 * - 每个用户动作在 API 入口生成一个 uuid，只在同一次调用的 withRetry 重试之间复用；
 * - 动作结束丢弃；不同动作即使请求体完全相同，也必须是不同的键
 *   （服务端对同键 24 小时内重放首次响应，跨动作复用会把旧响应发给下一次操作）；
 * - 调用方只有在更外层自行重放「同一个动作」时，才通过 options.idempotencyKey 传入。
 */

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
  /**
   * 一般不要传：每个用户动作在 API 入口内部生成一次幂等键，只在同一次调用的重试之间复用。
   * 仅当调用方自己在更外层重试/重放「同一个用户动作」时，才传入同一个键。
   */
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

/**
 * 最近一次作答写接口带回的 rewards（没有则 null）。读一次即清空：页面在每次 await 写接口之后调用一次，
 * 把结果交给 useRewards 排队提示。mock 模式永远是 null。
 */
let lastRewards: RewardsView | null = null
export function consumeRewards(): RewardsView | null {
  const rewards = lastRewards
  lastRewards = null
  return rewards
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
      activeHttp.request<{ state: AttemptState; rewards?: RewardsView }>(path, {
        method,
        body,
        ifMatch: options.ifMatch,
        idempotencyKey: options.idempotencyKey,
      }),
    )
    if (!isAttemptState(result.data?.state)) {
      throw new ApiError({ status: result.status, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
    }
    lastRewards = result.data.rewards ?? null
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
    // 02 §9：业务代码不直接用 localStorage；H5 兜底也必须放在条件编译里（小程序端只用 uni API）
    // #ifdef H5
    if (globalWithStorage.localStorage) {
      const storage = globalWithStorage.localStorage
      return { get: (key) => storage.getItem(key), set: (key, value) => storage.setItem(key, String(value)) }
    }
    // #endif
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

/** 首页视图（02 §4.2）：契约 StudentHome 的 UI 映射；week / notebook 允许缺省，UI 降级。 */
export interface HomeWeek {
  keysOwn: number
  keysTotal: number
  problemsDone: number
}

export interface HomeNotebookSummary {
  cards: number
  toRedo: number
}

export interface HomeData {
  greeting: string
  inProgress: AssignmentCardView[]
  todo: AssignmentCardView[]
  done: AssignmentCardView[]
  week: HomeWeek | null
  notebook: HomeNotebookSummary | null
}

/**
 * mock 模式返回的「与契约一致」的 StudentHome（openapi StudentHome/AssignmentCard）：
 * - inProgress：有 attempt 的进行中一题；
 * - todo：open（可开始）+ scheduled（未到时间，禁用）+ closed（已关闭，禁用）；
 * - done：两份完成，其中一份 reviewPublished=true（讲评入口）。
 * - week 有值；notebook 故意缺省（UI 必须能降级，不依赖 B #74 的证明本摘要）。
 */
export const mockHome: StudentHomeView = {
  inProgress: [
    {
      assignmentId: '11111111-1111-4111-8111-111111111111',
      title: '数列极限 · ε-N',
      chapter: '第二章 数列极限',
      mode: 'practice',
      status: 'open',
      attemptId: '11111111-1111-4111-8111-111111111112',
      attemptStatus: 'active',
      currentLayer: 'L3',
      reviewPublished: false,
    },
  ],
  todo: [
    {
      assignmentId: '22222222-2222-4222-8222-222222222222',
      title: '交错级数 · 收敛性',
      chapter: '第三章 级数',
      mode: 'practice',
      status: 'open',
      reviewPublished: false,
    },
    {
      assignmentId: '33333333-3333-4333-8333-333333333333',
      title: '函数极限 · ε-δ',
      chapter: '第二章 数列极限',
      mode: 'practice',
      status: 'scheduled',
      openAt: '2026-11-05T01:00:00.000Z',
      reviewPublished: false,
    },
    {
      assignmentId: '44444444-4444-4444-8444-444444444444',
      title: '单调有界 · 数列',
      chapter: '第二章 数列极限',
      mode: 'test',
      status: 'closed',
      reviewPublished: false,
    },
  ],
  done: [
    {
      assignmentId: '55555555-5555-4555-8555-555555555555',
      title: '数列极限 · ε-N（练习）',
      chapter: '第二章 数列极限',
      mode: 'practice',
      status: 'closed',
      attemptId: '55555555-5555-4555-8555-555555555556',
      attemptStatus: 'completed',
      currentLayer: 'L6',
      reviewPublished: true,
    },
    {
      assignmentId: '66666666-6666-4666-8666-666666666666',
      title: '无穷小比较 · 练习',
      chapter: '第二章 数列极限',
      mode: 'practice',
      status: 'open',
      attemptId: '66666666-6666-4666-8666-666666666667',
      attemptStatus: 'completed',
      currentLayer: 'L6',
      reviewPublished: false,
    },
  ],
  week: { keysOwn: 3, keysTotal: 4, problemsDone: 1 },
}

/** 首页卡片副标题：层 / 状态（scheduled/closed 由页面禁用并解释）。 */
export function cardLayerLabel(card: AssignmentCardView): string {
  if (card.attemptStatus === 'completed') return card.currentLayer ? `已完成 · ${layerLabel(card.currentLayer)}` : '已完成'
  if (card.currentLayer) return layerLabel(card.currentLayer)
  if (card.status === 'scheduled') return '未开始'
  if (card.status === 'closed' || card.status === 'cancelled') return '已关闭'
  return '待开始'
}

function validArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function toWeek(view: StudentHomeView['week']): HomeWeek | null {
  if (!view || typeof view !== 'object') return null
  const keysOwn = Number(view.keysOwn)
  const keysTotal = Number(view.keysTotal)
  if (!Number.isFinite(keysOwn) || !Number.isFinite(keysTotal)) return null
  const problemsDone = Number(view.problemsDone)
  return { keysOwn, keysTotal, problemsDone: Number.isFinite(problemsDone) ? problemsDone : 0 }
}

function toNotebook(view: StudentHomeView['notebook']): HomeNotebookSummary | null {
  if (!view || typeof view !== 'object') return null
  const cards = Number(view.cards)
  const toRedo = Number(view.toRedo)
  return { cards: Number.isFinite(cards) ? cards : 0, toRedo: Number.isFinite(toRedo) ? toRedo : 0 }
}

/**
 * StudentHome + Me → 首页视图。
 * - week / notebook 缺省（B #74 的 home.ts 未提供时）用 null，页面降级显示「暂不可用」；
 * - greeting 只用 Me.displayName，没有昵称就叫“同学”，不显示匿名码；/me 失败时同样降级（fetchHome 不因 /me 失败而整体失败）。
 */
export function toHomeData(home: StudentHomeView, meView: MeView | null): HomeData {
  const name = studentName(meView?.displayName)
  return {
    greeting: name === COPY.studentFallbackName ? '同学，你好' : `你好，${name}`,
    inProgress: validArray(home?.inProgress),
    todo: validArray(home?.todo),
    done: validArray(home?.done),
    week: toWeek(home?.week),
    notebook: toNotebook(home?.notebook),
  }
}

/**
 * GET /student/home（真实模式）+ GET /me（只用于问候语，失败不阻塞首页）。
 * GET 是幂等的，弱网下自动重试一次（http.ts withRetry 指数退避）；页面失败态可手动重试。
 */
export async function fetchHome(): Promise<HomeData> {
  if (USE_MOCK) {
    await sleep()
    return toHomeData(clone(mockHome), clone(mockMe))
  }
  const home = await withRetry(() => activeHttp.get<StudentHomeView>('/student/home'))
  if (home === null || typeof home !== 'object') {
    throw new ApiError({ status: 200, code: 'INTERNAL', message: '首页数据格式不正确，请稍后重试' })
  }
  let meView: MeView | null = null
  try {
    meView = await withRetry(() => getMe())
  } catch {
    // /me 只影响问候语：失败时首页仍要展示（不阻塞、不提示整页错误）。
    meView = null
  }
  return toHomeData(home, meView)
}

export const mockMe: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-7K2Q9M',
  displayName: null,
  classes: [],
  // mock 演示仍走「登录 → 同意页」流程；真实值以服务端 Me 为准。
  // #145：默认 ge18（不阻塞既有 mock 流程）；?ageBand= 可覆盖，见 resolveMockAgeBand。
  ageBand: 'ge18',
  consentRequired: true,
  features: {},
}

/** 离线/演示 fallback 的正文占位：正式文本只从 GET /consents 取（#62 待 PO 确认）。 */
export const CONSENT_PLACEHOLDER_BODY = '（正文由服务端提供，待 #62 确认）'

/**
 * 离线/演示 fallback 只保留条目 key / 标题 / 是否必选；正文一律占位，
 * 不得复制服务端同意书文本（PR #96 审计阻塞 2；正文待 #62 确认）。
 */
export const MOCK_CONSENT_SECTIONS: ConsentDoc['sections'] = [
  { key: 'service', title: '服务所需处理', body: CONSENT_PLACEHOLDER_BODY, required: true },
  { key: 'crossBorderHosting', title: '数据存储在中国香港服务器', body: CONSENT_PLACEHOLDER_BODY, required: true },
  { key: 'crossBorderModel', title: '境外决策模型（可选）', body: CONSENT_PLACEHOLDER_BODY, required: false },
  { key: 'monitoring', title: '过程监测', body: CONSENT_PLACEHOLDER_BODY, required: true },
  { key: 'research', title: '教研使用（可选）', body: CONSENT_PLACEHOLDER_BODY, required: false },
]

export const mockConsentDoc: ConsentDoc = {
  version: 'p0-v1',
  sections: MOCK_CONSENT_SECTIONS,
  signed: null,
}

/**
 * 14–17 岁同意书附加的「建议告知监护人」只读说明（#131）：
 * required=false、不签署；正文用占位，正式文本只从服务端 GET /consents 取（#62 待确认）。
 */
export const GUARDIAN_NOTICE_PLACEHOLDER_BODY = '（「建议告知监护人」正文由服务端提供，待 #62 确认）'

export const GUARDIAN_NOTICE_SECTION: ConsentSection = {
  key: 'guardianNotice',
  title: '建议告知监护人（14–17 岁）',
  body: GUARDIAN_NOTICE_PLACEHOLDER_BODY,
  required: false,
}

/** mock GET /consents：14–17 追加 guardianNotice 只读段（其他档位不变）。 */
export function mockConsentDocForAgeBand(ageBand: AgeBand | null): ConsentDoc {
  const doc = clone(mockConsentDoc)
  if (ageBand === '14to17') doc.sections = [...doc.sections, clone(GUARDIAN_NOTICE_SECTION)]
  return doc
}

/** 登录凭据：已设密码用 学号 + 密码；首次激活 / 密码被老师重置后用 邀请码 + 学号；第二个班 = 学号 + 密码 + 新班邀请码。 */
export interface LoginCredentials {
  studentNo: string
  password?: string
  inviteCode?: string
}

/** POST /auth/student/login：返回 Me（响应设置 HttpOnly Cookie；Me.needsPassword=true 表示要先设密码）。 */
export async function login(credentials: LoginCredentials, deviceId = getDeviceId()): Promise<MeView> {
  if (USE_MOCK) {
    await sleep()
    return mockMeView()
  }
  const body: Record<string, unknown> = { studentNo: credentials.studentNo, deviceId }
  if (credentials.inviteCode) body.inviteCode = credentials.inviteCode
  if (credentials.password) body.password = credentials.password
  const result = await activeHttp.post<MeView>('/auth/student/login', body)
  return result.data
}

/**
 * POST /auth/student/password：首次设置不带 currentPassword；修改必须带。
 * 成功后服务端作废该学生的其他会话（当前会话保留）。策略不通过 422（message 可直接展示）；当前密码不对 403 INVALID_CREDENTIALS。
 */
export async function setStudentPassword(newPassword: string, currentPassword?: string): Promise<void> {
  if (USE_MOCK) {
    await sleep()
    return
  }
  await activeHttp.post<{ ok: boolean }>('/auth/student/password', {
    newPassword,
    ...(currentPassword ? { currentPassword } : {}),
  }, { idempotencyKey: newIdempotencyKey() })
}

/** POST /auth/logout-all：退出所有设备（含当前）。 */
export async function logoutAll(): Promise<void> {
  if (USE_MOCK) {
    await sleep()
    return
  }
  await activeHttp.post<void>('/auth/logout-all')
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
    return mockMeView()
  }
  return activeHttp.get<MeView>('/me')
}

/**
 * POST /auth/student/age-band（#131）：学生自选年龄段，只能设置一次。
 * - 成功后返回最新 Me（ageBand 已记录）；
 * - 已记录 → 409 AGE_BAND_LOCKED（防止 <14 学生重新提交自我解锁）；
 * - <14 记录后服务端仍返回 200 + Me，但写接口会 403 AGE_RESTRICTED（前端只负责展示与拦截，不自己判定合规）。
 */
export async function setStudentAgeBand(ageBand: AgeBand): Promise<MeView> {
  if (ageBand !== 'lt14' && ageBand !== '14to17' && ageBand !== 'ge18') {
    throw new ApiError({ status: 422, code: 'VALIDATION_FAILED', message: '年龄分段不合法' })
  }
  if (USE_MOCK) {
    await sleep()
    const current = resolveMockAgeBand()
    if (current !== null) {
      throw new ApiError({ status: 409, code: 'AGE_BAND_LOCKED', message: AGE_BAND_LOCKED_MESSAGE })
    }
    mockAgeBandOverride = ageBand
    return mockMeView()
  }
  // 网络抖动重试一次：若首次其实已记录成功，重试会拿到 409 AGE_BAND_LOCKED，页面按「已记录」处理（不伪造成功）。
  const result = await withRetry(() => activeHttp.post<MeView>('/auth/student/age-band', { ageBand }))
  return result.data
}

/** GET /consents：当前同意书文本 + 本人最近一次签署。 */
export async function getConsents(): Promise<ConsentDoc> {
  if (USE_MOCK) {
    await sleep()
    return clone(mockConsentDocForAgeBand(resolveMockAgeBand()))
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
  // 每个用户动作生成一次幂等键；withRetry 的每次重试复用同一个键（下同）
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() =>
    activeHttp.post<{ state: AttemptState }>(
      `/student/assignments/${encodeURIComponent(assignmentId)}/attempt`,
      undefined,
      { idempotencyKey },
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
/** mock 的第 1、2 层核对：只认有没有写到 ε（演示用，真实判定在服务端）。 */
const MOCK_EPS = /ε|varepsilon|epsilon/

export async function submitDef(state: AttemptState, text: string, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  const submissions = (next.def?.submissions ?? 0) + 1
  // 演示：没写到 ε 就算没通过，走和真实服务端一样的 feedback。
  if (!MOCK_EPS.test(text)) {
    next.def = { ...(next.def ?? {}), submissions, last: text, feedback: '缺少“对任意 $\\varepsilon>0$”。', lessonSuggested: false }
    next.serverTime = new Date().toISOString()
    return next
  }
  next.def = { ...(next.def ?? {}), submissions, last: text, feedback: null, lessonSuggested: false }
  next.layers = next.layers.map((l) => (l.layer === 'L1' ? { ...l, status: 'done' as const } : l.layer === 'L2' ? { ...l, status: 'active' as const } : l))
  next.currentLayer = 'L2'
  next.serverTime = new Date().toISOString()
  return next
  }
  const body = { text, input: inputMeta('keyboard', options.draftId ?? newDraftId()) }
  return writeState(`/attempts/${state.attemptId}/definition`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? newUuid(),
  })
}

/** POST /attempts/{attemptId}/framework：第 2 层提交证明骨架。 */
export async function submitFramework(state: AttemptState, text: string, options: WriteOptions = {}): Promise<AttemptState> {
  if (USE_MOCK) {
  await sleep()
  const next = clone(state)
  next.stateVersion += 1
  if (!MOCK_EPS.test(text)) {
    next.frame = { ...(next.frame ?? {}), last: text, feedback: '骨架里还缺：开头——先固定任意的 $\\varepsilon>0$。' }
    next.serverTime = new Date().toISOString()
    return next
  }
  next.frame = { ...(next.frame ?? {}), last: text, feedback: null, templateShown: true }
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    input: {
      provenance: draft.input.provenance,
      draftId: options.draftId ?? draft.input.draftId ?? newDraftId(),
      // #25：photo/ink 行必须带已确认的 recogId（openapi InputMeta；漏传服务端会 RECOG_NOT_CONFIRMED）
      ...(draft.input.recogId ? { recogId: draft.input.recogId } : {}),
    },
  }
  return writeState(`/attempts/${state.attemptId}/lines`, body, {
    ifMatch: state.stateVersion,
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    idempotencyKey: options.idempotencyKey ?? newUuid(),
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
    // #151 / #141：与真服务端一致——行批注只在 HelpResult.note 里返回，不写 state.notes。
    // （B 落库 state.notes/annotation 事件前，A 端用本地 overlay 渲染到对应行，刷新后依赖 B 落库。）
    // lineId 参数供多行场景/e2e 指定行；缺省按 B 的约定批注最新一行。
    const lines = next.steps?.lines ?? []
    const targetLineId =
      lineId && lines.some((line) => line.lineId === lineId) ? lineId : lines[lines.length - 1]?.lineId ?? null
    const note: Note = {
      noteId: mockUuid(),
      kind: 'annotation',
      who: '批注',
      text: '你这一行的依据写的是哪条？试着把「由什么得到」写清楚。',
      lineId: targetLineId,
      level: null,
      cost: null,
      lessonConceptId: null,
      at: new Date().toISOString(),
    }
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
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() =>
    activeHttp.post<HelpResult>(`/attempts/${state.attemptId}/help`, body, {
      idempotencyKey,
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
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() =>
    activeHttp.post<HelpResult>(`/attempts/${state.attemptId}/hints/claim`, body, {
      idempotencyKey,
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

export interface RecognizeInkInput {
  attemptId: string
  /** 一行一个 draftId（03 §1）；确认后提交这一行时复用同一个。 */
  draftId: string
  target: 'def' | 'frame' | 'line_statement' | 'line_justification' | 'selfcheck' | 'summary' | 'help_text'
  /** InkCanvas finish 事件给出的 gzip(ink-v1 JSON) 的 base64（≤256KB）。 */
  ink: string
}

/**
 * POST /recognitions/ink（#21）：写完这一行时调用一次，不做实时识别。
 * - 不自动重试：识别请求没有幂等键，重试会产生重复识别记录并多计一次每日额度；
 * - mock 模式（或传入字符串）返回演示结果，供 e2e/截图。
 */
export async function recognizeInk(input: string | RecognizeInkInput): Promise<Recognition> {
  if (USE_MOCK || typeof input === 'string') {
    await sleep(600)
    return clone(mockRecognition) as Recognition
  }
  const result = await activeHttp.post<Recognition>('/recognitions/ink', input)
  return result.data
}

// ---------------------------------------------------------------------------
// #25 拍照识别：POST /recognitions/photo（multipart）与 confirm
// ---------------------------------------------------------------------------

export type PhotoSource = 'camera' | 'album'
/** openapi InputTarget（拍照行默认 line_statement）。 */
export type PhotoTarget =
  | 'def'
  | 'frame'
  | 'line_statement'
  | 'line_justification'
  | 'selfcheck'
  | 'summary'
  | 'help_text'

export interface RecognizePhotoInput {
  attemptId: string
  /** 一次拍照（整页）一个 draftId；确认后每行用各自 draftId（03 §1）。 */
  draftId: string
  target: PhotoTarget
  source: PhotoSource
  /** 已压缩的 JPEG（长边 ≤2000、≤2MB、已去 EXIF）。 */
  image: Blob
}

export interface ConfirmRecognitionResult {
  recogId: string
  edited: boolean
  rendered?: boolean
}

/**
 * POST /recognitions/photo（multipart/form-data）：
 * - FormData 由浏览器生成 boundary，**不手设 Content-Type**；写请求带 X-Requested-With（http 统一加）；
 * - 不自动重试：识别请求没有幂等键，重试可能产生重复识别结果；
 * - mock 返回 3 行 Recognition（mockPhotoRecognition），供演示/e2e。
 */
export async function recognizePhoto(input: RecognizePhotoInput): Promise<Recognition> {
  if (USE_MOCK) {
    await sleep(220)
    return clone(mockPhotoRecognition) as Recognition
  }
  if (typeof FormData === 'undefined') {
    throw new ApiError({ status: 0, code: 'INTERNAL', message: '当前环境不支持图片上传' })
  }
  const form = new FormData()
  form.append('attemptId', input.attemptId)
  form.append('draftId', input.draftId)
  form.append('target', input.target)
  form.append('source', input.source)
  // 第三个参数是 multipart 的 filename；JPEG 与压缩结果一致。
  form.append('image', input.image, 'photo.jpg')
  const result = await activeHttp.request<Recognition>('/recognitions/photo', {
    method: 'POST',
    formData: form,
  })
  return result.data
}

/** POST /recognitions/{recogId}/confirm：学生确认（可改过）识别结果；lines 为拍照确认后的各行。 */
export async function confirmRecognition(
  recogId: string,
  text: string,
  lines: string[] = [],
): Promise<ConfirmRecognitionResult> {
  if (USE_MOCK) {
    await sleep(120)
    return { recogId, edited: false, rendered: true }
  }
  const result = await activeHttp.post<ConfirmRecognitionResult>(
    '/recognitions/' + encodeURIComponent(recogId) + '/confirm',
    { text, ...(lines.length > 0 ? { lines } : {}) },
  )
  return result.data
}

/**
 * 拍照识别错误 → 学生可读文案（#25，真实服务端语义）。
 *
 * 服务端 #189 已上线，因此 404 不再是「即将上线」，而是作答/识别记录不存在；
 * PHOTO_DISABLED 与 RATE_LIMITED 有多个原因（功能未开放/老师关闭、上一张在识别/今日次数用完/
 * 每分钟限流），优先展示服务端可直接给学生看的 message，避免前端固定文案掩盖真实原因。
 */
function serverCopyOr(error: { message: string }, fallback: string): string {
  const message = error.message.trim()
  return message === '' ? fallback : message
}

export function photoRecognitionErrorMessage(error: unknown): string {
  if (error instanceof ImageCompressError) {
    switch (error.code) {
      case 'unsupported':
        return '当前环境不支持拍照压缩，请改用键盘或手写'
      case 'empty':
        return '没有选择图片，请重新拍照或用键盘'
      case 'invalid_type':
        return '只支持图片文件，请重新拍照'
      case 'decode':
      case 'encode':
        return '图片处理失败，请靠近一点重拍或用键盘'
      case 'too_large':
        return '图片太大，压缩后仍超过 2MB，请靠近一点重拍或用键盘'
      default:
        return '拍照识别暂不可用，请用键盘或手写'
    }
  }
  if (isApiError(error)) {
    if (error.status === 404 || error.code === 'NOT_FOUND') {
      return '识别记录或作答不存在，请重新拍照/确认，或用键盘'
    }
    if (error.code === 'PHOTO_DISABLED') {
      return serverCopyOr(error, '拍照识别暂未开放，请用键盘或手写')
    }
    if (error.code === 'PAYLOAD_TOO_LARGE' || error.status === 413) {
      return '图片仍然太大，请靠近一点重拍或用键盘'
    }
    if (error.code === 'RATE_LIMITED' || error.status === 429) {
      return serverCopyOr(error, '识别太频繁，请稍后再试或用键盘')
    }
    if (error.code === 'CONSENT_REQUIRED') {
      return '请先阅读并签署知情同意书，再使用拍照识别'
    }
    if (error.code === 'AGE_BAND_REQUIRED') {
      return '请先选择年龄段，再使用拍照识别'
    }
    if (error.code === 'AGE_RESTRICTED') {
      return '本服务暂未向 14 岁以下学生开放'
    }
    if (error.code === 'FORBIDDEN') {
      return '当前账号不能使用拍照识别，请用键盘或手写'
    }
    if (error.code === 'TEST_MODE_RESTRICTED') {
      return '测验模式下拍照识别不可用，请用键盘或手写'
    }
    if (error.code === 'ATTEMPT_LOCKED') {
      return '本题已锁定，请联系老师'
    }
    if (error.code === 'RECOG_NOT_CONFIRMED') {
      return '识别结果还没确认，请先确认再加入'
    }
    if (error.code === 'VALIDATION_FAILED') {
      return '识别参数异常，请重新拍照或改用键盘'
    }
    if (error.code === 'NETWORK' || error.status === 0) {
      return '网络不稳定，拍照识别暂不可用；可以稍后重试或用键盘'
    }
    if (error.code === 'UPSTREAM_UNAVAILABLE') {
      return '识别服务暂时不可用，请稍后重试或用键盘'
    }
  }
  return errorMessage(error)
}

let seq = 0
function mockUuid(): string {
  seq += 1
  const n = String(seq).padStart(12, '0')
  return '00000000-0000-4000-8000-' + n
}

/**
 * 测试/演示开关（仅 H5 + mock）：URL 带 ?aigc=1 时给 mock 微课塞一条 generated 占位文本，
 * 用于验证 AIGC 显式标识的渲染；默认关闭（不启用真实生成、不伪造内容）。
 * 真实模式（USE_MOCK=false）不读取该开关，服务端是否下发 generated 才是唯一来源。
 */
function mockAigcPreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false
  for (const source of [window.location.hash, window.location.search]) {
    const index = source.indexOf('?')
    if (index < 0) continue
    if (new URLSearchParams(source.slice(index + 1)).get('aigc') === '1') return true
  }
  return false
}

/**
 * 第 1–2 层：取微课（GET /attempts/{id}/lesson/{conceptId}）。
 * mock 返回概念库的预写微课（seed concepts.json 的 seq-limit）；真实接口 #24 按 conceptId 下发。
 * 微课文本已由服务端过闸门，前端只渲染；?aigc=1 仅供测试/演示 AIGC 标识（见 mocks/README.md）。
 */
export async function fetchLesson(state: AttemptState, conceptId?: string): Promise<LessonView> {
  const topic = conceptId ?? state.def?.conceptId ?? mockLesson.conceptId
  if (USE_MOCK) {
    await sleep()
    const lesson = mockAigcPreviewEnabled() ? mockGeneratedLesson : mockLesson
    return clone({ ...lesson, conceptId: topic })
  }
  return withRetry(() =>
    activeHttp.get<LessonView>(`/attempts/${state.attemptId}/lesson/${encodeURIComponent(topic)}`),
  )
}

/**
 * 微课小核验（POST /attempts/{id}/lesson/{conceptId}/check）：服务端判定，不下发答案。
 * mock 返回 null，表示由 MicroCourse 用 mock 题里自带的 answer/right/wrong 本地判定。
 */
export async function checkLesson(
  state: AttemptState,
  conceptId: string,
  stepId: string,
  choice: number,
): Promise<{ correct: boolean; feedback: string } | null> {
  if (USE_MOCK) return null
  const result = await withRetry(() =>
    activeHttp.request<{ correct: boolean; feedback: string }>(
      `/attempts/${state.attemptId}/lesson/${encodeURIComponent(conceptId)}/check`,
      { method: 'POST', body: { stepId, choice }, idempotencyKey: newUuid() },
    ),
  )
  return { correct: result.data.correct, feedback: result.data.feedback }
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
      idempotencyKey: newUuid(),
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
      idempotencyKey: newUuid(),
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
      idempotencyKey: newUuid(),
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
      idempotencyKey: newUuid(),
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
      idempotencyKey: newUuid(),
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
 * 重做（POST /student/attempts/{id}/redo）：在本人已完成的作答上新建 kind=redo 的子作答（强制练习模式、从 L1 开始，
 * 第 5 层自动跳过）。已有未结束的重做则返回它（幂等）。sourceAttemptId 是被重做的**已完成作答**（证明本卡片/错题的 attemptId）。
 * 错误：409 作答未完成；403 他人的作答或测验尚未结束（TEST_MODE_RESTRICTED）。
 * 返回新作答的 state，由调用方交给做题页（跨页交接见 stores/attempt.ts）。
 */
export async function startRedo(sourceAttemptId?: string): Promise<AttemptState> {
  if (!USE_MOCK) {
    if (!sourceAttemptId) {
      throw new ApiError({ status: 422, code: 'VALIDATION_FAILED', message: '缺少要重做的作答' })
    }
    return writeState(`/student/attempts/${encodeURIComponent(sourceAttemptId)}/redo`, undefined, {
      idempotencyKey: newUuid(),
    })
  }
  await sleep()
  const next = clone(createMockState('l1-active'))
  next.attemptId = mockUuid()
  next.parentAttemptId = sourceAttemptId ?? null
  next.kind = 'redo'
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

/** mock 错题本：与真实 GET /student/mistakes 同形。 */
export const mockMistakes: MistakesView = {
  groups: [
    {
      group: 'scaling',
      title: '放缩卡住',
      count: 1,
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111:scaling:mock',
          group: 'scaling',
          problemTitle: '数列极限 · ε-N',
          chapter: '第二章 数列极限',
          attemptId: '11111111-1111-4111-8111-111111111111',
          lineExcerpt: '取 $N=n+1$',
          note: '你取的 $N$ 里出现了 $n$。定义里 $N$ 在 $n$ 之前取定，$N$ 能依赖 $n$ 吗？',
          createdAt: daysAgoIso(3),
          canRedo: true,
        },
      ],
    },
  ],
  total: 1,
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** 错题本（GET /student/mistakes）：按卡点分组，空分组不返回；每项的 attemptId 可直接传给 startRedo。 */
export async function fetchMistakes(): Promise<MistakesView> {
  if (!USE_MOCK) return activeHttp.get<MistakesView>('/student/mistakes')
  await sleep()
  return clone(mockMistakes)
}

/**
 * 讲评（GET /attempts/{id}/review）：教师发布讲评、且本人写完（或布置结束）后才有；否则 403（FORBIDDEN）。
 * 参考证明与讲评都是 MathText，显示时走 MathText 组件。
 */
export async function fetchReview(attemptId: string): Promise<PublishedReview> {
  if (!USE_MOCK) return activeHttp.get<PublishedReview>(`/attempts/${encodeURIComponent(attemptId)}/review`)
  await sleep()
  return {
    proofs: ['任取 $\\varepsilon>0$。取 $N=\\lceil 5/\\varepsilon\\rceil$，则当 $n>N$ 时 $|a_n-3|<\\varepsilon$。'],
    note: '这道题的关键是 $N$ 只依赖 $\\varepsilon$。',
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


// ---------------------------------------------------------------------------
// 进度、设置、反馈（Task 9）
// ---------------------------------------------------------------------------

export const mockProgress: ProgressView = {
  xpTotal: 120,
  xpToday: 25,
  keysToday: 2,
  dailyGoal: 3,
  streak: { current: 3, best: 5, freezeAvailable: true, usedFreezeDays: [] },
  week: ['一', '二', '三', '四', '五', '六', '日'].map((_, i) => ({
    day: '2026-11-0' + (2 + i),
    xp: i < 3 ? 20 + i * 5 : 0,
    keys: i < 3 ? 2 : 0,
  })),
  badges: [
    { id: 'first_step', title: '第一步', desc: '第一次写出有进展的一步', earnedAt: '2026-11-02T08:00:00.000Z' },
    { id: 'streak_3', title: '连续 3 天', desc: '连续 3 天都有实质进展', earnedAt: null, progress: { current: 3, target: 3 } },
    { id: 'streak_7', title: '连续 7 天', desc: '连续 7 天都有实质进展', earnedAt: null, progress: { current: 3, target: 7 } },
  ],
  daysLearned: 3,
}

let mockSettings: SettingsView = {
  nickname: null,
  dailyGoal: 3,
  defaultInput: 'hand',
  theme: 'system',
  sound: true,
  motion: true,
  haptics: true,
  onboarding: {},
}

/** 学习进度（GET /student/progress）：经验、连胜、本周每日、徽章。 */
export async function fetchProgress(): Promise<ProgressView> {
  if (!USE_MOCK) return activeHttp.get<ProgressView>('/student/progress')
  await sleep()
  return clone(mockProgress)
}

/** 我的设置（GET /student/settings）。要求已签同意书。 */
export async function fetchSettings(): Promise<SettingsView> {
  if (!USE_MOCK) return activeHttp.get<SettingsView>('/student/settings')
  await sleep()
  return clone(mockSettings)
}

/** 修改设置（PATCH /student/settings，只传要改的字段）；返回修改后的完整设置。昵称 trim 后 1–16 字，否则 422。 */
export async function updateSettings(patch: SettingsPatch): Promise<SettingsView> {
  if (!USE_MOCK) return (await activeHttp.patch<SettingsView>('/student/settings', patch)).data
  await sleep()
  mockSettings = { ...mockSettings, ...clone(patch), nickname: patch.nickname?.trim() ?? mockSettings.nickname }
  return clone(mockSettings)
}

/** 问题反馈（POST /student/feedback，204）。 */
export async function sendFeedback(kind: FeedbackKind, body: string, page?: string): Promise<void> {
  if (!USE_MOCK) {
    await activeHttp.post('/student/feedback', { kind, body, ...(page === undefined ? {} : { page }) }, { idempotencyKey: newUuid() })
    return
  }
  await sleep()
}

// ---------------------------------------------------------------------------
// 学习路径（Task 11）与练习区（Task 16）。真实模式调服务端；mock 模式按同一套规则在 mocks/pathMock 里算。
// 前端不判定：完成、锁定、难度档、可看的解答级别都来自服务端响应。
// ---------------------------------------------------------------------------

/** mock 里抛出的普通错误（带 status/code）转成 ApiError，页面的错误处理与真实模式一致。 */
async function mockPath<T>(action: () => T): Promise<T> {
  await sleep()
  try {
    return clone(action())
  } catch (error) {
    const e = error as { status?: number; code?: string; message?: string }
    throw new ApiError({ status: e.status ?? 500, code: e.code ?? 'INTERNAL', message: e.message ?? '出了点问题' })
  }
}

function queryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  return entries.length === 0 ? '' : `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`
}

/** mock 开始一道题：把演示状态改成这道题的标题与题面；导入题只启用写证明与总结两层。 */
async function mockStartState(problemId: string): Promise<AttemptState> {
  const { problem, attemptId } = mockStartProblem(problemId)
  const state = await fetchAttempt()
  state.attemptId = attemptId
  state.problem = {
    ...state.problem,
    problemId: problem.id,
    title: problem.title,
    stem: problem.stem,
    keyCount: problem.keyCount,
  }
  if (problem.layers === 2) {
    state.currentLayer = 'L3'
    state.layers = state.layers.map((layer) =>
      layer.layer === 'L3'
        ? { ...layer, status: 'active' }
        : layer.layer === 'L6'
          ? { ...layer, status: 'locked' }
          : { ...layer, status: 'disabled', enabled: false },
    )
  }
  return state
}

/** GET /student/path?unit=：只带当前单元的题目详情，其余单元只有摘要。不传 unit = 第一个没做完的单元。 */
export async function getStudentPath(unitId?: string): Promise<StudentPath> {
  if (USE_MOCK) return mockPath(() => mockStudentPath(unitId))
  return withRetry(() => activeHttp.get<StudentPath>(`/student/path${queryString({ unit: unitId })}`))
}

async function startFromPool(
  prefix: '/student/path/items' | '/student/practice',
  problemId: string,
  options: WriteOptions & { classId?: string } = {},
): Promise<AttemptState> {
  if (USE_MOCK) {
    await sleep()
    try {
      return await mockStartState(problemId)
    } catch (error) {
      const e = error as { status?: number; code?: string; message?: string }
      throw new ApiError({ status: e.status ?? 500, code: e.code ?? 'INTERNAL', message: e.message ?? '出了点问题' })
    }
  }
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() =>
    activeHttp.post<{ state: AttemptState }>(
      `${prefix}/${encodeURIComponent(problemId)}/start`,
      options.classId === undefined ? undefined : { classId: options.classId },
      { idempotencyKey },
    ),
  )
  if (!isAttemptState(result.data?.state)) {
    throw new ApiError({ status: result.status, code: 'INTERNAL', message: '服务端返回的状态格式不正确' })
  }
  return result.data.state
}

/**
 * POST /student/path/items/{problemId}/start：从路径节点开始、继续或回看（已做完返回只读状态）。
 * 班里这题有没结束的测验 → ApiError code=TEST_IN_PROGRESS（409，文案可直接展示）。
 */
export function startPathItem(problemId: string, options: WriteOptions & { classId?: string } = {}): Promise<AttemptState> {
  return startFromPool('/student/path/items', problemId, options)
}

/** POST /student/practice/{problemId}/start：从练习区开始，规则同 startPathItem。 */
export function startPracticeProblem(problemId: string, options: WriteOptions & { classId?: string } = {}): Promise<AttemptState> {
  return startFromPool('/student/practice', problemId, options)
}

/** GET /student/practice：按章节、难度、状态、关键词筛选，游标分页；响应带分面计数。 */
export async function listPractice(query: PracticeQuery = {}): Promise<PracticeList> {
  if (USE_MOCK) return mockPath(() => mockListPractice(query))
  return withRetry(() =>
    activeHttp.get<PracticeList>(
      `/student/practice${queryString({
        chapter: query.chapter,
        difficulty: query.difficulty,
        status: query.status,
        q: query.q,
        cursor: query.cursor,
        limit: query.limit,
      })}`,
    ),
  )
}

/** POST /student/practice/random：随机一道没做完的题（范围内都做完 → 404 NOT_FOUND，文案可直接展示），随后调用 startPracticeProblem。 */
export async function randomPracticeProblem(
  filter: { chapter?: string; difficulty?: DifficultyBand } = {},
  options: WriteOptions = {},
): Promise<PracticeItem> {
  if (USE_MOCK) return mockPath(() => mockRandomPractice(filter))
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() => activeHttp.post<PracticeItem>('/student/practice/random', filter, { idempotencyKey }))
  return result.data
}

/** GET /student/practice/{problemId}/solution：只含这位学生此刻可以看的那一级（none / approach / full）。 */
export async function getPracticeSolution(problemId: string): Promise<PracticeSolution> {
  if (USE_MOCK) return mockPath(() => mockSolution(problemId))
  return withRetry(() => activeHttp.get<PracticeSolution>(`/student/practice/${encodeURIComponent(problemId)}/solution`))
}

/**
 * POST /student/practice/{problemId}/solution/reveal：主动查看思路（approach）或完整解答（full）。
 * 只限自己的练习模式自学作答；老师布置、测验 → 403，没开始做 → 409。查看后写出的关键步骤按“有提示”计。
 */
export async function revealPracticeSolution(
  problemId: string,
  level: 'approach' | 'full',
  options: WriteOptions = {},
): Promise<PracticeSolution> {
  if (USE_MOCK) return mockPath(() => mockReveal(problemId, level))
  const idempotencyKey = options.idempotencyKey ?? newUuid()
  const result = await withRetry(() =>
    activeHttp.post<PracticeSolution>(`/student/practice/${encodeURIComponent(problemId)}/solution/reveal`, { level }, { idempotencyKey }),
  )
  return result.data
}

/** GET /attempts/{attemptId}/review：讲评（已标记可发布的参考证明）。自学作答完成即可看；教师布置要教师发布；否则 403。 */
export async function getAttemptReview(attemptId: string): Promise<PublishedReview> {
  if (USE_MOCK) return mockPath(() => mockReview(attemptId))
  return withRetry(() => activeHttp.get<PublishedReview>(`/attempts/${encodeURIComponent(attemptId)}/review`))
}
