import { afterEach, describe, expect, it, vi } from 'vitest'
import { COPY, independenceCopy, LAYER_NAMES, layerLabel, layerName, layerNumber, noteWhoLabel, studentName } from '@/copy'
import { applyTheme, parseThemeChoice, THEME_STORAGE_KEY } from '@/composables/useTheme'
import { formatDate, formatDateTime } from '@/utils/date'

describe('词表', () => {
  it('六层的名字符合规格', () => {
    expect(LAYER_NAMES).toEqual({ L1: '回忆定义', L2: '搭骨架', L3: '写证明', L4: '自检', L5: '换题试试', L6: '总结' })
  })

  it('层名、序号、带序号的标签；坏值返回空', () => {
    expect(layerName('L3')).toBe('写证明')
    expect(layerName(null)).toBe('')
    expect(layerNumber('L6')).toBe(6)
    expect(layerNumber('L9')).toBe(0)
    expect(layerLabel('L3')).toBe('第 3 层 · 写证明')
    expect(layerLabel(undefined)).toBe('')
  })

  it('独立度的说法：N 步里 M 步靠自己', () => {
    expect(independenceCopy(3, 4)).toBe('4 步里 3 步靠自己')
    expect(independenceCopy(9, 4)).toBe('4 步里 4 步靠自己')
    expect(independenceCopy(-1, 4)).toBe('4 步里 0 步靠自己')
    expect(independenceCopy(3, 0)).toBe('')
    expect(independenceCopy(null, null)).toBe('')
  })

  it('称呼只用昵称：匿名码和空值都叫“同学”', () => {
    expect(studentName('小明')).toBe('小明')
    expect(studentName('  小明 ')).toBe('小明')
    expect(studentName('S-TEST')).toBe(COPY.studentFallbackName)
    expect(studentName('S-AB12')).toBe(COPY.studentFallbackName)
    expect(studentName('')).toBe(COPY.studentFallbackName)
    expect(studentName(null)).toBe(COPY.studentFallbackName)
  })

  it('批注署名翻译掉内部层级', () => {
    expect(noteWhoLabel('H2 · 透露 0.5')).toBe('提示 · 用掉 0.5 额度')
    expect(noteWhoLabel('H1 · 追问')).toBe('追问')
    expect(noteWhoLabel('H3')).toBe('提示')
    expect(noteWhoLabel('批注')).toBe('批注')
    expect(noteWhoLabel('老师')).toBe('老师')
    expect(noteWhoLabel(null)).toBe('')
  })

  it('诚实说明不夸大：只核对关键步骤，以老师讲评为准', () => {
    expect(COPY.honestNote).toBe('系统核对关键步骤是否齐全，最终以老师讲评为准')
  })
})

describe('外观', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('只认 light / dark，其余都是跟随系统', () => {
    expect(parseThemeChoice('light')).toBe('light')
    expect(parseThemeChoice('dark')).toBe('dark')
    expect(parseThemeChoice('system')).toBe('system')
    expect(parseThemeChoice('紫色')).toBe('system')
    expect(parseThemeChoice(null)).toBe('system')
  })

  it('跟随系统时去掉 data-theme，手动时写上', () => {
    const attrs = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
    })
    applyTheme('dark')
    expect(attrs.get('data-theme')).toBe('dark')
    applyTheme('light')
    expect(attrs.get('data-theme')).toBe('light')
    applyTheme('system')
    expect(attrs.has('data-theme')).toBe(false)
  })

  it('boot.js 首屏恢复用的 key 和 useTheme 一致', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const boot = fs.readFileSync(path.resolve(__dirname, '../src/static/boot.js'), 'utf8')
    expect(boot).toContain("'" + THEME_STORAGE_KEY + "'")
  })
})

describe('日期格式', () => {
  it('统一格式；无效值返回空串', () => {
    const date = new Date(2026, 10, 3, 8, 5)
    expect(formatDate(date)).toBe('2026-11-03')
    expect(formatDateTime(date)).toBe('11-03 08:05')
    expect(formatDate(date.toISOString())).toBe('2026-11-03')
    expect(formatDate('不是日期')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatDateTime('')).toBe('')
  })
})
