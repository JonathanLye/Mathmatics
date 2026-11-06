/**
 * 音效：Web Audio 现场合成，不带任何素材文件（CSP 下也不需要 media-src）。
 * 浏览器要求第一次手势之后才能出声，所以 installSfxUnlock 在首次按下时才创建并恢复 AudioContext。
 * 是否出声由 useFeedbackPrefs 决定（sound 开关、测验静音）。
 */
import { feedbackAllowed } from './useFeedbackPrefs'

export type SfxName = 'tap' | 'correct' | 'gentle-question' | 'hint' | 'layer-up' | 'celebrate' | 'streak'

export interface SfxNote {
  /** 频率（Hz）；slideTo 让音高滑到另一个频率（问句上扬）。 */
  freq: number
  slideTo?: number
  /** 相对开始时间（秒）与时长（秒）。 */
  at: number
  dur: number
  type?: OscillatorType
  gain?: number
}

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 }

export const SFX: Readonly<Record<SfxName, readonly SfxNote[]>> = {
  tap: [{ freq: NOTE.E5, at: 0, dur: 0.05, type: 'triangle', gain: 0.5 }],
  correct: [
    { freq: NOTE.C6, at: 0, dur: 0.12, type: 'triangle' },
    { freq: NOTE.G6, at: 0.1, dur: 0.22, type: 'triangle' },
  ],
  // 批注是提问，不是判错：一个温和上扬的音，绝不用下行的“错误音”。
  'gentle-question': [{ freq: 440, slideTo: 554.37, at: 0, dur: 0.22, type: 'sine', gain: 0.7 }],
  hint: [
    { freq: NOTE.A5, at: 0, dur: 0.1, type: 'sine', gain: 0.7 },
    { freq: NOTE.D6, at: 0.08, dur: 0.18, type: 'sine', gain: 0.7 },
  ],
  'layer-up': [
    { freq: NOTE.C5, at: 0, dur: 0.12, type: 'triangle' },
    { freq: NOTE.E5, at: 0.1, dur: 0.12, type: 'triangle' },
    { freq: NOTE.G5, at: 0.2, dur: 0.26, type: 'triangle' },
  ],
  celebrate: [
    { freq: NOTE.C5, at: 0, dur: 0.14, type: 'triangle' },
    { freq: NOTE.E5, at: 0.12, dur: 0.14, type: 'triangle' },
    { freq: NOTE.G5, at: 0.24, dur: 0.14, type: 'triangle' },
    { freq: NOTE.C6, at: 0.36, dur: 0.42, type: 'triangle' },
    { freq: NOTE.E6, at: 0.36, dur: 0.42, type: 'sine', gain: 0.5 },
  ],
  streak: [
    { freq: NOTE.E5, at: 0, dur: 0.09, type: 'square', gain: 0.35 },
    { freq: NOTE.G5, at: 0.08, dur: 0.09, type: 'square', gain: 0.35 },
    { freq: NOTE.B5, at: 0.16, dur: 0.2, type: 'square', gain: 0.35 },
  ],
}

const MASTER_GAIN = 0.16

type AudioContextCtor = typeof AudioContext
let context: AudioContext | null = null
let unlockInstalled = false

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/** 手势里调用：创建并恢复 AudioContext。 */
export function unlockSfx(): void {
  const Ctor = audioContextCtor()
  if (!Ctor) return
  try {
    context ??= new Ctor()
    if (context.state === 'suspended') void context.resume()
  } catch {
    context = null
  }
}

/** 应用启动时装一次：首次按下或按键时解锁。 */
export function installSfxUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const once = () => {
    unlockSfx()
    window.removeEventListener('pointerdown', once, true)
    window.removeEventListener('keydown', once, true)
  }
  window.addEventListener('pointerdown', once, true)
  window.addEventListener('keydown', once, true)
}

function scheduleNote(ctx: AudioContext, destination: AudioNode, note: SfxNote): void {
  const start = ctx.currentTime + note.at
  const end = start + note.dur
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = note.type ?? 'sine'
  osc.frequency.setValueAtTime(note.freq, start)
  if (note.slideTo) osc.frequency.linearRampToValueAtTime(note.slideTo, end)
  const peak = MASTER_GAIN * (note.gain ?? 1)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.connect(gain)
  gain.connect(destination)
  osc.start(start)
  osc.stop(end + 0.02)
}

/** 播放一个音效；被偏好拦住、还没解锁或环境不支持时返回 false，绝不抛错。 */
export function playSfx(name: SfxName): boolean {
  if (!feedbackAllowed('sound')) return false
  if (!context || context.state !== 'running') return false
  try {
    for (const note of SFX[name]) scheduleNote(context, context.destination, note)
    return true
  } catch {
    return false
  }
}
