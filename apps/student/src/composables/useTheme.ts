/**
 * 外观：跟随系统 / 浅色 / 深色。写到 html[data-theme]（tokens.css 据此切换），选择存在本机。
 * static/boot.js 在首屏前读同一个 key，避免闪一下错误的主题。
 */
import { ref, type Ref } from 'vue'

export type ThemeChoice = 'system' | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'pg.theme'

export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

function readStored(): ThemeChoice {
  try {
    return typeof localStorage === 'undefined' ? 'system' : parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
}

const choice = ref<ThemeChoice>(readStored())

export function setTheme(next: ThemeChoice): void {
  choice.value = next
  applyTheme(next)
  try {
    if (typeof localStorage !== 'undefined') {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    }
  } catch {
    /* 隐私模式写不进去：本次会话仍然生效 */
  }
}

export function useTheme(): { theme: Ref<ThemeChoice>; setTheme: typeof setTheme } {
  return { theme: choice, setTheme }
}
