import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetClientForTests,
  configureClientForTests,
  consumeRewards,
  fetchMistakes,
  fetchProgress,
  fetchReview,
  fetchSettings,
  sendFeedback,
  skipLayer,
  startRedo,
  updateSettings,
} from '@/api/client'
import { createMockState } from '@/mocks/attemptStates'

// Task 6 / 9 的真实接口客户端：路径、方法、请求体与 rewards 交接。

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

beforeEach(() => {
  __resetClientForTests()
})

describe('重做与错题本（真实接口）', () => {
  it('startRedo：POST /student/attempts/{id}/redo，返回 redo 作答；缺少 id 报 422', async () => {
    const redo = { ...createMockState('l1-active'), kind: 'redo' as const }
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ state: redo }))
    configureClientForTests({ fetchImpl, mock: false })
    const next = await startRedo('11111111-1111-4111-8111-111111111111')
    expect(next.kind).toBe('redo')
    expect(calls[0]?.url).toBe('/api/v1/student/attempts/11111111-1111-4111-8111-111111111111/redo')
    expect(calls[0]?.init.method).toBe('POST')
    await expect(startRedo()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('fetchMistakes / fetchReview 走 GET', async () => {
    const { calls, fetchImpl } = captureFetch((call) =>
      call.url.endsWith('/mistakes') ? jsonResponse({ groups: [], total: 0 }) : jsonResponse({ proofs: ['证明'], note: '讲评' }),
    )
    configureClientForTests({ fetchImpl, mock: false })
    expect(await fetchMistakes()).toEqual({ groups: [], total: 0 })
    expect((await fetchReview('abc')).note).toBe('讲评')
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/student/mistakes', '/api/v1/attempts/abc/review'])
  })

  it('mock 模式的错题本与 startRedo 可用', async () => {
    expect((await fetchMistakes()).groups.length).toBeGreaterThan(0)
    expect((await startRedo('x')).kind).toBe('redo')
  })
})

describe('进度、设置、反馈、rewards（真实接口）', () => {
  it('进度与设置', async () => {
    const settings = { nickname: '小明', dailyGoal: 3, defaultInput: 'hand', theme: 'dark', sound: true, motion: true, haptics: true, onboarding: {} }
    const { calls, fetchImpl } = captureFetch((call) =>
      call.url.endsWith('/progress') ? jsonResponse({ xpTotal: 1, week: [] }) : jsonResponse(settings),
    )
    configureClientForTests({ fetchImpl, mock: false })
    expect((await fetchProgress()).xpTotal).toBe(1)
    expect((await fetchSettings()).theme).toBe('dark')
    expect((await updateSettings({ theme: 'dark' })).nickname).toBe('小明')
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', '/api/v1/student/progress'],
      ['GET', '/api/v1/student/settings'],
      ['PATCH', '/api/v1/student/settings'],
    ])
    expect(calls[2]?.body).toEqual({ theme: 'dark' })
  })

  it('反馈：POST 请求体与幂等键', async () => {
    const { calls, fetchImpl } = captureFetch(() => new Response(null, { status: 204 }))
    configureClientForTests({ fetchImpl, mock: false })
    await sendFeedback('bug', '键盘打不出分数线', '/pages/practice/index')
    expect(calls[0]?.body).toEqual({ kind: 'bug', body: '键盘打不出分数线', page: '/pages/practice/index' })
    expect((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
  })

  it('作答写接口的 rewards 由 consumeRewards 取走一次', async () => {
    const state = createMockState('l1-active')
    const rewards = { xp: 15, items: [{ kind: 'key_own', amount: 10, label: '独立写出关键步骤' }], badges: [] }
    let withRewards = true
    const { fetchImpl } = captureFetch(() => jsonResponse(withRewards ? { state, rewards } : { state }))
    configureClientForTests({ fetchImpl, mock: false })
    await skipLayer(state, 'L1')
    expect(consumeRewards()).toEqual(rewards)
    expect(consumeRewards()).toBeNull()
    withRewards = false
    await skipLayer(state, 'L1')
    expect(consumeRewards()).toBeNull()
  })

  it('mock 模式有可用的进度与设置', async () => {
    expect((await fetchProgress()).streak.current).toBeGreaterThan(0)
    expect((await updateSettings({ nickname: '  阿花 ' })).nickname).toBe('阿花')
  })
})
