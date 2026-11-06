/**
 * 新手引导的状态：看过哪些提示（settings.onboarding.seen.*，服务端为准），以及“现在该不该出”。
 *
 * - 读写都走 /student/settings，要求已签同意书：同意书之前的页面不要调 load / markSeen
 *   （登录页的开场动画只用本机标记 DEVICE_INTRO_KEY）；
 * - 服务端整体替换 onboarding，所以每次写都带完整对象，写入排队串行，后一次覆盖前一次也不会丢键；
 * - 读不到设置（断网、年龄限制）时什么都不出，也不往服务端写，不会把学生卡在引导里；
 * - 本机按学生缓存一份 seen：写失败也不会在下次启动重复弹，下一次成功的写会把它补上；
 * - 测验模式（useFeedbackPrefs.muted）下一律不出；演示数据默认关，?onboarding=new 或“重看引导”才打开。
 */
import { computed, reactive } from 'vue'

import { fetchSettings, isMockMode, isMockOnboardingScenario, updateSettings } from '@/api/client'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import {
  canShow as canShowLogic,
  DEVICE_INTRO_KEY,
  localSeenKey,
  parseLocalSeen,
  readSeen,
  unionSeen,
  welcomeNeeded as welcomeNeededLogic,
  withoutSeen,
  withSeen,
  type OnboardingBlob,
  type OnboardingKey,
  type SeenMap,
} from '@/onboarding/logic'
import { useSession } from '@/stores/session'
import type { SettingsPatch } from '@/types/attempt'

interface State {
  ready: boolean
  userId: string
  nickname: string | null
  blob: OnboardingBlob
  seen: SeenMap
  /** 有还没写到服务端的改动（上次写失败，或本机缓存里有服务端没有的键）。 */
  dirty: boolean
  /** “重看引导”点过：演示数据里也打开引导。 */
  activated: boolean
}

const state = reactive<State>({ ready: false, userId: '', nickname: null, blob: {}, seen: {}, dirty: false, activated: false })
let loading: Promise<boolean> | null = null
let writeChain: Promise<void> = Promise.resolve()

// ---- 本机存储（失败不抛：隐私模式、测试环境都可能没有） ----
function readLocal(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLocal(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* 写不进去就算了：本次会话仍然生效 */
  }
}

/** 这台设备看过登录页的开场动画吗（登录前没有账号，只能记在本机）。 */
export function deviceIntroSeen(): boolean {
  return readLocal(DEVICE_INTRO_KEY) === '1'
}
export function markDeviceIntroSeen(): void {
  writeLocal(DEVICE_INTRO_KEY, '1')
}
export function clearDeviceIntroSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DEVICE_INTRO_KEY)
  } catch {
    /* 同上 */
  }
}

function persistLocal(): void {
  if (state.userId) writeLocal(localSeenKey(state.userId), JSON.stringify(state.seen))
}

/** 引导是否启用：真实服务一律启用；演示数据只在 ?onboarding=new 或点过“重看引导”之后。 */
export function onboardingActive(): boolean {
  return !isMockMode() || isMockOnboardingScenario() || state.activated
}

function currentUserId(): string {
  return useSession().me.value?.userId ?? ''
}

function resetState(userId: string): void {
  state.ready = false
  state.userId = userId
  state.nickname = null
  state.blob = {}
  state.seen = {}
  state.dirty = false
  loading = null
}

/** 把当前完整的 onboarding 对象写到服务端（排队；失败只留 dirty，不抛）。 */
function flush(extra: SettingsPatch = {}): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    try {
      const saved = await updateSettings({ ...extra, onboarding: state.blob })
      state.nickname = saved.nickname
      state.dirty = false
      return true
    } catch {
      state.dirty = true
      return false
    }
  }
  const next = writeChain.then(run, run)
  writeChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** 读设置。同一时刻只发一次；换了学生会先清掉上一个人的状态。成功返回 true。 */
async function load(force = false): Promise<boolean> {
  if (!onboardingActive()) return false
  const userId = currentUserId()
  if (state.userId !== userId) resetState(userId)
  if (state.ready && !force) return true
  if (loading) return loading
  loading = (async () => {
    try {
      const settings = await fetchSettings()
      const server = readSeen(settings.onboarding)
      const local = state.userId ? parseLocalSeen(readLocal(localSeenKey(state.userId))) : {}
      state.blob = settings.onboarding && typeof settings.onboarding === 'object' ? { ...settings.onboarding } : {}
      state.seen = unionSeen(server, local, state.seen)
      state.nickname = settings.nickname
      state.ready = true
      // 本机比服务端多出来的键（上次写失败）这次补上。
      const missing = Object.keys(state.seen).filter((key) => !server[key])
      if (missing.length > 0) {
        state.blob = withSeen(state.blob, missing)
        void flush()
      }
      persistLocal()
      return true
    } catch {
      return false
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 把这些提示标成看过：马上生效、写本机，再排队写服务端；读不到设置时只记本机。 */
async function markSeen(...keys: OnboardingKey[] | string[]): Promise<void> {
  if (!onboardingActive() || keys.length === 0) return
  await load()
  const list = keys as string[]
  state.seen = unionSeen(state.seen, Object.fromEntries(list.map((key) => [key, true])) as SeenMap)
  persistLocal()
  if (!state.ready) return
  state.blob = withSeen(state.blob, list)
  await flush()
}

/** 欢迎页保存：昵称、每日目标、默认输入和“欢迎页走过”一次写完，失败抛出（页面显示原因，让学生重试）。 */
async function saveWelcome(patch: { nickname?: string; dailyGoal?: number; defaultInput?: 'hand' | 'keyboard' | 'photo' }): Promise<void> {
  await load()
  const nextBlob = withSeen(state.blob, ['welcome'])
  const saved = await updateSettings({ ...patch, onboarding: nextBlob })
  state.blob = nextBlob
  state.seen = unionSeen(state.seen, { welcome: true })
  state.nickname = saved.nickname
  state.ready = true
  persistLocal()
  const me = useSession().me
  if (me.value && saved.nickname) me.value = { ...me.value, displayName: saved.nickname }
}

/**
 * 重看引导：清掉除“欢迎页”外的所有已读标记（首页导览、做题页里的就地提示都会再出一遍），
 * 并在演示数据里也打开引导。调用方再决定去哪个页面（见 replayRoute）。
 */
async function replay(): Promise<void> {
  state.activated = true
  clearDeviceIntroSeen()
  await load(true)
  state.blob = withoutSeen(state.blob)
  state.seen = readSeen(state.blob)
  persistLocal()
  if (state.ready) await flush()
}

export const REPLAY_ROUTE = '/pages/welcome/index?replay=1'

export function useOnboarding() {
  const prefs = useFeedbackPrefs()
  return {
    /** 设置已读到。 */
    ready: computed(() => state.ready),
    active: computed(() => onboardingActive()),
    seen: computed(() => state.seen),
    load,
    markSeen,
    saveWelcome,
    replay,
    /** 这条提示现在能出吗（读到设置、引导启用、不在测验、没看过）。 */
    canShow: (key: OnboardingKey | string): boolean =>
      canShowLogic({ key, seen: state.seen, ready: state.ready, active: onboardingActive(), muted: prefs.muted.value }),
    isSeen: (key: OnboardingKey | string): boolean => state.seen[key] === true,
    /** 要不要先走欢迎页（需要已经 load 过）。 */
    welcomeNeeded: (): boolean =>
      welcomeNeededLogic({ ready: state.ready, active: onboardingActive(), muted: prefs.muted.value, seen: state.seen, nickname: state.nickname }),
  }
}

/** 同意书签完 / 登录后：该去欢迎页还是首页。读不到设置就去首页，不拦学生。 */
export async function shouldGoWelcome(): Promise<boolean> {
  if (!onboardingActive()) return false
  if (!(await load())) return false
  return useOnboarding().welcomeNeeded()
}

/** 重看引导的入口（“我的”页调用）：清标记，再去欢迎页放开场动画。 */
export async function replayOnboarding(): Promise<void> {
  await useOnboarding().replay()
  if (typeof uni !== 'undefined') uni.reLaunch({ url: REPLAY_ROUTE })
}

/** 测试隔离。 */
export function __resetOnboardingForTests(): void {
  resetState('')
  state.activated = false
  writeChain = Promise.resolve()
}
