import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetClientForTests, configureClientForTests, login, startAttempt } from '@/api/client'
import { planAfterLogin } from '@/auth/afterLogin'
import { buildLoginCredentials, FORGOT_PASSWORD_HELP, initialLoginMode } from '@/auth/loginForm'
import { __resetSessionForTests, useSession } from '@/stores/session'
import type { MeView } from '@/types/attempt'

// 学生密码（task 3）：登录表单的模式切换与取值、登录请求体、PASSWORD_SETUP_REQUIRED 的路由、设密码后的去向。

const ME: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-TEST',
  displayName: null,
  classes: [],
  consentRequired: true,
  ageBand: null,
  features: {},
}
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubUni(route = 'pages/home/index') {
  const stub = { showToast: vi.fn(), reLaunch: vi.fn() }
  ;(globalThis as { uni?: unknown }).uni = stub
  ;(globalThis as { getCurrentPages?: unknown }).getCurrentPages = () => [{ route }]
  return stub
}

beforeEach(() => __resetSessionForTests())
afterEach(() => {
  delete (globalThis as { uni?: unknown }).uni
  delete (globalThis as { getCurrentPages?: unknown }).getCurrentPages
  __resetClientForTests()
  __resetSessionForTests()
})

describe('登录表单：模式与取值', () => {
  it('默认学号 + 密码；链接带邀请码或离线演示模式时默认邀请码 + 学号', () => {
    expect(initialLoginMode({ mock: false, inviteFromLink: '' })).toBe('password')
    expect(initialLoginMode({ mock: false, inviteFromLink: 'K7Q2MX' })).toBe('invite')
    expect(initialLoginMode({ mock: true, inviteFromLink: '' })).toBe('invite')
  })

  it('密码模式：要学号和密码，只发这两项；密码不 trim', () => {
    expect(buildLoginCredentials('password', { invite: 'K7Q2MX', studentNo: ' 2026001 ', password: ' pw with space ' })).toEqual({
      ok: true,
      credentials: { studentNo: '2026001', password: ' pw with space ' },
    })
    expect(buildLoginCredentials('password', { invite: '', studentNo: '2026001', password: '' })).toEqual({ ok: false, error: '请输入密码' })
    expect(buildLoginCredentials('password', { invite: '', studentNo: ' ', password: 'x' })).toEqual({ ok: false, error: '请输入学号' })
  })

  it('邀请码模式：要 6 位邀请码和学号，不带密码', () => {
    expect(buildLoginCredentials('invite', { invite: 'K7Q2MX', studentNo: '2026001', password: 'ignored' })).toEqual({
      ok: true,
      credentials: { inviteCode: 'K7Q2MX', studentNo: '2026001' },
    })
    expect(buildLoginCredentials('invite', { invite: 'K7', studentNo: '2026001', password: '' }).ok).toBe(false)
  })

  it('忘记密码的说明：找老师重置，之后用邀请码重新激活', () => {
    expect(FORGOT_PASSWORD_HELP).toContain('老师')
    expect(FORGOT_PASSWORD_HELP).toContain('重置')
    expect(FORGOT_PASSWORD_HELP).toContain('邀请码')
  })
})

describe('登录后的去向 planAfterLogin', () => {
  it('needsPassword → 先去设密码页；设好之后（needsPassword=false）再走年龄 → 同意书 → 首页', () => {
    expect(planAfterLogin({ ...ME, needsPassword: true }, false)).toEqual({ url: '/pages/set-password/index', pending: '' })
    expect(planAfterLogin({ ...ME, needsPassword: false }, false)).toEqual({ url: '/pages/age/index', pending: '/pages/consent/index' })
    expect(planAfterLogin({ ...ME, needsPassword: false, ageBand: 'ge18' }, false)).toEqual({ url: '/pages/consent/index', pending: '' })
    expect(planAfterLogin({ ...ME, ageBand: 'ge18', consentRequired: false }, true)).toEqual({ url: '/pages/home/index', pending: '' })
  })
})

describe('登录请求与会话', () => {
  it('学号 + 密码：请求体不带邀请码；邀请码 + 学号：不带密码；needsPassword 记在会话里', async () => {
    const bodies: Array<Record<string, unknown>> = []
    configureClientForTests({
      fetchImpl: async (_url, init = {}) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return json({ ...ME, needsPassword: bodies.length >= 2 })
      },
      mock: false,
    })
    await login({ studentNo: '2026001', password: 'correct horse' })
    await login({ studentNo: '2026001', inviteCode: 'K7Q2MX' })
    expect(bodies[0]).toMatchObject({ studentNo: '2026001', password: 'correct horse' })
    expect(bodies[0]).not.toHaveProperty('inviteCode')
    expect(bodies[1]).toMatchObject({ studentNo: '2026001', inviteCode: 'K7Q2MX' })
    expect(bodies[1]).not.toHaveProperty('password')

    const session = useSession()
    expect(await session.login({ studentNo: '2026001', inviteCode: 'K7Q2MX' })).toBe(true)
    expect(session.needsPassword.value).toBe(true)
  })

  it('登录失败：显示服务端文案，不触发“登录已过期”跳转', async () => {
    const uni = stubUni('pages/login/index')
    configureClientForTests({
      fetchImpl: async () => json({ error: { code: 'INVALID_CREDENTIALS', message: '学号或密码不对' } }, 401),
      mock: false,
    })
    const session = useSession()
    expect(await session.login({ studentNo: '2026001', password: 'nope-nope' })).toBe(false)
    expect(session.error.value).toBe('学号或密码不对')
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('403 PASSWORD_SETUP_REQUIRED：去设密码页，不当作错误弹出，也不当作登录失效', async () => {
    const uni = stubUni('pages/home/index')
    configureClientForTests({
      fetchImpl: async () => json({ error: { code: 'PASSWORD_SETUP_REQUIRED', message: '请先设置密码', detail: { reason: 'password_setup_required' } } }, 403),
      mock: false,
    })
    const session = useSession()
    session.me.value = ME
    session.loggedIn.value = true
    await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ status: 403, code: 'PASSWORD_SETUP_REQUIRED' })
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/set-password/index' })
    expect(uni.showToast).not.toHaveBeenCalled()
    expect(session.loggedIn.value).toBe(true)
    expect(session.needsPassword.value).toBe(true)
  })

  it('已经在设密码页：PASSWORD_SETUP_REQUIRED 不再跳（不循环）', async () => {
    const uni = stubUni('pages/set-password/index')
    configureClientForTests({
      fetchImpl: async () => json({ error: { code: 'PASSWORD_SETUP_REQUIRED', message: '请先设置密码' } }, 403),
      mock: false,
    })
    await expect(startAttempt(ATTEMPT_ID)).rejects.toMatchObject({ code: 'PASSWORD_SETUP_REQUIRED' })
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('设密码：首次不带 currentPassword，成功后 needsPassword 变 false；服务端的策略文案原样展示', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let policyFail = true
    configureClientForTests({
      fetchImpl: async (url, init = {}) => {
        if (url.endsWith('/me')) return json({ ...ME, needsPassword: false })
        calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return policyFail
          ? json({ error: { code: 'VALIDATION_FAILED', message: '这个密码太常见了，换一个不容易被猜到的' } }, 422)
          : json({ ok: true })
      },
      mock: false,
    })
    const session = useSession()
    session.me.value = { ...ME, needsPassword: true }
    session.loggedIn.value = true

    expect(await session.setPassword('12345678')).toBe(false)
    expect(session.error.value).toBe('这个密码太常见了，换一个不容易被猜到的')
    expect(session.needsPassword.value).toBe(true)

    policyFail = false
    expect(await session.setPassword('correct horse battery')).toBe(true)
    expect(calls[1]?.url).toContain('/auth/student/password')
    expect(calls[1]?.body).toEqual({ newPassword: 'correct horse battery' })
    expect(session.needsPassword.value).toBe(false)
  })

  it('改密时当前密码错（403 INVALID_CREDENTIALS）：原地提示，不跳登录', async () => {
    const uni = stubUni('pages/home/index')
    configureClientForTests({
      fetchImpl: async () => json({ error: { code: 'INVALID_CREDENTIALS', message: '当前密码不对' } }, 403),
      mock: false,
    })
    const session = useSession()
    session.me.value = { ...ME, needsPassword: false }
    expect(await session.setPassword('another long phrase', 'wrong one')).toBe(false)
    expect(session.error.value).toBe('当前密码不对')
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('退出所有设备：请求 /auth/logout-all，本地会话清空', async () => {
    const urls: string[] = []
    configureClientForTests({ fetchImpl: async (url) => { urls.push(url); return new Response(null, { status: 204 }) }, mock: false })
    const session = useSession()
    session.me.value = ME
    session.loggedIn.value = true
    await session.logoutAll()
    expect(urls).toEqual(['/api/v1/auth/logout-all'])
    expect(session.loggedIn.value).toBe(false)
    expect(session.me.value).toBeNull()
  })

  it('离线演示模式：登录 / 设密码 / 退出所有设备走同样的方法，不发请求', async () => {
    const fetchImpl = vi.fn()
    configureClientForTests({ fetchImpl, mock: true })
    const session = useSession()
    expect(await session.login({ inviteCode: 'ABC123', studentNo: '2026001' })).toBe(true)
    expect(await session.setPassword('correct horse battery')).toBe(true)
    await session.logoutAll()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
