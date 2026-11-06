/**
 * 深色模式修复回归（D1/D2/D3；Refs #37 上线检查）。
 *
 * - D1：四个图解的 uni <slider> 不再硬编码浅色值，改读主题 token；
 * - D2：水印 fill 跟随 --ink（深色下可见），缓存 key 含主题色；
 * - D3：主色按钮文字用 --on-accent（浅色/深色都能满足对比度），不再写死 #fff；
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

describe('D3：主色按钮文字用 --on-accent，不写死 #fff', () => {
  it('tokens.css 定义 --on-accent（v2：亮绿面上用深字，不再等于 --paper）', () => {
    const css = read('styles/tokens.css')
    expect(css).toMatch(/--on-accent:\s*#[0-9a-fA-F]{6}/)
    expect(FALLBACK_TOKEN.paper).toBe('#ffffff')
  })

  it('13 处主色按钮已替换；唯一保留的 color:#fff 是深色遮罩上的 toast', () => {
    const vueFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.vue')) vueFiles.push(full)
      }
    }
    walk(SRC_DIR)
    const hits = vueFiles.filter((file) => /color:\s*#fff/.test(fs.readFileSync(file, 'utf8')))
    const rel = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join('/')
    expect(hits.map(rel)).toEqual(['pages/practice/index.vue'])
    const practice = read('pages/practice/index.vue')
    expect(practice).toContain('rgba(29, 36, 48, 0.92)')
    expect(practice).toContain('color: var(--on-accent)')

    // #164：ui-math 也不能有写死的 #fff 文字色（ProofKeyboard「完成」按钮曾因此漏扫）
    const uiMathVue: string[] = []
    const walkUiMath = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walkUiMath(full)
        else if (entry.name.endsWith('.vue')) uiMathVue.push(full)
      }
    }
    walkUiMath(UI_MATH_DIR)
    const uiMathHits = uiMathVue.filter((file) => /color:\s*#fff\b/.test(fs.readFileSync(file, 'utf8')))
    expect(uiMathHits.map((file) => path.relative(UI_MATH_DIR, file).split(path.sep).join('/'))).toEqual([])

    const keyboard = fs.readFileSync(path.join(UI_MATH_DIR, 'ProofKeyboard.vue'), 'utf8')
    const doneRule = keyboard.match(/\.ui-pk__action--done\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(doneRule).toContain('background: var(--accent')
    expect(doneRule).toContain('color: var(--on-accent')
  })
})

// ---------------------------------------------------------------------------
// #164：主色按钮文字对比度（WCAG 2.x AA 正文 ≥4.5:1）
// tokens.css 的唯一真源在 apps/student；ui-math 用 var(--on-accent, var(--paper, #fff)) 消费。
// ---------------------------------------------------------------------------

/** 从 tokens.css 按出现顺序取某个 token 的 3 份值（浅色 / dark 媒体查询 / html[data-theme=dark]）。 */
function tokenHexes(css: string, name: string): string[] {
  const re = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})', 'g')
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

describe('#164：厚边按钮「面色 + 文字色」对比度 ≥ 4.5（v2 token）', () => {
  const css = read('styles/tokens.css')
  const first = (name: string): string => {
    const hex = tokenHexes(css, name)[0]
    expect(hex, '--' + name).toBeTruthy()
    return hex
  }

  it('主色按钮：--on-accent 在 --accent 上 ≥ 4.5（浅/深色共用，深色不重定义 accent）', () => {
    expect(tokenHexes(css, 'accent')).toHaveLength(1)
    expect(contrastRatio(first('accent'), first('on-accent'))).toBeGreaterThanOrEqual(4.5)
  })

  it('蓝/黄按钮：--on-margin 在 --margin 上、--on-hint 在 --hint-fill 上 ≥ 4.5', () => {
    expect(contrastRatio(first('margin'), first('on-margin'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(first('hint-fill'), first('on-hint'))).toBeGreaterThanOrEqual(4.5)
  })

  it('红按钮（白字）：--danger-face 上白字 ≥ 4.5；完成页深草绿 #3c8400 上白字 ≥ 4.5', () => {
    expect(contrastRatio(first('danger-face'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#3c8400', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('深色文字色（--ink-2 / --accent-text / --margin-text）在深色底 --paper 上 ≥ 4.5；浅色同理', () => {
    const light = { paper: tokenHexes(css, 'paper')[0], ink2: tokenHexes(css, 'ink-2')[0], accentText: tokenHexes(css, 'accent-text')[0], marginText: tokenHexes(css, 'margin-text')[0] }
    const darkPaper = tokenHexes(css, 'paper')[1]
    const dark = { ink2: tokenHexes(css, 'ink-2')[1], accentText: tokenHexes(css, 'accent-text')[1], marginText: tokenHexes(css, 'margin-text')[1] }
    expect(darkPaper).toBeTruthy()
    for (const c of [light.ink2, light.accentText, light.marginText]) expect(contrastRatio(light.paper, c)).toBeGreaterThanOrEqual(4.5)
    // --ink-2 在深色里有重定义；accent-text / margin-text 深色也有
    for (const c of [dark.ink2, dark.accentText, dark.marginText]) expect(contrastRatio(darkPaper, c)).toBeGreaterThanOrEqual(4.5)
  })

  it('两处深色（媒体查询 / html[data-theme]）的 paper 必须一致', () => {
    const papers = tokenHexes(css, 'paper')
    expect(papers.length).toBeGreaterThanOrEqual(3)
    expect(papers[1]).toBe(papers[2])
  })

  it('#164 根因回归：主色面上写死 #fff 达不到 4.5（所以必须用 --on-accent）', () => {
    expect(contrastRatio('#ffffff', first('accent'))).toBeLessThan(4.5)
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
