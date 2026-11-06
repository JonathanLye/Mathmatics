import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetClientForTests, __setMockOnboardingScenarioForTests, configureClientForTests } from '@/api/client'
import { __resetOnboardingForTests, deviceIntroSeen, markDeviceIntroSeen, shouldGoWelcome, useOnboarding } from '@/composables/useOnboarding'
import { setFeedbackTestMode } from '@/motion/useFeedbackPrefs'
import {
  canShow,
  localSeenKey,
  ONBOARDING_KEYS,
  parseLocalSeen,
  readSeen,
  unionSeen,
  welcomeNeeded,
  withoutSeen,
  withSeen,
} from '@/onboarding/logic'
import { __resetSessionForTests, useSession } from '@/stores/session'
import type { MeView, SettingsView } from '@/types/attempt'

// 新手引导：纯逻辑（合并、可见条件）+ 组合式函数（读写设置、串行写、测验静音、演示数据默认关）。

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

interface Call {
  method: string
  url: string
  body: Record<string, unknown> | null
}

/** 一个会记住 PATCH 的假 /student/settings：服务端对 onboarding 整体替换，这里照做。 */
function fakeSettingsServer(initial: Partial<SettingsView> = {}, options: { failPatches?: number; failGet?: boolean } = {}) {
  const store: SettingsView = {
    nickname: null,
    dailyGoal: 3,
    defaultInput: 'hand',
    theme: 'system',
    sound: true,
    motion: true,
    haptics: true,
    onboarding: {},
    ...initial,
  }
  const calls: Call[] = []
  let failPatches = options.failPatches ?? 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ method, url: String(input), body })
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (method === 'GET') return options.failGet ? json({ code: 'INTERNAL', message: 'x' }, 500) : json(store)
    if (failPatches > 0) {
      failPatches -= 1
      return json({ code: 'INTERNAL', message: 'x' }, 500)
    }
    if (body) {
      for (const [key, value] of Object.entries(body)) (store as unknown as Record<string, unknown>)[key] = value
    }
    return json(store)
  }) as typeof fetch
  return { store, calls, fetchImpl, setFail: (n: number) => void (failPatches = n), patches: () => calls.filter((c) => c.method === 'PATCH') }
}

function memoryStorage() {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return map
}

beforeEach(() => {
  __resetSessionForTests()
  __resetOnboardingForTests()
  useSession().me.value = ME
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setFeedbackTestMode(false)
  __resetClientForTests()
  __resetOnboardingForTests()
  __resetSessionForTests()
})

describe('纯逻辑', () => {
  it('readSeen 只认 true，坏数据当没看过', () => {
    expect(readSeen({ seen: { welcome: true, tour: false, x: 'yes' } })).toEqual({ welcome: true })
    expect(readSeen(null)).toEqual({})
    expect(readSeen({ seen: [1] })).toEqual({})
    expect(readSeen({})).toEqual({})
  })

  it('withSeen 保留 seen 以外的键，也不改入参', () => {
    const before = { seen: { welcome: true }, other: { a: 1 } }
    const after = withSeen(before, ['tour', 'layer.L1'])
    expect(after).toEqual({ seen: { welcome: true, tour: true, 'layer.L1': true }, other: { a: 1 } })
    expect(before).toEqual({ seen: { welcome: true }, other: { a: 1 } })
  })

  it('withoutSeen 默认保留欢迎页，可指定键', () => {
    const before = { seen: { welcome: true, tour: true, 'help.open': true }, keep: 1 }
    expect(withoutSeen(before)).toEqual({ seen: { welcome: true }, keep: 1 })
    expect(withoutSeen(before, ['tour'])).toEqual({ seen: { welcome: true, 'help.open': true }, keep: 1 })
  })

  it('键表包含第二部分要用的名字', () => {
    for (const key of ['layer.L3', 'input.hand', 'input.keyboard', 'input.photo', 'help.open', 'hint.costed', 'note.first', 'done.first']) {
      expect(ONBOARDING_KEYS).toContain(key)
    }
  })

  it('canShow：没读到设置、没启用、测验、看过都不出', () => {
    const ok = { key: 'tour', seen: {}, ready: true, active: true, muted: false }
    expect(canShow(ok)).toBe(true)
    expect(canShow({ ...ok, ready: false })).toBe(false)
    expect(canShow({ ...ok, active: false })).toBe(false)
    expect(canShow({ ...ok, muted: true })).toBe(false)
    expect(canShow({ ...ok, seen: { tour: true } })).toBe(false)
  })

  it('welcomeNeeded：新学生要，看过或早就有昵称的不要', () => {
    const base = { ready: true, active: true, muted: false, seen: {}, nickname: null }
    expect(welcomeNeeded(base)).toBe(true)
    expect(welcomeNeeded({ ...base, seen: { welcome: true } })).toBe(false)
    expect(welcomeNeeded({ ...base, nickname: '小明' })).toBe(false)
    expect(welcomeNeeded({ ...base, nickname: '  ' })).toBe(true)
    expect(welcomeNeeded({ ...base, nickname: 'S-7K2Q9M' })).toBe(true) // 系统匿名码不算自己取的昵称
    expect(welcomeNeeded({ ...base, ready: false })).toBe(false)
  })

  it('本机缓存按学生分开，坏 JSON 当空', () => {
    expect(localSeenKey('a')).not.toBe(localSeenKey('b'))
    expect(parseLocalSeen('{"tour":true,"x":1}')).toEqual({ tour: true })
    expect(parseLocalSeen('{not json')).toEqual({})
    expect(unionSeen({ a: true }, { b: true })).toEqual({ a: true, b: true })
  })
})

describe('useOnboarding（真实接口）', () => {
  it('读到设置后，没看过的能出；markSeen 写回完整对象且保留未知键', async () => {
    const server = fakeSettingsServer({ onboarding: { seen: { welcome: true }, other: 7 } })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    expect(onboarding.canShow('tour')).toBe(false) // 还没读
    expect(await onboarding.load()).toBe(true)
    expect(onboarding.canShow('tour')).toBe(true)
    expect(onboarding.canShow('welcome')).toBe(false)

    await onboarding.markSeen('tour')
    expect(onboarding.canShow('tour')).toBe(false)
    expect(server.patches()).toHaveLength(1)
    expect(server.patches()[0]?.body).toEqual({ onboarding: { seen: { welcome: true, tour: true }, other: 7 } })
  })

  it('连续标记：写入串行，最后一次带上全部键', async () => {
    const server = fakeSettingsServer()
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    await onboarding.load()
    await Promise.all([onboarding.markSeen('layer.L1'), onboarding.markSeen('help.open'), onboarding.markSeen('note.first')])
    const last = server.patches().at(-1)?.body as { onboarding: { seen: Record<string, boolean> } }
    expect(Object.keys(last.onboarding.seen).sort()).toEqual(['help.open', 'layer.L1', 'note.first'])
    expect((server.store.onboarding as { seen: Record<string, boolean> }).seen['layer.L1']).toBe(true)
  })

  it('测验模式一个都不出，退出测验后恢复', async () => {
    const server = fakeSettingsServer()
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    await onboarding.load()
    setFeedbackTestMode(true)
    for (const key of ['tour', 'layer.L3', 'help.open', 'hint.costed', 'done.first']) expect(onboarding.canShow(key)).toBe(false)
    expect(onboarding.welcomeNeeded()).toBe(false)
    setFeedbackTestMode(false)
    expect(onboarding.canShow('tour')).toBe(true)
  })

  it('读不到设置：什么都不出，也不往服务端写', async () => {
    const server = fakeSettingsServer({}, { failGet: true })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    expect(await onboarding.load()).toBe(false)
    expect(onboarding.canShow('tour')).toBe(false)
    expect(await shouldGoWelcome()).toBe(false)
    await onboarding.markSeen('tour')
    expect(server.patches()).toHaveLength(0)
    expect(onboarding.isSeen('tour')).toBe(true) // 本次会话不再重复
  })

  it('写失败不抛，本机记着；下次读设置时补写', async () => {
    const server = fakeSettingsServer({}, { failPatches: 9 })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    const storage = memoryStorage()
    const onboarding = useOnboarding()
    await onboarding.load()
    await expect(onboarding.markSeen('tour')).resolves.toBeUndefined()
    expect(storage.get(localSeenKey(ME.userId))).toContain('tour')
    expect(server.store.onboarding).toEqual({})

    server.setFail(0) // 网络恢复
    __resetOnboardingForTests() // 模拟重新打开应用
    await onboarding.load()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onboarding.canShow('tour')).toBe(false)
    expect((server.store.onboarding as { seen: Record<string, boolean> }).seen.tour).toBe(true)
  })

  it('欢迎页保存：昵称、目标、默认输入和“欢迎页走过”一次写完；失败会抛出', async () => {
    const server = fakeSettingsServer()
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    expect(await shouldGoWelcome()).toBe(true)
    await onboarding.saveWelcome({ nickname: '小明', dailyGoal: 5, defaultInput: 'keyboard' })
    expect(server.patches()).toHaveLength(1)
    expect(server.patches()[0]?.body).toEqual({ nickname: '小明', dailyGoal: 5, defaultInput: 'keyboard', onboarding: { seen: { welcome: true } } })
    expect(onboarding.welcomeNeeded()).toBe(false)
    expect(useSession().me.value?.displayName).toBe('小明')

    const failing = fakeSettingsServer({}, { failPatches: 9 })
    configureClientForTests({ fetchImpl: failing.fetchImpl, mock: false })
    __resetOnboardingForTests()
    memoryStorage()
    await expect(useOnboarding().saveWelcome({ nickname: '小红' })).rejects.toBeTruthy()
    expect(await shouldGoWelcome()).toBe(true) // 没写成就还要再来一次
  })

  it('已经有昵称的老用户不会被拉去欢迎页', async () => {
    const server = fakeSettingsServer({ nickname: '老同学' })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    expect(await shouldGoWelcome()).toBe(false)
  })

  it('重看引导：清掉除欢迎页外的标记并写回；本机开场标记也清掉', async () => {
    const server = fakeSettingsServer({ onboarding: { seen: { welcome: true, intro: true, tour: true, 'help.open': true } } })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    markDeviceIntroSeen()
    expect(deviceIntroSeen()).toBe(true)
    const onboarding = useOnboarding()
    await onboarding.replay()
    expect(deviceIntroSeen()).toBe(false)
    expect(server.patches().at(-1)?.body).toEqual({ onboarding: { seen: { welcome: true } } })
    expect(onboarding.canShow('tour')).toBe(true)
    expect(onboarding.canShow('help.open')).toBe(true)
  })

  it('换了一个学生：上一个人的状态不带过来', async () => {
    const server = fakeSettingsServer({ onboarding: { seen: { tour: true } } })
    configureClientForTests({ fetchImpl: server.fetchImpl, mock: false })
    memoryStorage()
    const onboarding = useOnboarding()
    await onboarding.load()
    expect(onboarding.isSeen('tour')).toBe(true)
    server.store.onboarding = {}
    useSession().me.value = { ...ME, userId: '22222222-2222-4222-8222-222222222222' }
    await onboarding.load()
    expect(onboarding.isSeen('tour')).toBe(false)
  })
})

describe('演示数据', () => {
  it('默认关：不读设置、不出任何引导，也不去欢迎页', async () => {
    configureClientForTests({ mock: true })
    const onboarding = useOnboarding()
    expect(onboarding.active.value).toBe(false)
    expect(await onboarding.load()).toBe(false)
    expect(onboarding.canShow('tour')).toBe(false)
    expect(await shouldGoWelcome()).toBe(false)
  })

  it('?onboarding=new 场景打开：新学生要先去欢迎页，保存后不用再去', async () => {
    configureClientForTests({ mock: true })
    __setMockOnboardingScenarioForTests(true)
    memoryStorage()
    const onboarding = useOnboarding()
    expect(onboarding.active.value).toBe(true)
    expect(await shouldGoWelcome()).toBe(true)
    await onboarding.saveWelcome({ nickname: '小明', dailyGoal: 3, defaultInput: 'hand' })
    expect(await shouldGoWelcome()).toBe(false)
    expect(onboarding.canShow('tour')).toBe(true)
  })

  it('点过“重看引导”之后演示数据里也能出', async () => {
    configureClientForTests({ mock: true })
    memoryStorage()
    const onboarding = useOnboarding()
    await onboarding.replay()
    expect(onboarding.active.value).toBe(true)
    expect(onboarding.canShow('tour')).toBe(true)
  })
})
