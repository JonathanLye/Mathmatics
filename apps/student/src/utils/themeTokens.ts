/**
 * 读取主题 CSS token 的纯函数（深色模式修复，D1/D2；Refs #37）。
 *
 * 边界：
 * - 只在浏览器（H5）里有 DOM/getComputedStyle；Node 单测/小程序没有 DOM，回退到常量。
 * - 返回的是当前计算值（如 "#8fb0ff"/"#2c3442"），可直接作为 uni <slider>/SVG fill 的颜色。
 * - 不在本模块监听主题变化：需要响应切换的组件用 composables/useThemeToken.ts。
 */

/** 浅色 token 兜底值（tokens.css :root 的静态值；无 DOM 时使用）。 */
export const FALLBACK_TOKEN = {
  accent: '#58cc02',
  rule: '#e5e5e5',
  ink: '#3c3c3c',
  paper: '#ffffff',
} as const

/** 读取 CSS 自定义属性（如 "--accent"）；没有 DOM、异常或空值时回退 fallback。 */
export function readCssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
  } catch {
    return fallback
  }
}

/** 当前主题的常用颜色（水印/滑块用）；每次调用都重新读，避免缓存到浅色值。 */
export function readThemeColors(): { accent: string; rule: string; ink: string } {
  return {
    accent: readCssToken('--accent', FALLBACK_TOKEN.accent),
    rule: readCssToken('--rule', FALLBACK_TOKEN.rule),
    ink: readCssToken('--ink', FALLBACK_TOKEN.ink),
  }
}
