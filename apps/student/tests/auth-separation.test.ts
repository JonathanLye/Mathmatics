import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetClientForTests, configureClientForTests, getMe, startAttempt } from '@/api/client'
import { createHttpClient, setAuthLostHandler } from '@/api/http'
import { __resetSessionForTests, AUTH_EXPIRED_TOAST, useSession } from '@/stores/session'
import type { MeView } from '@/types/attempt'

// 学生端与教师端会话分离（task 2）：每个请求带 X-Pg-App: student；401 / wrong_app 403 统一回登录页；
// restore() 只认学生身份。

const ME: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-TEST',
  displayName: null,
  classes: [],
  consentRequired: false,
  ageBand: 'ge18',
  features: {},
}

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface UniStub {
  showToast: ReturnType<typeof vi.fn>
  reLaunch: ReturnType<typeof vi.fn>
}

function stubUni(route = 'pages/home/index'): UniStub {
  const stub: UniStub = { showToast: vi.fn(), reLaunch: vi.fn() }
  ;(globalThis as { uni?: unknown }).uni = stub
  ;(globalThis as { getCurrentPages?: unknown }).getCurrentPages = () => [{ route }]
  return stub
}

beforeEach(() => {
  __resetSessionForTests()
})

afterEach(() => {
  delete (globalThis as { uni?: unknown }).uni
  delete (globalThis as { getCurrentPages?: unknown }).getCurrentPages
  __resetClientForTests()
  __resetSessionForTests()
  vi.restoreAllMocks()
})

describe('X-Pg-App 端标识', () => {
  it('GET 和写请求都带 X-Pg-App: student', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchImpl = async (_url: string, init: RequestInit = {}) => {
      seen.push(init.headers as Record<string, string>)
      return jsonResponse({})
    }
    const client = createHttpClient({ fetchImpl })
    await client.get('/me')
    await client.post('/auth/logout')
    expect(seen).toHaveLength(2)
    for (const headers of seen) expect(headers['X-Pg-App']).toBe('student')
  })

  it('调用方传入的头不会覆盖端标识以外的默认头', async () => {
    let headers: Record<string, string> = {}
    const client = createHttpClient({
      fetchImpl: async (_url, init = {}) => {
        headers = init.headers as Record<string, string>
        return jsonResponse({})
      },
    })
    await client.get('/x', { headers: { 'X-Extra': '1' } })
    expect(headers['X-Pg-App']).toBe('student')
    expect(headers['X-Extra']).toBe('1')
  })
})

describe('登录失效统一回登录页', () => {
  it('非登录类接口 401：清会话、提示“登录已过期，请重新登录”、reLaunch 到登录页', async () => {
    const uni = stubUni()
    configureClientForTests({
      fetchImpl: async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401),
      mock: false,
    })
    const session = useSession()
    session.me.value = ME
    session.loggedIn.value = true

    await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ status: 401 })
    expect(session.loggedIn.value).toBe(false)
    expect(session.me.value).toBeNull()
    expect(uni.showToast).toHaveBeenCalledWith({ title: AUTH_EXPIRED_TOAST, icon: 'none' })
    expect(AUTH_EXPIRED_TOAST).toBe('登录已过期，请重新登录')
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('403 且 detail.reason = wrong_app（浏览器里只有教师端会话）同样回登录页', async () => {
    const uni = stubUni()
    configureClientForTests({
      fetchImpl: async () =>
        jsonResponse({ error: { code: 'FORBIDDEN', message: '请用学生账号登录', detail: { reason: 'wrong_app' } } }, 403),
      mock: false,
    })
    await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ status: 403 })
    expect(uni.reLaunch).toHaveBeenCalledTimes(1)
  })

  it('业务 403（同意书、年龄门）不跳登录', async () => {
    const uni = stubUni()
    configureClientForTests({
      fetchImpl: async () => jsonResponse({ error: { code: 'CONSENT_REQUIRED', message: '请先阅读并签署知情同意书' } }, 403),
      mock: false,
    })
    await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
    expect(uni.reLaunch).not.toHaveBeenCalled()
    expect(uni.showToast).not.toHaveBeenCalled()
  })

  it('/me、登录、退出自己处理 401，不触发统一跳转', async () => {
    const uni = stubUni()
    const handler = vi.fn()
    setAuthLostHandler(handler)
    try {
      const client = createHttpClient({
        fetchImpl: async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401),
      })
      await expect(client.get('/me')).rejects.toMatchObject({ status: 401 })
      await expect(client.post('/auth/student/login', {})).rejects.toMatchObject({ status: 401 })
      await expect(client.post('/auth/logout')).rejects.toMatchObject({ status: 401 })
      expect(handler).not.toHaveBeenCalled()
      await expect(client.get('/student/home?x=1')).rejects.toMatchObject({ status: 401 })
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler.mock.calls[0]?.[0]).toMatchObject({ status: 401, path: '/student/home' })
    } finally {
      // 恢复 stores/session.ts 登记的真处理函数，避免影响同文件后面的用例。
      const { handleAuthLost } = await import('@/stores/session')
      setAuthLostHandler(handleAuthLost)
    }
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('已经在登录页或镜像页：只清状态，不再跳转、不弹提示', async () => {
    for (const route of ['pages/login/index', 'pages/mirror/index']) {
      const uni = stubUni(route)
      configureClientForTests({
        fetchImpl: async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401),
        mock: false,
      })
      await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ status: 401 })
      expect(uni.reLaunch, route).not.toHaveBeenCalled()
      expect(uni.showToast, route).not.toHaveBeenCalled()
    }
  })

  it('同时失败的多个请求只跳一次', async () => {
    const uni = stubUni()
    configureClientForTests({
      fetchImpl: async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401),
      mock: false,
    })
    await Promise.allSettled([startAttempt(ATTEMPT_ID), startAttempt(ATTEMPT_ID), startAttempt(ATTEMPT_ID)])
    expect(uni.reLaunch).toHaveBeenCalledTimes(1)
  })
})

describe('restore() 只认学生身份', () => {
  it('/me 返回学生：恢复登录态', async () => {
    configureClientForTests({ fetchImpl: async () => jsonResponse(ME), mock: false })
    const session = useSession()
    expect(await session.restore()).toBe(true)
    expect(session.loggedIn.value).toBe(true)
    expect(session.me.value?.role).toBe('student')
  })

  it('/me 返回教师或管理员：清状态、留在登录页（返回 false，不跳转）', async () => {
    const uni = stubUni('pages/login/index')
    for (const role of ['teacher', 'admin'] as const) {
      configureClientForTests({ fetchImpl: async () => jsonResponse({ ...ME, role }), mock: false })
      const session = useSession()
      expect(await session.restore(), role).toBe(false)
      expect(session.loggedIn.value).toBe(false)
      expect(session.me.value).toBeNull()
    }
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('/me 401：返回 false，登录页不弹“登录已过期”', async () => {
    const uni = stubUni('pages/login/index')
    configureClientForTests({
      fetchImpl: async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, 401),
      mock: false,
    })
    expect(await useSession().restore()).toBe(false)
    expect(uni.showToast).not.toHaveBeenCalled()
    await expect(getMe()).rejects.toMatchObject({ status: 401 })
  })
})
