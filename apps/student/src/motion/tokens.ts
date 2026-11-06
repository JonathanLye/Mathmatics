/**
 * 动效 token 的 JS 读法：时长的真源是 tokens.css，脚本里（数字滚动、吉祥物回落）也从那里读。
 * 没有 DOM（单测）时回退到同值常量。
 */
import { readCssToken } from '@/utils/themeTokens'

export const MOTION_FALLBACK_MS = { '--dur-fast': 120, '--dur-base': 220, '--dur-slow': 420 } as const
export type MotionToken = keyof typeof MOTION_FALLBACK_MS

/** "220ms" / "0.22s" → 220；解析不了返回 null。 */
export function parseDurationMs(value: string): number | null {
  const match = /^([\d.]+)(ms|s)$/.exec(value.trim())
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  return match[2] === 's' ? n * 1000 : n
}

export function motionMs(token: MotionToken): number {
  return parseDurationMs(readCssToken(token, String(MOTION_FALLBACK_MS[token]) + 'ms')) ?? MOTION_FALLBACK_MS[token]
}
