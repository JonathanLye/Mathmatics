import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetClientForTests, configureClientForTests } from '@/api/client'
import { useToast } from '@/components/ui/useToast'
import { ensureSettingsLoaded, resetSettingsSync, saveChoice, saveFeedbackPref, saveTheme, useSettings } from '@/composables/useSettingsSync'
import { THEME_STORAGE_KEY } from '@/composables/useTheme'
import { FEEDBACK_PREFS_KEY, __resetFeedbackPrefsForTests, useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { __resetSessionForTests, useSession } from '@/stores/session'
import type { MeView, SettingsView } from '@/types/attempt'

const REMOTE: SettingsView = {
  nickname: '小明',
  dailyGoal: 5,
  defaultInput: 'keyboard',
  theme: 'dark',
  sound: false,
  motion: true,
  haptics: false,
  onboarding: {},
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call {
  url: string
  method: string
  body: unknown
}

function fakeServer(responder: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const call: Call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    return responder(call)
  }
  return { calls, fetchImpl }
}

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
  __resetClientForTests()
  __resetSessionForTests()
  __resetFeedbackPrefsForTests()
  resetSettingsSync()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useToast().hide()
  resetSettingsSync()
  __resetClientForTests()
  __resetFeedbackPrefsForTests()
})

describe('账号设置同步', () => {
  it('拉到的外观和手感覆盖本机；同一位同学只拉一次', async () => {
    const { calls, fetchImpl } = fakeServer(() => jsonResponse(REMOTE))
    configureClientForTests({ fetchImpl, mock: false })
    await ensureSettingsLoaded()
    await ensureSettingsLoaded()
    expect(calls.filter((c) => c.url.endsWith('/student/settings'))).toHaveLength(1)
    expect(useSettings().settings.value?.nickname).toBe('小明')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(JSON.parse(store.get(FEEDBACK_PREFS_KEY) ?? '{}')).toMatchObject({ sound: false, haptics: false })
    expect(useFeedbackPrefs().sound.value).toBe(false)
  })

  it('换人登录重新拉', async () => {
    const { calls, fetchImpl } = fakeServer(() => jsonResponse(REMOTE))
    configureClientForTests({ fetchImpl, mock: false })
    await ensureSettingsLoaded()
    useSession().me.value = { userId: 'u2' } as MeView
    await ensureSettingsLoaded()
    expect(calls).toHaveLength(2)
  })

  it('接口拒绝（没签同意书）时安静，不改本机', async () => {
    const { fetchImpl } = fakeServer(() => jsonResponse({ error: { code: 'CONSENT_REQUIRED', message: 'x' } }, 403))
    configureClientForTests({ fetchImpl, mock: false })
    await expect(ensureSettingsLoaded()).resolves.toBeUndefined()
    expect(useSettings().settings.value).toBeNull()
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('mock 模式不拿默认值盖本机的选择', async () => {
    store.set(THEME_STORAGE_KEY, 'dark')
    configureClientForTests({ mock: true })
    await ensureSettingsLoaded()
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(useSettings().settings.value).not.toBeNull()
  })

  it('改设置先生效再写账号，只传改的字段', async () => {
    const { calls, fetchImpl } = fakeServer(() => jsonResponse(REMOTE))
    configureClientForTests({ fetchImpl, mock: false })
    saveTheme('light')
    expect(store.get(THEME_STORAGE_KEY)).toBe('light')
    saveFeedbackPref('sound', false)
    saveChoice({ dailyGoal: 8 })
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['PATCH', { theme: 'light' }],
      ['PATCH', { sound: false }],
      ['PATCH', { dailyGoal: 8 }],
    ])
  })

  it('写失败轻提示，本机仍然生效', async () => {
    const { fetchImpl } = fakeServer(() => jsonResponse({ error: { code: 'INTERNAL', message: 'x' } }, 500))
    configureClientForTests({ fetchImpl, mock: false })
    saveTheme('dark')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    await vi.waitFor(() => expect(useToast().state.message).toContain('没保存到账号'))
  })
})
