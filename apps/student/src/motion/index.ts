/**
 * 动效套件。原则：全部由调用点主动触发（教师镜像不调用，所以安静、静止），全部能关。
 * CSS 部分在 styles/base.css：.pg-enter（页面进入）、.pg-press（按压回弹）、.pg-stagger（列表错峰）。
 */
export { motionMs, parseDurationMs } from './tokens'
export { useCountUp, countUpValue, easeOutCubic } from './useCountUp'
export { useMascot, mascotNext, MASCOT_MOTION, MASCOT_RETURN_MS } from './useMascot'
export type { MascotEvent, MascotState } from './useMascot'
export { fireConfetti, clearConfetti } from './confetti'
export { installSfxUnlock, playSfx, unlockSfx, SFX } from './sfx'
export type { SfxName } from './sfx'
export { vibrate, HAPTICS } from './haptics'
export type { HapticName } from './haptics'
export {
  DEFAULT_FEEDBACK_PREFS,
  feedbackAllowed,
  parseFeedbackPrefs,
  setFeedbackPref,
  setFeedbackTestMode,
  useFeedbackPrefs,
} from './useFeedbackPrefs'
export type { FeedbackPrefs } from './useFeedbackPrefs'
