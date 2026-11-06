/**
 * 深色模式修复回归（D1/D2/D3；Refs #37 上线检查）。
 *
 * - D1：四个图解的 uni <slider> 不再硬编码浅色值，改读主题 token；
 * - D2：水印 fill 跟随 --ink（深色下可见），缓存 key 含主题色；
 * - D3：主色按钮文字用 --on-accent（浅色/深色都能满足对比度），不再写死 #fff；token 对比度全部在这里强制；
 * - 深色截图脚本：screenshots.mjs 支持 --dark / DARK=1。
 *
 * 只做静态/纯函数断言；真实深色渲染由 e2e:screens:dark 截图覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { FALLBACK_TOKEN, readCssToken, readThemeColors } from '@/utils/themeTokens'
import { buildWatermarkSvg, cachedWatermarkBackground } from '@/components/exam/exam'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = path.join(APP_DIR, 'src')
/** ui-math 是独立 workspace 包，#155 的深色扫描只扫了 apps/student/src，漏掉了它（#164）。 */
const UI_MATH_DIR = path.resolve(APP_DIR, '..', '..', 'packages', 'ui-math', 'src')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC_DIR, rel), 'utf8')
}

const DIAGRAMS = [
  'components/diagrams/SeqBandDiagram.vue',
  'components/diagrams/FuncBandDiagram.vue',
  'components/diagrams/MonotoneStepsDiagram.vue',
  'components/diagrams/PartialSumsDiagram.vue',
]

describe('D1：图解滑块颜色读主题 token（深色下轨道/滑块可读）', () => {
  it('四个图解都用 useThemeToken，且不再硬编码 #2b4fa3 / #e2e4e8', () => {
    for (const file of DIAGRAMS) {
      const src = read(file)
      expect(src, file).toContain('useThemeToken')
      expect(src, file).toContain(':active-color="sliderAccent"')
      expect(src, file).toContain(':background-color="sliderRule"')
      expect(src, file).not.toContain('active-color="#2b4fa3"')
      expect(src, file).not.toContain('background-color="#e2e4e8"')
    }
  })
})

describe('D2：水印 fill 跟随主题 --ink', () => {
  it('buildWatermarkSvg 可显式传 ink；默认在 Node 回退浅色 #1d2430', () => {
    expect(buildWatermarkSvg('S-1 · 2026-11-05 09:00')).toContain('fill="' + FALLBACK_TOKEN.ink + '"')
    expect(buildWatermarkSvg('S-1 · 2026-11-05 09:00', '#e4e8ef')).toContain('fill="#e4e8ef"')
  })

  it('cachedWatermarkBackground 的缓存 key 含主题色：同文本换主题会重新生成', () => {
    const cache = new Map<string, string>()
    const light = cachedWatermarkBackground('S-1 · 2026-11-05 09:00', cache, '#1d2430')
    const dark = cachedWatermarkBackground('S-1 · 2026-11-05 09:00', cache, '#e4e8ef')
    expect(light).not.toBe(dark)
    expect(cache.size).toBe(2)
    expect(light).toContain(encodeURIComponent('#1d2430'))
    expect(dark).toContain(encodeURIComponent('#e4e8ef'))
  })
})

const TOKENS_CSS = fs.readFileSync(path.resolve(APP_DIR, '..', '..', 'packages', 'ui-tokens', 'tokens.css'), 'utf8')

function walkVue(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkVue(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

describe('D3：文字色不写死 #fff；token 只有一个来源', () => {
  it('学生端 tokens.css 只是引入共用包；共用包定义 --on-accent，浅色纸面是白色', () => {
    expect(read('styles/tokens.css')).toContain("@import '@proof-gym/ui-tokens/tokens.css'")
    expect(TOKENS_CSS).toMatch(/--on-accent:\s*#[0-9a-fA-F]{6}/)
    expect(FALLBACK_TOKEN.paper).toBe('#ffffff')
  })

  it('学生端和 ui-math 的 .vue 都没有写死 #fff 文字色（登录页归登录任务）', () => {
    const vue = [...walkVue(SRC_DIR), ...walkVue(UI_MATH_DIR)].filter((file) => !file.includes(path.join('pages', 'login')))
    const hits = vue.filter((file) => /(?<![-\w])color:\s*#fff\b/.test(fs.readFileSync(file, 'utf8')))
    expect(hits).toEqual([])
    // #164：ProofKeyboard「完成」按钮曾因此漏扫
    const keyboard = fs.readFileSync(path.join(UI_MATH_DIR, 'ProofKeyboard.vue'), 'utf8')
    const doneRule = keyboard.match(/\.ui-pk__action--done\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(doneRule).toContain('background: var(--accent')
    expect(doneRule).toContain('color: var(--on-accent')
  })
})

// ---------------------------------------------------------------------------
// 对比度（WCAG 2.x AA 正文 ≥ 4.5:1）。三份值的顺序：浅色 / 跟随系统的深色 / html[data-theme=dark]。
// ---------------------------------------------------------------------------

/** 按出现顺序取某个 token 的所有十六进制定义。 */
function tokenHexes(css: string, name: string): string[] {
  const re = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})\\b', 'g')
  return Array.from(css.matchAll(re)).map((m) => m[1])
}

/** WCAG 相对亮度。 */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** 对比度（1–21）。 */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 第 theme 份（0 浅色、1 深色）；深色没重定义的 token 沿用浅色值。 */
function tokenAt(name: string, theme: 0 | 1): string {
  const values = tokenHexes(TOKENS_CSS, name)
  const hex = values[theme] ?? values[0]
  if (!hex) throw new Error('tokens.css 里没有 --' + name)
  return hex
}

const THEMES: Array<[string, 0 | 1]> = [
  ['浅色', 0],
  ['深色', 1],
]

describe.each(THEMES)('对比度 ≥ 4.5（%s）', (_label, theme) => {
  const pair = (fg: string, bg: string) => contrastRatio(tokenAt(fg, theme), tokenAt(bg, theme))

  it('按钮：每种面色上的文字色', () => {
    expect(pair('on-accent', 'accent')).toBeGreaterThanOrEqual(4.5)
    expect(pair('on-sea', 'sea')).toBeGreaterThanOrEqual(4.5)
    expect(pair('on-bee', 'bee')).toBeGreaterThanOrEqual(4.5)
    expect(pair('on-ok', 'ok')).toBeGreaterThanOrEqual(4.5)
    expect(pair('on-fox', 'fox')).toBeGreaterThanOrEqual(4.5)
    expect(pair('on-danger', 'danger-face')).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['ink', 'ink-2', 'accent-text', 'sea-text', 'bee-text', 'ok-text', 'fox-text', 'chili-text'])('%s 在纸面和卡片上', (fg) => {
    expect(pair(fg, 'paper')).toBeGreaterThanOrEqual(4.5)
    expect(pair(fg, 'sheet')).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['accent-text', 'accent-soft'],
    ['sea-text', 'sea-soft'],
    ['bee-text', 'bee-soft'],
    ['ok-text', 'ok-soft'],
    ['fox-text', 'fox-soft'],
    ['chili-text', 'chili-soft'],
    ['ink', 'accent-soft'],
    ['ink', 'sea-soft'],
    ['ink', 'bee-soft'],
    ['ink-2', 'paper-2'],
  ])('%s 在 %s 上（标签、批注）', (fg, bg) => {
    expect(pair(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('轻提示：toast-ink 在 toast-bg 上', () => {
    expect(pair('toast-ink', 'toast-bg')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('token 结构', () => {
  it('两处深色（媒体查询 / html[data-theme]）的值逐个一致', () => {
    // 只按真正的块头切；文件头注释里也提到了这两个选择器。
    const blocks = TOKENS_CSS.split(/@media \(prefers-color-scheme: dark\) \{|html\[data-theme='dark'\] \{/)
    expect(blocks).toHaveLength(3)
    const media = Array.from(blocks[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)).map((m) => m[1] + '=' + m[2])
    const manual = Array.from(blocks[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)).map((m) => m[1] + '=' + m[2])
    expect(media.length).toBeGreaterThan(20)
    expect(manual).toEqual(media)
  })

  it('html[data-theme=light] 能压住系统深色', () => {
    expect(TOKENS_CSS).toContain(":root:not([data-theme='light'])")
  })

  it('根因回归：主色面上写死 #fff 达不到 4.5（所以必须用 --on-accent）', () => {
    expect(contrastRatio('#ffffff', tokenAt('accent', 0))).toBeLessThan(4.5)
  })

  it('FALLBACK_TOKEN 和 tokens.css 的浅色值同步', () => {
    expect(FALLBACK_TOKEN.accent).toBe(tokenAt('accent', 0))
    expect(FALLBACK_TOKEN.rule).toBe(tokenAt('rule', 0))
    expect(FALLBACK_TOKEN.ink).toBe(tokenAt('ink', 0))
    expect(FALLBACK_TOKEN.paper).toBe(tokenAt('paper', 0))
  })
})

describe('主题 token 读取（无 DOM 时的兜底）', () => {
  it('readCssToken 在 Node 无 document 时返回 fallback', () => {
    expect(readCssToken('--accent', FALLBACK_TOKEN.accent)).toBe(FALLBACK_TOKEN.accent)
    expect(readCssToken('--ink', FALLBACK_TOKEN.ink)).toBe(FALLBACK_TOKEN.ink)
  })

  it('readThemeColors 返回浅色兜底值（真实计算值由浏览器截图验证）', () => {
    expect(readThemeColors()).toEqual({
      accent: FALLBACK_TOKEN.accent,
      rule: FALLBACK_TOKEN.rule,
      ink: FALLBACK_TOKEN.ink,
    })
  })
})

describe('深色截图脚本', () => {
  it('screenshots.mjs 支持 --dark / DARK=1，context colorScheme 与输出目录分离', () => {
    const script = fs.readFileSync(path.join(APP_DIR, 'tests/screenshots.mjs'), 'utf8')
    expect(script).toContain("--dark")
    expect(script).toContain("colorScheme")
    expect(script).toContain("screens-dark")
  })
})
