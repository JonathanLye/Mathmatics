/** 震动：包一层 navigator.vibrate，过 useFeedbackPrefs；不支持的设备（iOS、桌面）静默跳过。 */
import { feedbackAllowed } from './useFeedbackPrefs'

export type HapticName = 'tap' | 'success' | 'nudge' | 'celebrate'

export const HAPTICS: Readonly<Record<HapticName, number | number[]>> = {
  tap: 8,
  success: [12, 40, 12],
  nudge: 20,
  celebrate: [20, 60, 20, 60, 40],
}

export function vibrate(name: HapticName): boolean {
  if (!feedbackAllowed('haptics')) return false
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    return navigator.vibrate(HAPTICS[name])
  } catch {
    return false
  }
}
