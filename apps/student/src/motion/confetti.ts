/**
 * 撒花：包一层 canvas-confetti。
 * - 懒加载，只有真正庆祝时才下载；
 * - 线上 CSP 没有 blob: worker，所以必须 confetti.create(canvas, { useWorker: false })，不能用默认实例；
 * - prefers-reduced-motion、动效开关、测验模式都会拦住（feedbackAllowed）。
 */
import type { CreateTypes } from 'canvas-confetti'
import { feedbackAllowed } from './useFeedbackPrefs'
import { readCssToken } from '@/utils/themeTokens'

export const CONFETTI_CREATE_OPTIONS = { useWorker: false, resize: true, disableForReducedMotion: true } as const

const instances = new WeakMap<HTMLCanvasElement, CreateTypes>()

async function instanceFor(canvas: HTMLCanvasElement): Promise<CreateTypes> {
  const existing = instances.get(canvas)
  if (existing) return existing
  const { default: confetti } = await import('canvas-confetti')
  const created = confetti.create(canvas, CONFETTI_CREATE_OPTIONS)
  instances.set(canvas, created)
  return created
}

function palette(): string[] {
  return [
    readCssToken('--accent', '#0fb5a6'),
    readCssToken('--bee', '#ffc233'),
    readCssToken('--sea', '#4c8dff'),
    readCssToken('--fox', '#ff8a4c'),
    readCssToken('--indigo', '#5b6cff'),
  ]
}

/** 从两侧向中间撒一次；被拦住或加载失败返回 false，庆祝页面照常显示。 */
export async function fireConfetti(canvas: HTMLCanvasElement | null): Promise<boolean> {
  if (!canvas || !feedbackAllowed('motion')) return false
  try {
    const fire = await instanceFor(canvas)
    const colors = palette()
    const shared = { colors, ticks: 180, gravity: 1, scalar: 1, startVelocity: 46, spread: 62 }
    void fire({ ...shared, particleCount: 70, angle: 60, origin: { x: 0, y: 0.72 } })
    void fire({ ...shared, particleCount: 70, angle: 120, origin: { x: 1, y: 0.72 } })
    return true
  } catch (error) {
    console.warn('[confetti] 没有撒成', error)
    return false
  }
}

export function clearConfetti(canvas: HTMLCanvasElement | null): void {
  if (canvas) instances.get(canvas)?.reset()
}
