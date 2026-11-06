import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFETTI_CREATE_OPTIONS, fireConfetti } from '@/motion/confetti'
import { HAPTICS, vibrate } from '@/motion/haptics'
import { parseDurationMs, motionMs } from '@/motion/tokens'
import { countUpValue, easeOutCubic } from '@/motion/useCountUp'
import { MASCOT_MOTION, mascotNext } from '@/motion/useMascot'
import { playSfx, SFX, type SfxName } from '@/motion/sfx'
import {
  __resetFeedbackPrefsForTests,
  DEFAULT_FEEDBACK_PREFS,
  FEEDBACK_PREFS_KEY,
  feedbackAllowed,
  parseFeedbackPrefs,
  setFeedbackPref,
  setFeedbackTestMode,
  useFeedbackPrefs,
} from '@/motion/useFeedbackPrefs'
import { MASCOT_EXPRESSIONS, mascotSvg } from '@/components/ui/icons'

beforeEach(() => __resetFeedbackPrefsForTests())
afterEach(() => {
  vi.unstubAllGlobals()
  __resetFeedbackPrefsForTests()
})

describe('手感偏好', () => {
  it('解析：坏数据和缺字段回默认值，不抛错', () => {
    expect(parseFeedbackPrefs(null)).toEqual(DEFAULT_FEEDBACK_PREFS)
    expect(parseFeedbackPrefs('不是 JSON')).toEqual(DEFAULT_FEEDBACK_PREFS)
    expect(parseFeedbackPrefs('{"sound":false}')).toEqual({ ...DEFAULT_FEEDBACK_PREFS, sound: false })
    expect(parseFeedbackPrefs('{"sound":"off"}')).toEqual(DEFAULT_FEEDBACK_PREFS)
  })

  it('开关写进 localStorage，下次启动读回来', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    setFeedbackPref('sound', false)
    expect(JSON.parse(store.get(FEEDBACK_PREFS_KEY) ?? '{}').sound).toBe(false)
    __resetFeedbackPrefsForTests()
    expect(useFeedbackPrefs().sound.value).toBe(false)
  })

  it('测验模式：声音、震动、动效全部拦住，muted=true', () => {
    expect(feedbackAllowed('sound')).toBe(true)
    setFeedbackTestMode(true)
    expect(feedbackAllowed('sound')).toBe(false)
    expect(feedbackAllowed('haptics')).toBe(false)
    expect(feedbackAllowed('motion')).toBe(false)
    expect(useFeedbackPrefs().muted.value).toBe(true)
    setFeedbackTestMode(false)
    expect(useFeedbackPrefs().muted.value).toBe(false)
  })

  it('prefers-reduced-motion 优先于动效开关', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener: () => {} }) })
    __resetFeedbackPrefsForTests()
    expect(feedbackAllowed('motion')).toBe(false)
    expect(useFeedbackPrefs().motionEnabled.value).toBe(false)
    // 声音不受影响
    expect(feedbackAllowed('sound')).toBe(true)
  })
})

describe('音效', () => {
  /** 记录发声次数的假 AudioContext。 */
  function stubAudio() {
    const started: number[] = []
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      resume() {
        return Promise.resolve()
      }
      createOscillator() {
        return {
          type: '',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          start(at: number) {
            started.push(at)
          },
          stop() {},
        }
      }
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    return started
  }

  it('七种音效都有定义', () => {
    const names: SfxName[] = ['tap', 'correct', 'gentle-question', 'hint', 'layer-up', 'celebrate', 'streak']
    for (const name of names) expect(SFX[name].length).toBeGreaterThan(0)
  })

  it('批注的提示音是上扬的问句，不是下行的错误音', () => {
    const [note] = SFX['gentle-question']
    expect(note.slideTo).toBeGreaterThan(note.freq)
  })

  it('音效开关关掉或测验模式下，playSfx 不发声', () => {
    const started = stubAudio()
    setFeedbackPref('sound', false)
    expect(playSfx('tap')).toBe(false)
    setFeedbackPref('sound', true)
    setFeedbackTestMode(true)
    expect(playSfx('tap')).toBe(false)
    expect(started).toEqual([])
  })
})

describe('震动', () => {
  it('开着才震；测验模式和不支持的设备静默', () => {
    const calls: unknown[] = []
    vi.stubGlobal('navigator', { vibrate: (p: unknown) => (calls.push(p), true) })
    expect(vibrate('tap')).toBe(true)
    expect(calls).toEqual([HAPTICS.tap])
    setFeedbackTestMode(true)
    expect(vibrate('tap')).toBe(false)
    setFeedbackTestMode(false)
    setFeedbackPref('haptics', false)
    expect(vibrate('tap')).toBe(false)
    setFeedbackPref('haptics', true)
    vi.stubGlobal('navigator', {})
    expect(vibrate('tap')).toBe(false)
  })
})

describe('撒花', () => {
  it('不用 worker（线上 CSP 没有 blob:）', () => {
    expect(CONFETTI_CREATE_OPTIONS.useWorker).toBe(false)
    expect(CONFETTI_CREATE_OPTIONS.disableForReducedMotion).toBe(true)
  })

  it('动效关掉或测验模式下不撒', async () => {
    const canvas = {} as HTMLCanvasElement
    setFeedbackPref('motion', false)
    expect(await fireConfetti(canvas)).toBe(false)
    setFeedbackPref('motion', true)
    setFeedbackTestMode(true)
    expect(await fireConfetti(canvas)).toBe(false)
    setFeedbackTestMode(false)
    expect(await fireConfetti(null)).toBe(false)
  })
})

describe('数字滚动', () => {
  it('缓动单调，到点精确等于终值', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(countUpValue(0, 10, 0)).toBe(0)
    expect(countUpValue(0, 10, 10000)).toBe(10)
    expect(countUpValue(0, 10, 1, 0)).toBe(10)
    expect(countUpValue(10, 0, 10000)).toBe(0)
  })
})

describe('动效 token', () => {
  it('解析 ms 和 s，解析不了返回 null；无 DOM 时回退同值常量', () => {
    expect(parseDurationMs('220ms')).toBe(220)
    expect(parseDurationMs('0.42s')).toBe(420)
    expect(parseDurationMs('快')).toBeNull()
    expect(motionMs('--dur-base')).toBe(220)
  })
})

describe('小方', () => {
  it('状态机：思考之后才有反应，反应之后回待机', () => {
    expect(mascotNext('idle', 'think')).toBe('think')
    expect(mascotNext('think', 'happy')).toBe('happy')
    expect(mascotNext('think', 'oops')).toBe('oops')
    expect(mascotNext('idle', 'cheer')).toBe('cheer')
    expect(mascotNext('happy', 'idle')).toBe('idle')
    // 不合法的转移留在原状态
    expect(mascotNext('happy', 'oops')).toBe('happy')
    expect(mascotNext('sleepy', 'oops')).toBe('sleepy')
    expect(mascotNext('sleepy', 'think')).toBe('sleepy')
    expect(mascotNext('idle', 'sleep')).toBe('sleepy')
    expect(mascotNext('sleepy', 'idle')).toBe('idle')
  })

  it('六种表情都有 SVG 和动作，表情之间确实不同', () => {
    expect(MASCOT_EXPRESSIONS).toEqual(['idle', 'think', 'happy', 'oops', 'cheer', 'sleepy'])
    const svgs = MASCOT_EXPRESSIONS.map((expr) => mascotSvg(expr, 72))
    expect(new Set(svgs).size).toBe(6)
    for (const svg of svgs) {
      expect(svg).toContain('pgm-figure')
      expect(svg).toContain('pgm-eyes')
    }
    for (const expr of MASCOT_EXPRESSIONS) expect(MASCOT_MOTION[expr].length).toBeGreaterThan(0)
  })
})
