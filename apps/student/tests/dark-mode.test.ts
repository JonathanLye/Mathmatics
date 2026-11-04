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
  it('tokens.css 定义 --on-accent: var(--paper)（深色随 --paper 自动切换）', () => {
    const css = read('styles/tokens.css')
    expect(css).toContain('--on-accent: var(--paper)')
    expect(FALLBACK_TOKEN.paper).toBe('#f7f6f2')
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
