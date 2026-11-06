/**
 * 手感偏好（音效、动效、震动）的唯一来源。现在存在本机，服务端同步留给设置任务。
 *
 * 所有声音、震动、撒花都要过这里：
 * - muted：测验模式下强制静音（产品不变量：测验没有音效和游戏化），由做题页按 state.mode 打开；
 * - prefers-reduced-motion 永远优先于 motion 开关；
 * - 反馈都是调用点主动触发的，教师镜像（pages/mirror、ProofLineList readonly）不调用，所以始终安静。
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'

export interface FeedbackPrefs {
  sound: boolean
  motion: boolean
  haptics: boolean
}

export const FEEDBACK_PREFS_KEY = 'pg.feedback.v1'
export const DEFAULT_FEEDBACK_PREFS: Readonly<FeedbackPrefs> = { sound: true, motion: true, haptics: true }

/** 解析本机存的偏好：坏数据和缺字段都回默认值，不抛错。 */
export function parseFeedbackPrefs(raw: string | null | undefined): FeedbackPrefs {
  const out: FeedbackPrefs = { ...DEFAULT_FEEDBACK_PREFS }
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof FeedbackPrefs, unknown>>
    for (const key of Object.keys(out) as Array<keyof FeedbackPrefs>) {
      if (typeof parsed?.[key] === 'boolean') out[key] = parsed[key] as boolean
    }
  } catch {
    /* 坏 JSON：用默认值 */
  }
  return out
}

const prefs = reactive<FeedbackPrefs>({ ...DEFAULT_FEEDBACK_PREFS })
const testMode = ref(false)
const reducedMotion = ref(false)
let loaded = false

function readStorage(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(FEEDBACK_PREFS_KEY)
  } catch {
    return null
  }
}

function writeStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FEEDBACK_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式写不进去：本次会话仍然生效 */
  }
}

/** 动效开关落到 html[data-motion]，base.css 据此统一关掉动画和过渡。 */
function applyMotionAttr(): void {
  if (typeof document === 'undefined') return
  if (prefs.motion) document.documentElement.removeAttribute('data-motion')
  else document.documentElement.setAttribute('data-motion', 'off')
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  Object.assign(prefs, parseFeedbackPrefs(readStorage()))
  applyMotionAttr()
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.value = query.matches
    query.addEventListener?.('change', (event) => {
      reducedMotion.value = event.matches
    })
  }
}

export function setFeedbackPref(key: keyof FeedbackPrefs, value: boolean): void {
  ensureLoaded()
  prefs[key] = value
  writeStorage()
  applyMotionAttr()
}

/** 做题页按 state.mode 调用；离开做题页时恢复。 */
export function setFeedbackTestMode(on: boolean): void {
  testMode.value = on
}

/** 给非组件模块用（sfx / haptics / confetti）：此刻允不允许这种反馈。 */
export function feedbackAllowed(kind: keyof FeedbackPrefs): boolean {
  ensureLoaded()
  if (testMode.value) return false
  if (kind === 'motion') return prefs.motion && !reducedMotion.value
  return prefs[kind]
}

export interface FeedbackPrefsStore {
  sound: Ref<boolean>
  motion: Ref<boolean>
  haptics: Ref<boolean>
  /** 测验模式下恒为 true。 */
  muted: ComputedRef<boolean>
  /** 动效真正可用：开关打开、系统没要求减少动态效果、不在测验。 */
  motionEnabled: ComputedRef<boolean>
  setPref: typeof setFeedbackPref
  setTestMode: typeof setFeedbackTestMode
}

const prefRef = (key: keyof FeedbackPrefs) =>
  computed<boolean>({
    get: () => prefs[key],
    set: (value) => setFeedbackPref(key, value),
  })

export function useFeedbackPrefs(): FeedbackPrefsStore {
  ensureLoaded()
  return {
    sound: prefRef('sound'),
    motion: prefRef('motion'),
    haptics: prefRef('haptics'),
    muted: computed(() => testMode.value),
    motionEnabled: computed(() => prefs.motion && !reducedMotion.value && !testMode.value),
    setPref: setFeedbackPref,
    setTestMode: setFeedbackTestMode,
  }
}

/** 测试隔离。 */
export function __resetFeedbackPrefsForTests(): void {
  Object.assign(prefs, DEFAULT_FEEDBACK_PREFS)
  testMode.value = false
  reducedMotion.value = false
  loaded = false
}
