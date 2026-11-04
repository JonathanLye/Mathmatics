/**
 * 年龄分档 / guardianNotice 单测（issue #145，契约见 #131 与 13 §4）。
 *
 * 覆盖：
 * 1) 纯逻辑：ageBand 解析、路由守卫结论、?next= 白名单、guardianNotice 只读判定、错误码文案；
 * 2) session store（真实模式，注入假 fetch）：null→need-age、14to17→ok、guardianNotice 只读且不参与签署、
 *    提交年龄的 POST body、409 AGE_BAND_LOCKED 文案、字段缺失→unknown 不拦截；
 * 3) mock 客户端：默认 ge18 不阻塞既有流程、?ageBand 覆盖、只能设置一次（409）、14to17 的 /consents 多一段。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ApiError,
  MOCK_DEFAULT_AGE_BAND,
  __resetClientForTests,
  __resetMockAgeBandForTests,
  __setMockAgeBandForTests,
  configureClientForTests,
  errorMessage,
  getConsents,
  getMe,
  isMockMode,
  login,
  setStudentAgeBand,
} from '@/api/client'
import {
  AGE_BAND_LOCKED_MESSAGE,
  AGE_BAND_LT14_RISK,
  ageBandErrorMessage,
  ageBandFromQuery,
  ageBandLabel,
  ageGateAllows,
  ageGateFor,
  currentHashRoute,
  isReadOnlyConsentSection,
  parseAgeBand,
  safeNextRoute,
} from '@/auth/ageBand'
import { __resetSessionForTests, useSession } from '@/stores/session'
import type { ConsentChoices, MeView } from '@/types/attempt'

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

const CONSENT_KEYS = ['service', 'crossBorderHosting', 'crossBorderModel', 'monitoring', 'research']

const CONSENT_DOC = {
  version: 'p0-v1',
  sections: [
    { key: 'service', title: '服务所需处理', body: '正文 A', required: true },
    { key: 'crossBorderHosting', title: '中国香港服务器', body: '正文 B', required: true },
    { key: 'crossBorderModel', title: '境外决策模型（可选）', body: '正文 C', required: false },
    { key: 'monitoring', title: '过程监测', body: '正文 D', required: true },
    { key: 'research', title: '教研使用（可选）', body: '正文 E', required: false },
  ],
  signed: null,
}

const GUARDIAN_NOTICE = {
  key: 'guardianNotice',
  title: '建议告知监护人（14–17 岁）',
  body: '只读说明正文（测试用）',
  required: false,
}

beforeEach(() => {
  __resetClientForTests()
  __resetSessionForTests()
  __resetMockAgeBandForTests()
})

describe('年龄分档纯逻辑', () => {
  it('parseAgeBand：合法档位 / 显式 null / 缺失或非法', () => {
    expect(parseAgeBand('ge18')).toBe('ge18')
    expect(parseAgeBand('14to17')).toBe('14to17')
    expect(parseAgeBand('lt14')).toBe('lt14')
    expect(parseAgeBand(null)).toBeNull()
    expect(parseAgeBand(undefined)).toBeUndefined()
    expect(parseAgeBand('18')).toBeUndefined()
    expect(parseAgeBand(18)).toBeUndefined()
  })

  it('ageGateFor：null→need-age、lt14→blocked、14to17/ge18→ok、缺失→unknown（不误伤旧服务端）', () => {
    expect(ageGateFor(null)).toBe('need-age')
    expect(ageGateFor('lt14')).toBe('blocked')
    expect(ageGateFor('14to17')).toBe('ok')
    expect(ageGateFor('ge18')).toBe('ok')
    expect(ageGateFor(undefined)).toBe('unknown')
    expect(ageGateFor('whatever')).toBe('unknown')
    expect(ageGateAllows(undefined)).toBe(true)
    expect(ageGateAllows('lt14')).toBe(false)
  })

  it('ageBandLabel / <14 风险说明 / 错误码文案', () => {
    expect(ageBandLabel(null)).toBe('未选择')
    expect(ageBandLabel('ge18')).toContain('18')
    expect(AGE_BAND_LT14_RISK).toContain('未满 14 岁')
    expect(AGE_BAND_LT14_RISK).toContain('监护人')
    expect(ageBandErrorMessage('AGE_BAND_REQUIRED')).toContain('请先选择年龄分段')
    expect(ageBandErrorMessage('AGE_RESTRICTED')).toContain('暂不开通')
    expect(ageBandErrorMessage('AGE_BAND_LOCKED')).toBe(AGE_BAND_LOCKED_MESSAGE)
    expect(ageBandErrorMessage('INTERNAL')).toBeNull()
  })

  it('?ageBand= 解析（e2e/mock 用）', () => {
    expect(ageBandFromQuery('?ageBand=null')).toBeNull()
    expect(ageBandFromQuery('ageBand=lt14')).toBe('lt14')
    expect(ageBandFromQuery('?mock=l3-active&ageBand=14to17')).toBe('14to17')
    expect(ageBandFromQuery('?mock=l3-active')).toBeUndefined()
    expect(ageBandFromQuery('?ageBand=bogus')).toBeUndefined()
  })

  it('safeNextRoute：只允许应用内页面，防开放重定向', () => {
    expect(safeNextRoute('/pages/practice/index?mock=l3-active')).toBe('/pages/practice/index?mock=l3-active')
    expect(safeNextRoute(encodeURIComponent('/pages/consent/index'))).toBe('/pages/consent/index')
    expect(safeNextRoute('#/pages/home/index')).toBe('/pages/home/index')
    expect(safeNextRoute('https://evil.example/pages/home/index')).toBeNull()
    expect(safeNextRoute('//evil.example/pages/home/index')).toBeNull()
    expect(safeNextRoute('pages/home/index')).toBeNull()
    expect(safeNextRoute('')).toBeNull()
    expect(safeNextRoute(undefined)).toBeNull()
  })

  it('currentHashRoute：给守卫记录原目标', () => {
    expect(currentHashRoute({ hash: '#/pages/practice/index?mock=l3-active' })).toBe('/pages/practice/index?mock=l3-active')
    expect(currentHashRoute({ hash: '' })).toBe('')
  })

  it('guardianNotice 是只读说明段（不签名）', () => {
    expect(isReadOnlyConsentSection('guardianNotice')).toBe(true)
    expect(isReadOnlyConsentSection('service')).toBe(false)
  })

  it('写接口 403 AGE_RESTRICTED / 409 AGE_BAND_REQUIRED 统一文案与可重试/终态标记', () => {
    const restricted = new ApiError({ status: 403, code: 'AGE_RESTRICTED', message: '原始文案' })
    expect(errorMessage(restricted)).toContain('未满 14 岁')
    expect(restricted.terminal).toBe(true)
    expect(restricted.retryable).toBe(false)

    const required = new ApiError({ status: 409, code: 'AGE_BAND_REQUIRED', message: '原始文案' })
    expect(errorMessage(required)).toContain('请先选择年龄分段')
    // 未分档是「先选档再继续」，不是终态
    expect(required.terminal).toBe(false)
  })
})

describe('session store（真实模式）', () => {
  it('Me.ageBand=null → ensureAgeBand 返回 need-age（同意/练习前必须先去选年龄）', async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ ...ME, ageBand: null }))
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()
    expect(await session.login('ABC123', '2026001')).toBe(true)
    expect(session.ageBand.value).toBeNull()
    expect(await session.ensureAgeBand()).toBe('need-age')
  })

  it('14to17：guardianNotice 只读、不参与 signed choices；POST /consents 仍只有 5 个可签键', async () => {
    let posted: { version: string; items: ConsentChoices } | null = null
    const { fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/me')) return jsonResponse({ ...ME, ageBand: '14to17' })
      if (call.url.endsWith('/consents') && call.init.method === 'GET') {
        return jsonResponse({ ...CONSENT_DOC, sections: [...CONSENT_DOC.sections, GUARDIAN_NOTICE] })
      }
      if (call.url.endsWith('/consents') && call.init.method === 'POST') {
        posted = call.body as { version: string; items: ConsentChoices }
        return jsonResponse({ ...ME, ageBand: '14to17', consentRequired: false })
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()

    expect(await session.refreshMe()).not.toBeNull()
    expect(await session.ensureAgeBand()).toBe('ok')

    expect(await session.loadConsentDoc()).toBe(true)
    const notice = session.items.value.find((item) => item.id === 'guardianNotice')
    expect(notice?.readOnly).toBe(true)
    expect(notice?.required).toBe(false)
    expect(notice?.value).toBe(false)
    expect(session.items.value).toHaveLength(6)
    expect(session.requiredOk.value).toBe(true)

    expect(await session.submitConsent()).toBe(true)
    expect(posted).not.toBeNull()
    const payload = posted as unknown as { version: string; items: Record<string, boolean> }
    expect(Object.keys(payload.items)).toEqual(CONSENT_KEYS)
    expect(payload.items.guardianNotice).toBeUndefined()
    expect(Object.keys(payload.items)).toHaveLength(5)
  })

  it('submitAgeBand：POST /auth/student/age-band body {ageBand}，成功后刷新 Me', async () => {
    const { calls, fetchImpl } = captureFetch((call) => {
      if (call.url.endsWith('/auth/student/age-band')) return jsonResponse({ ...ME, ageBand: 'ge18' })
      if (call.url.endsWith('/me')) return jsonResponse({ ...ME, ageBand: 'ge18' })
      return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有这个接口' } }, 404)
    })
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()

    const me = await session.submitAgeBand('ge18')
    expect(me.ageBand).toBe('ge18')
    expect(session.ageBand.value).toBe('ge18')
    const post = calls.find((call) => call.url.endsWith('/auth/student/age-band'))
    expect(post?.init.method).toBe('POST')
    expect(post?.url).toBe('/api/v1/auth/student/age-band')
    expect(post?.body).toEqual({ ageBand: 'ge18' })
    // 成功后刷新 Me（GET /me 至少一次）
    expect(calls.some((call) => call.url.endsWith('/me'))).toBe(true)
  })

  it('409 AGE_BAND_LOCKED：不伪造成功，errorMessage 给「如需修改请联系老师」', async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ error: { code: 'AGE_BAND_LOCKED', message: '已记录' } }, 409),
    )
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()
    const error = (await session.submitAgeBand('ge18').catch((reason: unknown) => reason)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('AGE_BAND_LOCKED')
    expect(errorMessage(error)).toBe(AGE_BAND_LOCKED_MESSAGE)
    expect(session.error.value).toBe(AGE_BAND_LOCKED_MESSAGE)
  })

  it('Me 缺 ageBand（旧服务端/测试桩）→ unknown，不拦截既有流程', async () => {
    const withoutAgeBand = { ...ME } as Record<string, unknown>
    delete withoutAgeBand.ageBand
    const { fetchImpl } = captureFetch(() => jsonResponse(withoutAgeBand))
    configureClientForTests({ fetchImpl, mock: false })
    const session = useSession()
    expect(await session.refreshMe()).not.toBeNull()
    expect(await session.ensureAgeBand()).toBe('unknown')
  })
})

describe('mock 客户端（#145）', () => {
  it('默认 ageBand=ge18，不阻塞既有 mock 演示/e2e', async () => {
    configureClientForTests({ mock: true })
    expect(isMockMode()).toBe(true)
    expect(MOCK_DEFAULT_AGE_BAND).toBe('ge18')
    const me = await getMe()
    expect(me.ageBand).toBe('ge18')
  })

  it('?ageBand 覆盖（null → need-age）与登录返回同一覆盖值', async () => {
    configureClientForTests({ mock: true })
    __setMockAgeBandForTests(null)
    expect((await getMe()).ageBand).toBeNull()
    expect(ageGateFor((await login('ABC123', '2026001')).ageBand)).toBe('need-age')
  })

  it('年龄只能设置一次：首次成功、再次 409 AGE_BAND_LOCKED', async () => {
    configureClientForTests({ mock: true })
    __setMockAgeBandForTests(null)
    const me = await setStudentAgeBand('14to17')
    expect(me.ageBand).toBe('14to17')
    expect((await getMe()).ageBand).toBe('14to17')
    const error = (await setStudentAgeBand('ge18').catch((reason: unknown) => reason)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('AGE_BAND_LOCKED')
    expect(ageBandErrorMessage(error.code)).toBe(AGE_BAND_LOCKED_MESSAGE)
  })

  it('14to17 的 mock GET /consents 多一段 guardianNotice（required=false）；其他档位不变', async () => {
    configureClientForTests({ mock: true })
    __setMockAgeBandForTests('14to17')
    const teenDoc = await getConsents()
    expect(teenDoc.sections).toHaveLength(6)
    const guardian = teenDoc.sections.find((section) => section.key === 'guardianNotice')
    expect(guardian?.required).toBe(false)
    expect(guardian?.body).toContain('服务端')

    __resetMockAgeBandForTests()
    const adultDoc = await getConsents()
    expect(adultDoc.sections.map((section) => section.key)).toEqual(CONSENT_KEYS)
  })

  it('非法档位直接拒绝（不发请求、不伪造成功）', async () => {
    configureClientForTests({ mock: true })
    const error = (await setStudentAgeBand('18' as never).catch((reason: unknown) => reason)) as ApiError
    expect(error.code).toBe('VALIDATION_FAILED')
  })
})
