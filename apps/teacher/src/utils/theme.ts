// 教师端浅色/深色：共用 token 读 html[data-theme]，TDesign 读 html[theme-mode]，两个属性必须同时设置、永远一致。
// 初始值：上次的选择 > 系统偏好 > 浅色。选择记在本机浏览器里（读写都可能失败，失败就当没有）。
export type ThemeName = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pg_teacher_theme';

export function resolveTheme(saved: string | null | undefined, systemDark: boolean): ThemeName {
  if (saved === 'light' || saved === 'dark') return saved;
  return systemDark ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName, root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'> = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') root.setAttribute('theme-mode', 'dark');
  else root.removeAttribute('theme-mode');
}

export function readSavedTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveTheme(theme: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式等：这次选择只在本次打开期间有效
  }
}

/** 页面启动时调用一次，返回实际生效的主题。 */
export function initTheme(): ThemeName {
  const systemDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = resolveTheme(readSavedTheme(), systemDark);
  applyTheme(theme);
  return theme;
}
