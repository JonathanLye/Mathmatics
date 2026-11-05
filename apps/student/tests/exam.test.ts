/**
 * #46 严格测验模式（11 §5.2/5.3、04 §7）：纯逻辑单测 + 采集器拦截 + mock 服务端模拟 + SFC 编译检查。
 *
 * 边界：前端只渲染服务端 state，不做锁定/计数判定；mock sim 只给 e2e 用（显式 window hook）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  EXAM_MAX_SWITCHES_DEFAULT,
  WATERMARK_OPACITY,
  buildWatermarkSvg,
  cachedWatermarkBackground,
  clipboardDecision,
  detectFullscreenSupport,
  examAllowedHelp,
  examDeadlineMs,
  examLocked,
  examMaxWarnings,
  examWarnings,
  examWatermarkCode,
  formatCountdown,
  isExamTimeUp,
  isIosSafari,
  isStrictExam,
  leaveWarningText,
  remainingMs,
  requestExamFullscreen,
  serverOffsetMs,
  shouldBlockClipboard,
  shouldShowLeaveWarning,
  watermarkBackgroundImage,
  watermarkMinuteKey,
  watermarkStyle,
  watermarkText,
} from '@/components/exam/exam'
import { createMockState } from '@/mocks/attemptStates'
import { examMockAway, examMockUnlock } from '@/mocks/examSim'
import { attachIntegrityCapture } from '@/integrity/capture'
import type { AttemptState } from '@/types/attempt'

const EXAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/exam')

function examState(): AttemptState {
  return createMockState('exam-active')
}

describe('#46 倒计时：只格式化服务端时间，不本地结束', () => {
  it('formatCountdown：mm:ss、h:mm:ss、到点 00:00、缺失 —', () => {
    expect(formatCountdown(14 * 60_000 + 59_000)).toBe('14:59')
    expect(formatCountdown(60 * 60_000 + 2_000)).toBe('1:00:02')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-5000)).toBe('00:00')
    expect(formatCountdown(null)).toBe('—')
    expect(formatCountdown(Number.NaN)).toBe('—')
  })

  it('serverOffsetMs + remainingMs：按服务端 serverTime 校正客户端时钟', () => {
    const state = examState()
    const serverMs = Date.parse(state.serverTime)
    // 假设客户端时钟比服务端慢 60 秒：clientNow = serverNow - 60000
    const clientNow = serverMs - 60_000
    const offset = serverOffsetMs(state, clientNow)
    expect(offset).toBe(60_000)
    const deadline = examDeadlineMs(state)
    expect(deadline).not.toBeNull()
    // 截止时间距今 15 分钟；客户端慢 60 秒，显示应为 15:00（不是 14:00 或 16:00）
    expect(formatCountdown(remainingMs(deadline, offset, clientNow))).toBe('15:00')
  })

  it('isExamTimeUp：到点只用于显示「等待服务端提交」，不触发本地完成', () => {
    expect(isExamTimeUp(0)).toBe(true)
    expect(isExamTimeUp(-1)).toBe(true)
    expect(isExamTimeUp(1)).toBe(false)
    expect(isExamTimeUp(null)).toBe(false)
  })
})

describe('#46 水印（11 §5.3）：匿名码 · 日期 时:分 · 6% · 不可选中', () => {
  it('watermarkText/watermarkMinuteKey：按分钟格式化，缺码用「匿名码」占位', () => {
    const date = new Date(2026, 10, 4, 21, 43, 12)
    expect(watermarkMinuteKey(date)).toBe('2026-11-04 21:43')
    expect(watermarkText('S-7K2Q9M', date)).toBe('S-7K2Q9M · 2026-11-04 21:43')
    expect(watermarkText(null, date)).toBe('匿名码 · 2026-11-04 21:43')
    expect(watermarkText('   ', date)).toBe('匿名码 · 2026-11-04 21:43')
  })

  it('SVG data URI：转义文本、6% 不透明度、data:image/svg+xml', () => {
    const svg = buildWatermarkSvg('S-7K2Q9M · <2026> & "x"')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('fill-opacity="' + WATERMARK_OPACITY + '"')
    expect(svg).toContain('&lt;2026&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<2026>')
    const image = watermarkBackgroundImage('S-7K2Q9M · 2026-11-04 21:43')
    expect(image.startsWith('url("data:image/svg+xml,')).toBe(true)
    expect(image).not.toContain(' ')
  })

  it('watermarkStyle：pointer-events:none、user-select:none（不遮挡交互）', () => {
    const style = watermarkStyle('S-7K2Q9M · 2026-11-04 21:43')
    expect(style.pointerEvents).toBe('none')
    expect(style.userSelect).toBe('none')
    expect(style.backgroundRepeat).toBe('repeat')
  })

  it('cachedWatermarkBackground：同一分钟复用缓存，不同分钟重新生成', () => {
    const cache = new Map<string, string>()
    const a = cachedWatermarkBackground('S-7K2Q9M · 2026-11-04 21:43', cache)
    const b = cachedWatermarkBackground('S-7K2Q9M · 2026-11-04 21:43', cache)
    const c = cachedWatermarkBackground('S-7K2Q9M · 2026-11-04 21:44', cache)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(cache.size).toBe(2)
  })
})

describe('#46 全屏：支持探测 + 手势内请求', () => {
  it('isIosSafari：iPhone Safari 不支持，Chrome/Android 不算', () => {
    expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/122.0 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 13; Pixel 6) Chrome/122.0 Mobile Safari/537.36')).toBe(false)
    expect(isIosSafari(null)).toBe(false)
  })

  it('detectFullscreenSupport：有 requestFullscreen → supported；无 → unsupported；iOS Safari → ios-safari', () => {
    const supportedDoc = { documentElement: { requestFullscreen: () => Promise.resolve() } }
    expect(detectFullscreenSupport(supportedDoc)).toEqual({ supported: true, reason: null })
    expect(detectFullscreenSupport({ documentElement: {} }).reason).toBe('unsupported')
    expect(detectFullscreenSupport(supportedDoc, 'iPhone AppleWebKit Safari/604.1').reason).toBe('ios-safari')
  })

  it('requestExamFullscreen：成功 enter、拒绝 denied、不支持 unsupported', async () => {
    const okDoc = { documentElement: { requestFullscreen: () => Promise.resolve() }, fullscreenElement: null }
    await expect(requestExamFullscreen(okDoc)).resolves.toBe('enter')
    const deniedDoc = { documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } }
    await expect(requestExamFullscreen(deniedDoc)).resolves.toBe('denied')
    await expect(requestExamFullscreen(okDoc, 'iPhone AppleWebKit Safari/604.1')).resolves.toBe('unsupported')
  })
})

describe('#46 作答中限制：剪贴板/求助/警告文案（只读服务端字段）', () => {
  it('shouldBlockClipboard：仅 test 且已开始；clipboardDecision 映射事件类型', () => {
    expect(shouldBlockClipboard('practice', true)).toBe(false)
    expect(shouldBlockClipboard('test', false)).toBe(false)
    expect(shouldBlockClipboard('test', true)).toBe(true)
    expect(clipboardDecision('paste', 'test', true)).toEqual({ block: true, reportType: 'paste' })
    expect(clipboardDecision('copy', 'practice', true)).toEqual({ block: false, reportType: 'integ.copy' })
    expect(clipboardDecision('contextmenu', 'test', true).reportType).toBe('integ.contextmenu')
  })

  it('leaveWarningText / shouldShowLeaveWarning：只根据服务端 warnings 增量显示', () => {
    expect(leaveWarningText(1)).toBe('你已离开 1 次（第 3 次将锁定本题）')
    expect(leaveWarningText(2, 4)).toBe('你已离开 2 次（第 4 次将锁定本题）')
    expect(shouldShowLeaveWarning(0, 1, false)).toBe(true)
    expect(shouldShowLeaveWarning(1, 2, false)).toBe(true)
    expect(shouldShowLeaveWarning(2, 3, false)).toBe(false)
    expect(shouldShowLeaveWarning(0, 1, true)).toBe(false)
    expect(shouldShowLeaveWarning(2, 1, false)).toBe(false)
    expect(shouldShowLeaveWarning(undefined, 1, false)).toBe(true)
  })

  it('examAllowedHelp / examMaxWarnings / examWarnings / examLocked 都是只读 helper', () => {
    const state = examState()
    expect(isStrictExam(state)).toBe(true)
    expect(examAllowedHelp(state)).toBe('off')
    expect(examMaxWarnings(state)).toBe(3)
    expect(examWarnings(state)).toBe(0)
    expect(examLocked(state)).toBe(false)
    expect(examMaxWarnings({ ...state, integrity: { ...state.integrity, maxWarnings: null } })).toBe(EXAM_MAX_SWITCHES_DEFAULT)
    expect(examAllowedHelp({ ...state, exam: undefined })).toBe('concept') // 缺省「可只开概念」
  })

  it('examWatermarkCode 优先级：integrity > exam > Me.anonCode > 占位', () => {
    const state = examState()
    expect(examWatermarkCode(state, 'ME-CODE')).toBe('S-7K2Q9M')
    expect(examWatermarkCode({ ...state, integrity: { ...state.integrity, watermark: null } }, 'ME-CODE')).toBe('S-7K2Q9M')
    expect(examWatermarkCode({ ...state, exam: undefined, integrity: { ...state.integrity, watermark: null } }, 'ME-CODE')).toBe('ME-CODE')
    expect(examWatermarkCode({ ...state, exam: undefined, integrity: { ...state.integrity, watermark: null } }, null)).toBe('匿名码')
  })
})

describe('#46 mock 服务端模拟（仅 e2e）：切出计数/锁定/解锁', () => {
  it('away()：warnings 0→1→2→3，第 3 次由「服务端」锁定；锁后 away 不再变化', () => {
    const first = examMockAway(examState())
    expect(first?.integrity?.warnings).toBe(1)
    expect(first?.status).toBe('active')
    const second = examMockAway(first as AttemptState)
    expect(second?.integrity?.warnings).toBe(2)
    const third = examMockAway(second as AttemptState)
    expect(third?.integrity?.warnings).toBe(3)
    expect(third?.status).toBe('locked')
    expect(third?.integrity?.locked).toBe(true)
    expect(examMockAway(third as AttemptState)).toBeNull()
  })

  it('unlock()：恢复 active、locked=false，warnings 保留（11 §5.2 计数不清零）', () => {
    const locked = createMockState('exam-locked')
    const unlocked = examMockUnlock(locked)
    expect(unlocked?.status).toBe('active')
    expect(unlocked?.integrity?.locked).toBe(false)
    expect(unlocked?.integrity?.warnings).toBe(3)
    expect(examMockUnlock(unlocked as AttemptState)).toBeNull()
  })

  it('练习模式 state 不参与测验模拟', () => {
    expect(examMockAway(createMockState('l3-active'))).toBeNull()
    expect(examMockUnlock(createMockState('l3-active'))).toBeNull()
    expect(createMockState('exam-locked').mode).toBe('test')
    expect(isStrictExam(createMockState('exam-locked'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 采集器：测验模式拦截 + blocked 上报（11 §3/§5.2）
// ---------------------------------------------------------------------------
type Listener = (event?: unknown) => void
function fakeDom() {
  const docListeners = new Map<string, Set<Listener>>()
  const winListeners = new Map<string, Set<Listener>>()
  const document = {
    visibilityState: 'visible',
    fullscreenElement: null,
    activeElement: { dataset: { pgTarget: 'line_statement' }, tagName: 'TEXTAREA', selectionStart: 0, selectionEnd: 0 },
    getSelection: () => ({ toString: () => 'secret' }),
    addEventListener(type: string, listener: Listener) {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type)?.add(listener)
    },
    removeEventListener(type: string, listener: Listener) {
      docListeners.get(type)?.delete(listener)
    },
  }
  const window = {
    addEventListener(type: string, listener: Listener) {
      if (!winListeners.has(type)) winListeners.set(type, new Set())
      winListeners.get(type)?.add(listener)
    },
    removeEventListener(type: string, listener: Listener) {
      winListeners.get(type)?.delete(listener)
    },
    matchMedia: () => ({ matches: false }),
  }
  function dispatch(target: 'doc' | 'win', type: string, event?: unknown): void {
    for (const listener of Array.from((target === 'doc' ? docListeners : winListeners).get(type) ?? [])) listener(event)
  }
  return { document, window, dispatch }
}

describe('#46 测验模式剪贴板拦截（采集器）', () => {
  it('shouldBlockClipboard=true：copy/cut/paste/contextmenu 全部 preventDefault 且上报 blocked', () => {
    const dom = fakeDom()
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    let blocked = true
    const detach = attachIntegrityCapture({
      report: (type, payload = {}) => events.push({ type, payload }),
      doc: dom.document as unknown as Document,
      win: dom.window as unknown as Window,
      isDesktop: false,
      shouldBlockClipboard: () => blocked,
    })
    const prevented: string[] = []
    const event = (name: string) => ({ preventDefault: () => prevented.push(name) })
    dom.dispatch('doc', 'copy', event('copy'))
    dom.dispatch('doc', 'cut', event('cut'))
    dom.dispatch('doc', 'paste', { preventDefault: () => prevented.push('paste'), clipboardData: { getData: () => 'xy' } })
    dom.dispatch('doc', 'contextmenu', event('contextmenu'))
    dom.dispatch('doc', 'selectstart', event('selectstart'))
    expect(prevented).toEqual(['copy', 'cut', 'paste', 'contextmenu', 'selectstart'])
    expect(events.map((item) => item.type)).toEqual(['integ.copy', 'integ.cut', 'paste', 'integ.contextmenu'])
    expect(events[0]?.payload).toEqual({ chars: 6, blocked: true })
    expect(events[2]?.payload).toEqual({ target: 'line_statement', chars: 2, blocked: true })
    expect(events[3]?.payload).toEqual({ blocked: true })
    blocked = false
    detach()
    dom.dispatch('doc', 'copy', event('copy2'))
    expect(prevented).toHaveLength(5)
  })

  it('练习模式（开关 false）：保持原行为，不 preventDefault、blocked:false', () => {
    const dom = fakeDom()
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const detach = attachIntegrityCapture({
      report: (type, payload = {}) => events.push({ type, payload }),
      doc: dom.document as unknown as Document,
      win: dom.window as unknown as Window,
      isDesktop: false,
      shouldBlockClipboard: () => false,
    })
    const prevented: string[] = []
    dom.dispatch('doc', 'copy', { preventDefault: () => prevented.push('copy') })
    dom.dispatch('doc', 'paste', { preventDefault: () => prevented.push('paste'), clipboardData: { getData: () => 'xy' } })
    expect(prevented).toEqual([])
    expect(events[0]?.payload).toEqual({ chars: 6 })
    expect(events[1]?.payload).toEqual({ target: 'line_statement', chars: 2, blocked: false })
    detach()
  })
})

// ---------------------------------------------------------------------------
// 4 个测验组件 SFC 编译检查（@vue/compiler-sfc，解析方式同 mirror.test.ts）
// ---------------------------------------------------------------------------
interface CompilerSfcLike {
  parse: (source: string, options?: Record<string, unknown>) => { descriptor: Record<string, any>; errors: unknown[] }
  compileScript: (descriptor: Record<string, any>, options?: Record<string, unknown>) => { content: string }
  compileTemplate: (options: Record<string, unknown>) => { code: string; errors: unknown[] }
  compileStyle: (options: Record<string, unknown>) => { errors: unknown[] }
}
let sfc: CompilerSfcLike
const SFC_FILES = ['ExamIntro.vue', 'ExamWatermark.vue', 'ExamLeaveModal.vue', 'ExamLockOverlay.vue']
function resolveCompilerSfcEntry(): string {
  const nodeRequire = createRequire(import.meta.url)
  try {
    return nodeRequire.resolve('@vue/compiler-sfc')
  } catch {
    const uniCliShared = nodeRequire.resolve('@dcloudio/uni-cli-shared/package.json')
    return createRequire(uniCliShared).resolve('@vue/compiler-sfc')
  }
}
function readSfc(file: string): string {
  return fs.readFileSync(path.join(EXAM_DIR, file), 'utf8')
}
beforeAll(async () => {
  const entry = pathToFileURL(resolveCompilerSfcEntry()).href
  const loaded: Record<string, unknown> = await import(entry)
  sfc = (loaded.default ?? loaded) as unknown as CompilerSfcLike
})
describe('#46 测验组件 SFC 编译检查', () => {
  it.each(SFC_FILES)('%s 可解析且含 script setup / template', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    expect(result.errors).toEqual([])
    expect(result.descriptor.scriptSetup).toBeTruthy()
    expect(result.descriptor.template).toBeTruthy()
  })
  it.each(SFC_FILES)('%s script setup 与 template 可编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const id = 'exam-' + file.replace('.vue', '')
    expect(() => sfc.compileScript(result.descriptor, { id })).not.toThrow()
    const template = sfc.compileTemplate({ source: result.descriptor.template.content, filename: file, id, scoped: true })
    expect(template.errors).toEqual([])
  })
  it.each(SFC_FILES)('%s scoped style 可编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    for (const style of result.descriptor.styles ?? []) {
      const compiled = sfc.compileStyle({ source: style.content, filename: file, id: 'data-v-test', scoped: true })
      expect(compiled.errors).toEqual([])
    }
  })
})
