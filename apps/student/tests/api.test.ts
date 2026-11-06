import { beforeEach, describe, expect, it } from 'vitest'

import {
  ApiError,
  CONSENT_PLACEHOLDER_BODY,
  MOCK_CONSENT_SECTIONS,
  __resetClientForTests,
  addLine,
  claimHint,
  configureClientForTests,
  consumeStateStaleFlag,
  fetchHome,
  finishSteps,
  getConsents,
  getDeviceId,
  isMockMode,
  login,
  mockConsentDoc,
  mockHome,
  requestHelp,
  skipLayer,
  startAttempt,
  submitConsents,
  submitDef,
} from '@/api/client'
import { createMockState } from '@/mocks/attemptStates'
import { __resetSessionForTests, useSession } from '@/stores/session'
import type { AttemptState, ConsentChoices, LineDraft, MeView } from '@/types/attempt'

interface Call {
  url: string
  init: RequestInit
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function captureFetch(responder: (call: Call) => Response) {
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
  displayName: null,
  classes: [],
  consentRequired: true,
  ageBand: 'ge18',
  features: {},
}

/** 测试 fixture：正文由服务端返回，与客户端 fallback 无关。 */
const CONSENT_DOC = {
  version: 'v2',
  sections: [
    { key: 'service', title: '服务所需处理', body: '测试正文 A', required: true },
    { key: 'crossBorderHosting', title: '数据存储在中国香港服务器', body: '测试正文 B', required: true },
    { key: 'crossBorderModel', title: '境外决策模型（可选）', body: '测试正文 C', required: false },
    { key: 'monitoring', title: '过程监测', body: '测试正文 D', required: true },
    { key: 'research', title: '教研使用（可选）', body: '测试正文 E', required: false },
  ],
  signed: null,
}

const CONSENT_KEYS = ['service', 'crossBorderHosting', 'crossBorderModel', 'monitoring', 'research']

const mockState = (): AttemptState => createMockState('l1-active')

const draft = (): LineDraft => ({
  statement: '任取 $\varepsilon>0$',
  justification: '由定义',
  input: { provenance: 'keyboard', draftId: '33333333-3333-4333-8333-333333333333' },
})

beforeEach(() => {
  __resetClientForTests()
  __resetSessionForTests()
})

describe('真实接口客户端（issue #24）', () => {
  it('login / GET /consents / POST /consents 按契约形状调用', async () => {
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/auth/student/login')) return jsonResponse(ME)
      if (call.url.endsWith('/consents') && call.init.method === 'GET') return jsonResponse(CONSENT_DOC)
      if (call.url.endsWith('/consents') && call.init.method === 'POST') return jsonResponse({ ...ME, consentRequired: false })
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })

    const meView = await login({ inviteCode: 'ABC123', studentNo: '2026001' })
    expect(meView.consentRequired).toBe(true)
    expect(calls[0]?.url).toBe('/api/v1/auth/student/login')
    const loginBody = calls[0]?.body as { inviteCode: string; studentNo: string; deviceId: string }
    expect(loginBody.inviteCode).toBe('ABC123')
    expect(loginBody.studentNo).toBe('2026001')
    expect(loginBody.deviceId).toMatch(UUID_RE)

    const doc = await getConsents()
    expect(doc.version).toBe('v2')
    expect(doc.sections.map((section) => section.key)).toEqual(CONSENT_KEYS)

    const items: ConsentChoices = {
      service: true,
      crossBorderHosting: true,
      crossBorderModel: false,
      monitoring: true,
      research: false,
    }
    const signed = await submitConsents('v2', items)
    expect(signed.consentRequired).toBe(false)
    expect(calls[2]?.url).toBe('/api/v1/consents')
    expect(calls[2]?.body).toEqual({ version: 'v2', items })
  })

  it('session store：同意书文本来自服务端，提交后 consented=true', async () => {
    let posted: { version: string; items: ConsentChoices } | null = null
    const { fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/consents') && call.init.method === 'GET') return jsonResponse(CONSENT_DOC)
      if (call.url.endsWith('/consents') && call.init.method === 'POST') {
        posted = call.body as { version: string; items: ConsentChoices }
        return jsonResponse({ ...ME, consentRequired: false })
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })

    const session = useSession()
    expect(await session.loadConsentDoc()).toBe(true)
    expect(session.items.value.map((item) => item.id)).toEqual(CONSENT_KEYS)
    expect(session.items.value.filter((item) => item.required).every((item) => item.value)).toBe(true)
    expect(session.items.value.filter((item) => !item.required).every((item) => !item.value)).toBe(true)
    expect(session.requiredOk.value).toBe(true)

    expect(await session.submitConsent()).toBe(true)
    expect(session.consented.value).toBe(true)
    expect(posted).toEqual({
      version: 'v2',
      items: { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false },
    })
  })

  it('session store：登录成功后按 consentRequired 决定是否先去同意页', async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(ME))
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()
    expect(await session.login({ inviteCode: 'ABC123', studentNo: '2026001' })).toBe(true)
    expect(session.loggedIn.value).toBe(true)
    expect(session.consented.value).toBe(false)
    expect(session.me.value?.anonCode).toBe('S-TEST')
  })

  it('每个用户动作生成新幂等键：两次相同请求也不同（不重放旧响应）', async () => {
    const state = mockState()
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ state }))
    configureClientForTests({ fetchImpl, mock: false })
    const started = await startAttempt('22222222-2222-4222-8222-222222222222')
    expect(started.attemptId).toBe(state.attemptId)
    await startAttempt('22222222-2222-4222-8222-222222222222')
    const firstKey = headersOf(calls[0] as Call)['Idempotency-Key']
    const secondKey = headersOf(calls[1] as Call)['Idempotency-Key']
    expect(firstKey).toMatch(UUID_RE)
    expect(secondKey).toMatch(UUID_RE)
    expect(secondKey).not.toBe(firstKey)
    expect(calls[0]?.url).toContain('/student/assignments/22222222-2222-4222-8222-222222222222/attempt')
  })

  it('definition / lines / finish / skip 带 If-Match 与契约请求体', async () => {
    const state = mockState()
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ state: { ...state, stateVersion: state.stateVersion + 1 } }))
    configureClientForTests({ fetchImpl, mock: false })

    await submitDef(state, '任取 $\varepsilon>0$', { draftId: '44444444-4444-4444-8444-444444444444' })
    await addLine(state, draft())
    await finishSteps(state)
    await skipLayer(state, 'L1')

    expect(calls.map((call) => call.url.replace('/api/v1', ''))).toEqual([
      '/attempts/11111111-1111-4111-8111-111111111111/definition',
      '/attempts/11111111-1111-4111-8111-111111111111/lines',
      '/attempts/11111111-1111-4111-8111-111111111111/finish',
      '/attempts/11111111-1111-4111-8111-111111111111/layers/L1/skip',
    ])
    expect(calls[0]?.body).toEqual({
      text: '任取 $\varepsilon>0$',
      input: { provenance: 'keyboard', draftId: '44444444-4444-4444-8444-444444444444' },
    })
    expect(headersOf(calls[0] as Call)['If-Match']).toBe(String(state.stateVersion))
    const lineBody = calls[1]?.body as { statement: string; justification?: string; input: { draftId: string } }
    expect(lineBody.statement).toBe('任取 $\varepsilon>0$')
    expect(lineBody.justification).toBe('由定义')
    expect(lineBody.input.draftId).toBe('33333333-3333-4333-8333-333333333333')
    expect(headersOf(calls[2] as Call)['Content-Type']).toBeUndefined()
    expect(headersOf(calls[2] as Call)['If-Match']).toBe(String(state.stateVersion))
    expect(headersOf(calls[3] as Call)['Idempotency-Key']).toMatch(UUID_RE)
  })

  it('409 STATE_STALE：把 detail.state 作为最新状态返回', async () => {
    const state = mockState()
    const latest: AttemptState = { ...state, stateVersion: state.stateVersion + 1 }
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ error: { code: 'STATE_STALE', message: '状态已更新', detail: { state: latest } } }, 409),
    )
    configureClientForTests({ fetchImpl, mock: false })

    const next = await submitDef(state, '写一行')
    expect(next.stateVersion).toBe(latest.stateVersion)
    expect(consumeStateStaleFlag()).toBe(true)
    expect(consumeStateStaleFlag()).toBe(false)
  })

  it('ASSIGNMENT_CLOSED 作为不可重试终态抛出（不触发自动重试）', async () => {
    const state = mockState()
    const { calls, fetchImpl } = captureFetch(() =>
      jsonResponse({ error: { code: 'ASSIGNMENT_CLOSED', message: '布置已关闭，作答为只读' } }, 409),
    )
    configureClientForTests({ fetchImpl, mock: false })

    const error = (await addLine(state, draft()).catch((reason: unknown) => reason)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('ASSIGNMENT_CLOSED')
    expect(error.terminal).toBe(true)
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('弱网（网络失败一次）自动重试一次，且重试复用同一个幂等键', async () => {
    const state = mockState()
    let attempts = 0
    const { calls, fetchImpl } = captureFetch(() => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return jsonResponse({ state })
    })
    configureClientForTests({ fetchImpl, mock: false })

    const next = await submitDef(state, '任取 $\varepsilon>0$', { draftId: '55555555-5555-4555-8555-555555555555' })
    expect(next.attemptId).toBe(state.attemptId)
    expect(calls).toHaveLength(2)
    expect(headersOf(calls[1] as Call)['Idempotency-Key']).toBe(headersOf(calls[0] as Call)['Idempotency-Key'])
    expect(headersOf(calls[1] as Call)['If-Match']).toBe(String(state.stateVersion))
  })

  it('/help 与 /hints/claim 按契约调用并返回最新 state', async () => {
    const state = createMockState('l3-active')
    const latest: AttemptState = { ...state, stateVersion: state.stateVersion + 1 }
    const note = { noteId: '00000000-0000-4000-8000-0000000000aa', kind: 'refusal' as const, who: '系统', text: '不能直接给答案，我们先看清定义。', at: new Date().toISOString() }
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/help')) return jsonResponse({ routed: 'pressure', note, state: latest })
      if (call.url.endsWith('/hints/claim')) return jsonResponse({ routed: 'stuck', state: latest })
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })

    const help = await requestHelp(state, 'free', '直接告诉我完整证明')
    expect(calls[0]?.body).toEqual({ intent: 'free', text: '直接告诉我完整证明' })
    expect(help.routed).toBe('pressure')
    expect(help.note?.text).toContain('不能直接给答案')

    const preview = {
      level: 'H2' as const,
      cost: 0.5,
      revealAfter: 1,
      allowed: true,
      previewToken: 'token-1',
      reason: null,
      waitSec: null,
      softLanding: [],
    }
    const next = await claimHint(state, preview)
    expect(calls[1]?.body).toEqual({ previewToken: 'token-1' })
    expect(next.stateVersion).toBe(latest.stateVersion)
  })

  it('真实模式：GET /student/home + /me 映射成首页视图', async () => {
    const { fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/student/home')) {
        return jsonResponse({
          inProgress: [
            {
              assignmentId: '22222222-2222-4222-8222-222222222222',
              title: '数列极限 · ε-N',
              mode: 'practice',
              status: 'open',
              attemptId: '33333333-3333-4333-8333-333333333333',
              currentLayer: 'L3',
            },
          ],
          todo: [],
          done: [],
          week: { keysOwn: 2, keysTotal: 4, problemsDone: 1 },
        })
      }
      if (call.url.endsWith('/me')) return jsonResponse({ ...ME, consentRequired: false })
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })

    const home = await fetchHome()
    // 没有昵称时叫“同学”，不显示匿名码（design-spec：nickname never anon code）。
    expect(home.greeting).not.toContain('S-TEST')
    expect(home.greeting).toBe('同学，你好')
    expect(home.week).toEqual({ keysOwn: 2, keysTotal: 4, problemsDone: 1 })
    expect(home.notebook).toBeNull()
    expect(home.inProgress[0]?.assignmentId).toBe('22222222-2222-4222-8222-222222222222')
    expect(home.inProgress[0]?.attemptId).toBe('33333333-3333-4333-8333-333333333333')
    expect(home.inProgress[0]?.currentLayer).toBe('L3')
    expect(home.todo).toEqual([])
    expect(home.done).toEqual([])
  })

  it('mock 模式保留：首页与状态 reducer 不发请求', async () => {
    let called = false
    configureClientForTests({
      mock: true,
      fetchImpl: async () => {
        called = true
        return jsonResponse({})
      },
    })
    expect(isMockMode()).toBe(true)
    const mockHomeData = await fetchHome()
    expect(mockHomeData.inProgress[0]?.title).toBe(mockHome.inProgress[0]?.title)
    expect(mockHomeData.todo.length).toBeGreaterThan(0)
    expect(mockHomeData.done.some((card) => card.reviewPublished === true)).toBe(true)
    expect(mockHomeData.notebook).toBeNull()
    const next = await submitDef(mockState(), '任取 ε>0')
    expect(next.currentLayer).toBe('L2')
    expect(called).toBe(false)
  })

  it('两个相同 body 的 requestHelp 动作使用不同幂等键（审计复现用例）', async () => {
    const state = createMockState('l3-active')
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ routed: 'stuck', state }))
    configureClientForTests({ fetchImpl, mock: false })
    await requestHelp(state, 'stuck')
    await requestHelp(state, 'stuck')
    const firstKey = headersOf(calls[0] as Call)['Idempotency-Key']
    const secondKey = headersOf(calls[1] as Call)['Idempotency-Key']
    expect(firstKey).toMatch(UUID_RE)
    expect(secondKey).toMatch(UUID_RE)
    expect(secondKey).not.toBe(firstKey)
    expect(calls[0]?.body).toEqual({ intent: 'stuck' })
    expect(calls[1]?.body).toEqual({ intent: 'stuck' })
  })

  it('同一次 requestHelp 的 withRetry 重试复用同一个幂等键', async () => {
    const state = createMockState('l3-active')
    let attempts = 0
    const { calls, fetchImpl } = captureFetch(() => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return jsonResponse({ routed: 'stuck', state })
    })
    configureClientForTests({ fetchImpl, mock: false })
    await requestHelp(state, 'stuck')
    expect(calls).toHaveLength(2)
    expect(headersOf(calls[1] as Call)['Idempotency-Key']).toBe(headersOf(calls[0] as Call)['Idempotency-Key'])
    expect(calls[1]?.body).toEqual({ intent: 'stuck' })
  })

  it('离线同意书 fallback 只有占位正文，不复制服务端文本', () => {
    expect(mockConsentDoc.version).toBe('v2')
    expect(MOCK_CONSENT_SECTIONS.map((section) => section.key)).toEqual(CONSENT_KEYS)
    for (const section of MOCK_CONSENT_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0)
      expect(section.body).toBe(CONSENT_PLACEHOLDER_BODY)
    }
    expect(CONSENT_PLACEHOLDER_BODY).toContain('服务端')
  })

  it('deviceId 走 uni 存储（业务代码不直接用 localStorage）', () => {
    const stored = '99999999-9999-4999-8999-999999999999'
    const writes: Array<{ key: string; value: unknown }> = []
    ;(globalThis as { uni?: unknown }).uni = {
      getStorageSync: (key: string) => (key === 'pg.deviceId' ? stored : ''),
      setStorageSync: (key: string, value: unknown) => {
        writes.push({ key, value })
      },
    }
    try {
      expect(getDeviceId()).toBe(stored)
    } finally {
      delete (globalThis as { uni?: unknown }).uni
    }
    expect(writes).toEqual([])
  })
})
