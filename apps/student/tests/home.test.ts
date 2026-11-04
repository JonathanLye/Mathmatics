/**
 * #24 剩余：GET /student/home 映射、弱网重试、幂等键/If-Match/409 覆盖。
 * 只测客户端「传输 → 视图」搬运，不测 UI 组件（组件行为由 e2e:flows:24 覆盖）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetClientForTests,
  cardLayerLabel,
  configureClientForTests,
  fetchHome,
  isMockMode,
  mockHome,
  startAttempt,
  submitDef,
  toHomeData,
} from '@/api/client'
import { ApiError } from '@/api/http'
import { createMockState } from '@/mocks/attemptStates'
import type { AssignmentCardView, AttemptState, MeView, StudentHomeView } from '@/types/attempt'

interface Call {
  url: string
  init: RequestInit
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function captureFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const call: Call = { url, init, body }
    calls.push(call)
    return responder(call)
  }
  return { calls, fetchImpl }
}

function headersOf(call: Call): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ME: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-TEST',
  displayName: '测试同学',
  classes: [],
  consentRequired: false,
  ageBand: 'ge18',
  features: {},
}

const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333'

function card(patch: Partial<AssignmentCardView> = {}): AssignmentCardView {
  return {
    assignmentId: ASSIGNMENT_ID,
    title: '数列极限 · ε-N',
    mode: 'practice',
    status: 'open',
    ...patch,
  }
}

function homeView(patch: Partial<StudentHomeView> = {}): StudentHomeView {
  return {
    inProgress: [],
    todo: [card()],
    done: [],
    week: { keysOwn: 2, keysTotal: 4, problemsDone: 1 },
    ...patch,
  }
}

/** fetchHome 会先 GET /student/home，再 GET /me；这个 responder 覆盖两个路由。 */
function homeResponder(home: StudentHomeView, me: MeView | null = ME) {
  return (call: Call): Response => {
    if (call.url.endsWith('/student/home')) return jsonResponse(home)
    if (call.url.endsWith('/me')) return me ? jsonResponse(me) : jsonResponse({ error: { code: 'INTERNAL', message: 'me 挂了' } }, 500)
    return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
  }
}

beforeEach(() => {
  __resetClientForTests()
})

describe('首页真实接口（GET /student/home）', () => {
  it('契约 StudentHome → UI 视图：三段数组、week、notebook、问候语', async () => {
    const home = homeView({
      inProgress: [card({ attemptId: ATTEMPT_ID, attemptStatus: 'active', currentLayer: 'L3' })],
      todo: [card({ assignmentId: '44444444-4444-4444-8444-444444444444', status: 'scheduled' })],
      done: [card({ assignmentId: '55555555-5555-4555-8555-555555555555', status: 'closed', attemptStatus: 'completed', currentLayer: 'L6', reviewPublished: true })],
      notebook: { cards: 3, toRedo: 2 },
    })
    const { calls, fetchImpl } = captureFetch(homeResponder(home))
    configureClientForTests({ fetchImpl, mock: false })

    const view = await fetchHome()
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/student/home', '/api/v1/me'])
    expect(view.greeting).toBe('你好，测试同学')
    expect(view.inProgress).toHaveLength(1)
    expect(view.inProgress[0]?.currentLayer).toBe('L3')
    expect(view.todo[0]?.status).toBe('scheduled')
    expect(view.done[0]?.reviewPublished).toBe(true)
    expect(view.week).toEqual({ keysOwn: 2, keysTotal: 4, problemsDone: 1 })
    expect(view.notebook).toEqual({ cards: 3, toRedo: 2 })
  })

  it('/me 失败不阻塞首页：仍返回三段数据，问候语降级为「同学，你好」', async () => {
    const { fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/student/home')) return jsonResponse(homeView())
      return jsonResponse({ error: { code: 'INTERNAL', message: 'me 挂了' } }, 500)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const view = await fetchHome()
    expect(view.greeting).toBe('同学，你好')
    expect(view.todo).toHaveLength(1)
  })

  it('week / notebook 缺省 → null（页面据此降级），数组缺省 → 空数组', async () => {
    const { fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/student/home')) return jsonResponse({ inProgress: undefined, todo: undefined, done: undefined })
      return jsonResponse(ME)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const view = await fetchHome()
    expect(view.inProgress).toEqual([])
    expect(view.todo).toEqual([])
    expect(view.done).toEqual([])
    expect(view.week).toBeNull()
    expect(view.notebook).toBeNull()
  })

  it('弱网 5xx：自动重试一次后成功（GET 幂等，无需幂等键）', async () => {
    let attempts = 0
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/student/home')) {
        attempts += 1
        if (attempts === 1) return jsonResponse({ error: { code: 'INTERNAL', message: '服务暂时不可用' } }, 500)
        return jsonResponse(homeView())
      }
      return jsonResponse(ME)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const view = await fetchHome()
    expect(attempts).toBe(2)
    expect(view.todo).toHaveLength(1)
    expect(calls.filter((call) => call.url.endsWith('/student/home'))).toHaveLength(2)
  })

  it('两次 5xx → 抛可重试 ApiError（页面显示错误 + 手动重试）', async () => {
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/student/home')) return jsonResponse({ error: { code: 'INTERNAL', message: '服务暂时不可用' } }, 500)
      return jsonResponse(ME)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const error = (await fetchHome().catch((reason: unknown) => reason)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('INTERNAL')
    expect(error.retryable).toBe(true)
    expect(calls.filter((call) => call.url.endsWith('/student/home'))).toHaveLength(2)
  })

  it('mock 模式不发网络请求，返回与契约一致的 StudentHome 形状（含 scheduled/closed/reviewPublished）', async () => {
    let called = false
    configureClientForTests({
      mock: true,
      fetchImpl: async () => {
        called = true
        return jsonResponse({})
      },
    })
    expect(isMockMode()).toBe(true)
    const view = await fetchHome()
    expect(called).toBe(false)
    expect(mockHome.inProgress.length).toBeGreaterThan(0)
    expect(mockHome.todo.some((todo) => todo.status === 'scheduled')).toBe(true)
    expect(mockHome.todo.some((todo) => todo.status === 'closed')).toBe(true)
    expect(mockHome.done.some((done) => done.reviewPublished === true)).toBe(true)
    expect(view.inProgress[0]?.title).toBe(mockHome.inProgress[0]?.title)
    expect(view.week).toEqual(mockHome.week)
    expect(view.notebook).toBeNull()
  })
})

describe('首页映射纯函数 / 卡片状态', () => {
  it('cardLayerLabel：当前层 / 已完成 / scheduled / closed / 待开始', () => {
    expect(cardLayerLabel(card({ currentLayer: 'L3' }))).toContain('第 3 层')
    expect(cardLayerLabel(card({ attemptStatus: 'completed', currentLayer: 'L6' }))).toContain('已完成')
    expect(cardLayerLabel(card({ status: 'scheduled' }))).toBe('未开始')
    expect(cardLayerLabel(card({ status: 'closed' }))).toBe('已关闭')
    expect(cardLayerLabel(card({ status: 'open' }))).toBe('待开始')
  })

  it('toHomeData：非法 week → null；notebook 缺字段按 0 处理', () => {
    const view = toHomeData(
      {
        inProgress: [],
        todo: [],
        done: [],
        week: { keysOwn: Number.NaN, keysTotal: 4, problemsDone: 1 },
        notebook: { cards: 2 } as unknown as StudentHomeView['notebook'],
      },
      null,
    )
    expect(view.week).toBeNull()
    expect(view.notebook).toEqual({ cards: 2, toRedo: 0 })
    expect(view.greeting).toBe('同学，你好')
  })
})

describe('写请求弱网 / 幂等 / 409 覆盖', () => {
  it('startAttempt 弱网重试复用同一个 Idempotency-Key', async () => {
    const state = createMockState('l1-active')
    let attempts = 0
    const { calls, fetchImpl } = captureFetch(() => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return jsonResponse({ state })
    })
    configureClientForTests({ fetchImpl, mock: false })

    const started = await startAttempt(ASSIGNMENT_ID)
    expect(started.attemptId).toBe(state.attemptId)
    expect(calls).toHaveLength(2)
    expect(headersOf(calls[0] as Call)['Idempotency-Key']).toMatch(UUID_RE)
    expect(headersOf(calls[1] as Call)['Idempotency-Key']).toBe(headersOf(calls[0] as Call)['Idempotency-Key'])
    expect(calls[0]?.url).toContain('/student/assignments/' + ASSIGNMENT_ID + '/attempt')
  })

  it('409 STATE_STALE：先覆盖最新状态，下一次写请求用新的 stateVersion 作 If-Match', async () => {
    const state: AttemptState = createMockState('l1-active')
    const latest: AttemptState = { ...state, stateVersion: state.stateVersion + 1 }
    let attempt = 0
    const { calls, fetchImpl } = captureFetch(() => {
      attempt += 1
      if (attempt === 1) {
        return jsonResponse({ error: { code: 'STATE_STALE', message: '状态已更新', detail: { state: latest } } }, 409)
      }
      return jsonResponse({ state: latest })
    })
    configureClientForTests({ fetchImpl, mock: false })

    const stale = await submitDef(state, '任取 ε>0')
    expect(stale.stateVersion).toBe(latest.stateVersion)

    const next = await submitDef(stale, '继续写')
    expect(next.stateVersion).toBe(latest.stateVersion)
    expect(calls).toHaveLength(2)
    expect(headersOf(calls[1] as Call)['If-Match']).toBe(String(latest.stateVersion))
    expect(headersOf(calls[0] as Call)['If-Match']).toBe(String(state.stateVersion))
    // 不同用户动作必须是不同的幂等键（失败的那次动作不跨动作复用）
    expect(headersOf(calls[1] as Call)['Idempotency-Key']).not.toBe(headersOf(calls[0] as Call)['Idempotency-Key'])
  })
})
