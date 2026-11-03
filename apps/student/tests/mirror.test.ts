import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildMirrorUrl,
  buildTimeline,
  clamp,
  formatTime,
  isMarkerType,
  isMirrorPageUrl,
  isMixedContent,
  isValidAttemptId,
  isValidMirrorToken,
  markerLabel,
  markerPercent,
  markerTone,
  nextMarker,
  parseSseData,
  parseSseFrames,
  redactMirrorToken,
  sanitizeMirrorUrlForLog,
  seekIndex,
} from '@/components/mirror/mirror'
import type { MirrorEvent, TimelineMarker } from '@/components/mirror/mirror'
import { createMirrorDemoEvents, createMirrorDemoTimeline, MIRROR_DEMO_EVENTS } from '@/components/mirror/mirrorDemo'

// issue #43 A 侧子集：镜像 URL/token 安全、回放时间轴、SSE 帧解析的纯逻辑单测（CI 跑 pnpm test）。

const TOKEN = 'mirror_token_abcdef123456'
const ATTEMPT = '11111111-1111-4111-8111-111111111111'

function makeEvent(seq: number, type: string, tsServer: string, payload?: Record<string, unknown>, layer?: string): MirrorEvent {
  return { seq, type, tsServer, payload: payload ?? null, layer: layer ?? null }
}

const T0 = '2026-11-03T10:00:00.000Z'
const T1 = '2026-11-03T10:01:00.000Z'
const T2 = '2026-11-03T10:02:30.000Z'

describe('buildMirrorUrl（issue #43 镜像地址）', () => {
  it('origin base → /s/mirror?attempt&token', () => {
    expect(buildMirrorUrl('https://student.example.com', ATTEMPT, TOKEN)).toBe(
      'https://student.example.com/s/mirror?attempt=' + ATTEMPT + '&token=' + TOKEN,
    )
  })

  it('带子路径的 base 拼在子路径下', () => {
    expect(buildMirrorUrl('https://student.example.com/proof-gym/', 'attempt-1', TOKEN)).toBe(
      'https://student.example.com/proof-gym/s/mirror?attempt=attempt-1&token=' + TOKEN,
    )
  })

  it('base 已指向 /s/mirror 时不重复拼接，并清掉原 query/hash', () => {
    expect(buildMirrorUrl('https://student.example.com/s/mirror?foo=1#x', 'attempt-1', TOKEN)).toBe(
      'https://student.example.com/s/mirror?attempt=attempt-1&token=' + TOKEN,
    )
  })

  it('非法 token 抛通用错误且错误信息不回显 token', () => {
    const bad = 'bad token with spaces'
    let message = ''
    try {
      buildMirrorUrl('https://student.example.com', ATTEMPT, bad)
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('token')
    expect(message).not.toContain('bad token')
  })

  it('拒绝 javascript: / data: / 相对 base', () => {
    expect(() => buildMirrorUrl('javascript:alert(1)', ATTEMPT, TOKEN)).toThrow()
    expect(() => buildMirrorUrl('data:text/html,x', ATTEMPT, TOKEN)).toThrow()
    expect(() => buildMirrorUrl('/relative/path', ATTEMPT, TOKEN)).toThrow()
    expect(() => buildMirrorUrl('', ATTEMPT, TOKEN)).toThrow()
  })

  it('拒绝空 attemptId 与带 / ? & # 的 attemptId', () => {
    expect(() => buildMirrorUrl('https://student.example.com', '   ', TOKEN)).toThrow()
    expect(() => buildMirrorUrl('https://student.example.com', 'a/b', TOKEN)).toThrow()
    expect(() => buildMirrorUrl('https://student.example.com', 'a&b', TOKEN)).toThrow()
  })
})

describe('isValidMirrorToken / isValidAttemptId', () => {
  it.each([
    'mirror_token_abcdef123456',
    'eyJhbGciOiJIUzI1NiJ9.eyJhdHRlbXB0IjoiMSJ9.signature-part',
    '12345678',
    'a'.repeat(512),
  ])('接受 URL-safe 的 token：%s', (token) => {
    expect(isValidMirrorToken(token)).toBe(true)
  })

  it.each([
    ['', '空串'],
    ['1234567', '7 字符太短'],
    ['a'.repeat(513), '513 字符太长'],
    ['has space token', '空白'],
    ['token&inject=1', '会破坏查询串'],
    ['token/with/slash', '斜杠'],
    ['token?x=1', '问号'],
  ])('拒绝 token：%s（%s）', (token) => {
    expect(isValidMirrorToken(token)).toBe(false)
  })

  it('拒绝非字符串 token', () => {
    expect(isValidMirrorToken(null)).toBe(false)
    expect(isValidMirrorToken(undefined)).toBe(false)
    expect(isValidMirrorToken(12345678)).toBe(false)
  })

  it('attemptId 接受 uuid 与演示 id，拒绝空/控制字符/过长/危险字符', () => {
    expect(isValidAttemptId(ATTEMPT)).toBe(true)
    expect(isValidAttemptId('attempt-epsN')).toBe(true)
    expect(isValidAttemptId('')).toBe(false)
    expect(isValidAttemptId('   ')).toBe(false)
    expect(isValidAttemptId('a\u0000b')).toBe(false)
    expect(isValidAttemptId('x'.repeat(129))).toBe(false)
    expect(isValidAttemptId('a?b')).toBe(false)
  })
})

describe('日志脱敏（token 不进日志）', () => {
  it('redactMirrorToken 只保留长度，不含 token 原文', () => {
    const redacted = redactMirrorToken(TOKEN)
    expect(redacted).toBe('<mirror-token len=' + TOKEN.length + '>')
    expect(redacted).not.toContain(TOKEN)
    expect(redactMirrorToken('')).toBe('<mirror-token missing>')
  })

  it('sanitizeMirrorUrlForLog 把 token 参数替换成 *** 并保留 attempt', () => {
    const url = 'https://student.example.com/s/mirror?attempt=' + ATTEMPT + '&token=' + TOKEN
    const safe = sanitizeMirrorUrlForLog(url)
    expect(safe).not.toContain(TOKEN)
    expect(safe).toContain('token=***')
    expect(safe).toContain('attempt=' + ATTEMPT)
  })

  it('非绝对 URL 也走正则兜底脱敏', () => {
    const safe = sanitizeMirrorUrlForLog('/s/mirror?attempt=a1&token=' + TOKEN + '&x=1')
    expect(safe).not.toContain(TOKEN)
    expect(safe).toContain('token=***')
  })
})

describe('isMirrorPageUrl / isMixedContent（iframe 装载前校验）', () => {
  it('合法镜像 URL 通过；缺 token / 错路径 / 非 http(s) 拒绝', () => {
    expect(isMirrorPageUrl('https://student.example.com/s/mirror?attempt=' + ATTEMPT + '&token=' + TOKEN)).toBe(true)
    expect(isMirrorPageUrl('http://student.example.com/s/mirror?attempt=a1&token=' + TOKEN)).toBe(true)
    expect(isMirrorPageUrl('https://student.example.com/s/mirror?attempt=' + ATTEMPT)).toBe(false)
    expect(isMirrorPageUrl('https://student.example.com/other?attempt=a1&token=' + TOKEN)).toBe(false)
    expect(isMirrorPageUrl('javascript:alert(1)')).toBe(false)
    expect(isMirrorPageUrl('/s/mirror?attempt=a1&token=' + TOKEN)).toBe(false)
    expect(isMirrorPageUrl('')).toBe(false)
  })

  it('https 页面拒绝 http 镜像（混合内容），http 页面不拦', () => {
    expect(isMixedContent('http://student.example.com/s/mirror?x=1', 'https:')).toBe(true)
    expect(isMixedContent('http://student.example.com/s/mirror?x=1', 'http:')).toBe(false)
    expect(isMixedContent('https://student.example.com/s/mirror?x=1', 'https:')).toBe(false)
    expect(isMixedContent('not a url', 'https:')).toBe(false)
  })
})

describe('formatTime（回放时间文本）', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [59000, '0:59'],
    [60000, '1:00'],
    [61000, '1:01'],
    [3600000, '1:00:00'],
    [3723000, '1:02:03'],
    [90100000, '25:01:40'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text)
  })

  it('负数 / NaN / Infinity 按 0:00', () => {
    expect(formatTime(-1000)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('clamp / markerPercent', () => {
  it('clamp 落在区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('clamp 支持 min > max 与非法值', () => {
    expect(clamp(5, 10, 0)).toBe(5)
    expect(clamp(Number.NaN, 0, 10)).toBe(0)
  })

  it('markerPercent 按比例并夹在 0..100', () => {
    expect(markerPercent(500, 1000)).toBe(50)
    expect(markerPercent(0, 1000)).toBe(0)
    expect(markerPercent(2000, 1000)).toBe(100)
    expect(markerPercent(-100, 1000)).toBe(0)
    expect(markerPercent(100, 0)).toBe(0)
  })
})

describe('buildTimeline（08 §2/§3 事件 → 回放时间轴）', () => {
  it('按 seq 排序、at 相对第一条事件、duration 覆盖全部事件', () => {
    const timeline = buildTimeline([
      makeEvent(2, 'line.submit', T1, { n: 1 }, 'L3'),
      makeEvent(1, 'app.open', T0),
      makeEvent(3, 'paste', T2, { target: 'line_statement', chars: 12 }),
    ])
    expect(timeline.durationMs).toBe(150000)
    expect(timeline.markers.map((marker) => marker.seq)).toEqual([1, 2])
    expect(timeline.markers[0].at).toBe(0)
    expect(timeline.markers[1].at).toBe(60000)
  })

  it('非标记类型（paste/ink.session）不进 markers，但仍计入 duration', () => {
    const timeline = buildTimeline([
      makeEvent(1, 'app.open', T0),
      makeEvent(2, 'paste', '2026-11-03T10:00:30.000Z', { chars: 5 }),
    ])
    expect(timeline.markers).toHaveLength(1)
    expect(timeline.durationMs).toBe(30000)
  })

  it('标记文案用 payload 补细节（提交/行号/离开/求助）', () => {
    const timeline = buildTimeline([
      makeEvent(1, 'def.submit', T0, { pass: false }, 'L1'),
      makeEvent(2, 'line.submit', T1, { n: 2 }, 'L3'),
      makeEvent(3, 'integ.visibility', '2026-11-03T10:01:30.000Z', { state: 'hidden' }),
      makeEvent(4, 'integ.visibility', '2026-11-03T10:02:00.000Z', { state: 'visible', awayMs: 30000 }),
      makeEvent(5, 'help.request', T2, { intent: 'stuck', routed: 'stuck' }),
    ])
    expect(timeline.markers.map((marker) => marker.label)).toEqual([
      'L1 提交定义（未通过）',
      'L3 提交第 2 行',
      '离开页面',
      '回到页面（离开 30 秒）',
      '求助·卡住了',
    ])
  })

  it('缺服务端时间戳时沿用上一个 at，不产生负数', () => {
    const timeline = buildTimeline([
      { seq: 1, type: 'app.open', tsServer: null, payload: null },
      { seq: 2, type: 'def.submit', tsServer: T1, payload: { pass: true } },
      { seq: 3, type: 'line.submit', tsServer: null, payload: { n: 1 } },
    ])
    expect(timeline.markers.map((marker) => marker.at)).toEqual([0, 0, 0])
    expect(timeline.durationMs).toBe(0)
  })

  it('tsServer 缺失时回退 tsClient', () => {
    const timeline = buildTimeline([
      { seq: 1, type: 'app.open', tsClient: T0, payload: null },
      { seq: 2, type: 'line.submit', tsClient: T2, payload: { n: 1 } },
    ])
    expect(timeline.markers[1].at).toBe(150000)
  })

  it('空事件 / 无时间信息的事件序列不报错', () => {
    expect(buildTimeline([])).toEqual({ durationMs: 0, markers: [] })
    expect(buildTimeline([{ seq: 1, type: 'app.open', payload: null }])).toEqual({
      durationMs: 0,
      markers: [{ at: 0, type: 'app.open', label: '打开应用', seq: 1 }],
    })
  })
})

describe('markerLabel / markerTone / isMarkerType', () => {
  it('markerLabel 对非标记类型返回 null，其余返回人话', () => {
    expect(markerLabel(makeEvent(1, 'paste', T0, { chars: 1 }))).toBeNull()
    expect(markerLabel(makeEvent(1, 'app.open', T0))).toBe('打开应用')
    expect(markerLabel(makeEvent(1, 'hint.deliver', T0, { level: 'H2' }))).toBe('领取提示 H2')
    expect(markerLabel(makeEvent(1, 'summary.submit', T0, { pass: true }))).toBe('提交总结')
    expect(markerLabel(makeEvent(1, 'nav.page', T0, { page: 'practice' }))).toBe('页面：practice')
  })

  it('颜色语义：离开=hint、批注=margin、提示=hint、提交=ok、层/页面=accent、其它=muted', () => {
    expect(markerTone('integ.visibility')).toBe('hint')
    expect(markerTone('integ.blur')).toBe('hint')
    expect(markerTone('annotation')).toBe('margin')
    expect(markerTone('hint.deliver')).toBe('hint')
    expect(markerTone('help.request')).toBe('hint')
    expect(markerTone('line.submit')).toBe('ok')
    expect(markerTone('summary.submit')).toBe('ok')
    expect(markerTone('layer.enter')).toBe('accent')
    expect(markerTone('app.open')).toBe('accent')
    expect(markerTone('paste')).toBe('muted')
  })

  it('isMarkerType 只接受时间轴要标的事件（04 §5.2）', () => {
    expect(isMarkerType('line.submit')).toBe(true)
    expect(isMarkerType('annotation')).toBe(true)
    expect(isMarkerType('integ.visibility')).toBe(true)
    expect(isMarkerType('paste')).toBe(false)
    expect(isMarkerType('kbd.session')).toBe(false)
  })
})

describe('seekIndex / nextMarker（回放定位）', () => {
  const markers: TimelineMarker[] = [
    { at: 0, type: 'app.open', label: '打开', seq: 1 },
    { at: 10000, type: 'def.submit', label: 'L1', seq: 2 },
    { at: 20000, type: 'hint.deliver', label: '提示', seq: 3 },
  ]

  it('seekIndex：当前时间之前（含）最近的标记', () => {
    expect(seekIndex(markers, -1)).toBe(-1)
    expect(seekIndex(markers, 0)).toBe(0)
    expect(seekIndex(markers, 9999)).toBe(0)
    expect(seekIndex(markers, 10000)).toBe(1)
    expect(seekIndex(markers, 15000)).toBe(1)
    expect(seekIndex(markers, 20000)).toBe(2)
    expect(seekIndex(markers, 99999)).toBe(2)
  })

  it('seekIndex：空数组 / 非有限时间返回 -1', () => {
    expect(seekIndex([], 100)).toBe(-1)
    expect(seekIndex(markers, Number.NaN)).toBe(-1)
  })

  it('nextMarker 向前找严格晚于当前的标记', () => {
    expect(nextMarker(markers, -1, 1)).toBe(0)
    expect(nextMarker(markers, 0, 1)).toBe(1)
    expect(nextMarker(markers, 15000, 1)).toBe(2)
    expect(nextMarker(markers, 20000, 1)).toBe(-1)
  })

  it('nextMarker 向后找严格早于当前的标记', () => {
    expect(nextMarker(markers, 20000, -1)).toBe(1)
    expect(nextMarker(markers, 15000, -1)).toBe(1)
    expect(nextMarker(markers, 5, -1)).toBe(0)
    expect(nextMarker(markers, 0, -1)).toBe(-1)
  })

  it('nextMarker：空数组返回 -1', () => {
    expect(nextMarker([], 0)).toBe(-1)
  })
})

describe('parseSseFrames（06 §6 SSE 帧解析）', () => {
  it('解析单帧 event + data', () => {
    const result = parseSseFrames('event: state\ndata: {"stateVersion":1}\n\n')
    expect(result.rest).toBe('')
    expect(result.frames).toEqual([{ event: 'state', data: '{"stateVersion":1}' }])
  })

  it('多行 data 按规范用换行合并', () => {
    const result = parseSseFrames('data: {"a":1,\ndata: "b":2}\n\n')
    expect(result.frames).toHaveLength(1)
    expect(result.frames[0].data).toBe('{"a":1,\n"b":2}')
    expect(parseSseData<{ a: number; b: number }>(result.frames[0].data)).toEqual({ a: 1, b: 2 })
  })

  it('忽略注释帧（心跳）与空帧', () => {
    expect(parseSseFrames(': keep-alive\n\n').frames).toEqual([])
    expect(parseSseFrames('\n\n\n').frames).toEqual([])
    expect(parseSseFrames('').frames).toEqual([])
  })

  it('一次收到多帧', () => {
    const result = parseSseFrames('event: state\ndata: {}\n\nevent: ping\ndata: {}\n\n')
    expect(result.frames.map((frame) => frame.event)).toEqual(['state', 'ping'])
    expect(result.rest).toBe('')
  })

  it('未收完的帧留在 rest，拼接后继续解析', () => {
    const first = parseSseFrames('event: state\ndata: {"a"')
    expect(first.frames).toEqual([])
    expect(first.rest).toBe('event: state\ndata: {"a"')
    const second = parseSseFrames(first.rest + ':1}\n\n')
    expect(second.frames).toEqual([{ event: 'state', data: '{"a":1}' }])
    expect(second.rest).toBe('')
  })

  it('支持 CRLF 帧分隔', () => {
    const result = parseSseFrames('event: state\r\ndata: {}\r\n\r\n')
    expect(result.frames).toEqual([{ event: 'state', data: '{}' }])
    expect(result.rest).toBe('')
  })

  it('解析 id / retry，忽略未知字段', () => {
    const result = parseSseFrames('id: 42\nretry: 3000\nfoo: bar\nevent: row\ndata: {}\n\n')
    expect(result.frames[0]).toEqual({ event: 'row', id: '42', retry: 3000, data: '{}' })
  })

  it('data 值里的冒号原样保留', () => {
    const result = parseSseFrames('data: {"a":"b:c"}\n\n')
    expect(result.frames[0].data).toBe('{"a":"b:c"}')
  })

  it('只有空白 data 且无 event/id 的帧被忽略', () => {
    expect(parseSseFrames('data:   \n\n').frames).toEqual([])
  })
})

describe('parseSseData（SSE data JSON）', () => {
  it('解析对象 / 数组 / 数字', () => {
    expect(parseSseData<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true })
    expect(parseSseData<number[]>('[1,2]')).toEqual([1, 2])
    expect(parseSseData<number>('42')).toBe(42)
  })

  it('空串 / 非法 JSON 返回 null（坏帧不打断回放）', () => {
    expect(parseSseData('')).toBeNull()
    expect(parseSseData('   ')).toBeNull()
    expect(parseSseData('not json')).toBeNull()
    expect(parseSseData('{"a":1')).toBeNull()
  })
})

describe('mirrorDemo（典型作答 mock）', () => {
  it('demo 事件按 seq 递增且覆盖一条完整作答', () => {
    expect(MIRROR_DEMO_EVENTS.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(MIRROR_DEMO_EVENTS.map((event) => event.type)).toEqual([
      'app.open',
      'nav.page',
      'def.submit',
      'line.submit',
      'line.submit',
      'help.request',
      'integ.visibility',
      'integ.visibility',
      'summary.submit',
    ])
  })

  it('createMirrorDemoEvents 返回副本，不污染模块常量', () => {
    const events = createMirrorDemoEvents()
    const firstPayload = events[0].payload as Record<string, unknown>
    firstPayload.entry = 'warm'
    expect((MIRROR_DEMO_EVENTS[0].payload as Record<string, unknown>).entry).toBe('cold')
  })

  it('demo 时间轴：duration 约 18 分钟、9 个标记、文案正确', () => {
    const timeline = createMirrorDemoTimeline()
    expect(timeline.durationMs).toBe(18 * 60 * 1000)
    expect(timeline.markers).toHaveLength(9)
    expect(timeline.markers.map((marker) => marker.label)).toEqual([
      '打开应用',
      '页面：practice',
      'L1 提交定义（通过）',
      'L3 提交第 1 行',
      'L3 提交第 2 行',
      '求助·卡住了',
      '离开页面',
      '回到页面（离开 30 秒）',
      '提交总结',
    ])
    expect(timeline.markers.every((marker, index) => index === 0 || marker.at >= timeline.markers[index - 1].at)).toBe(true)
    expect(timeline.markers[8].at).toBe(timeline.durationMs)
  })
})

// ---------------------------------------------------------------------------
// 组件 SFC 编译检查：组件本轮未接线（build 不打包），用 @vue/compiler-sfc 保证语法/样式可编译。
// @vue/compiler-sfc 是 @dcloudio/uni-cli-shared 的传递依赖，pnpm 严格 node_modules 下不能从
// apps/student 直接 import，所以用 createRequire 从 uni-cli-shared 解析；若以后加成直接 devDependency
// 会自动走第一条分支。
// ---------------------------------------------------------------------------

interface CompilerSfcLike {
  parse: (source: string, options?: Record<string, unknown>) => { descriptor: Record<string, any>; errors: unknown[] }
  compileScript: (descriptor: Record<string, any>, options?: Record<string, unknown>) => { content: string }
  compileTemplate: (options: Record<string, unknown>) => { code: string; errors: unknown[] }
  compileStyle: (options: Record<string, unknown>) => { errors: unknown[] }
}

let sfc: CompilerSfcLike
const MIRROR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/mirror')
const SFC_FILES = ['MirrorFrame.vue', 'PlaybackSlider.vue']

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
  return fs.readFileSync(path.join(MIRROR_DIR, file), 'utf8')
}

beforeAll(async () => {
  const entry = pathToFileURL(resolveCompilerSfcEntry()).href
  const loaded: Record<string, unknown> = await import(entry)
  sfc = (loaded.default ?? loaded) as unknown as CompilerSfcLike
})

describe('mirror 组件 SFC 编译检查（@vue/compiler-sfc）', () => {
  it.each(SFC_FILES)('%s 可以被解析且含 script setup / template', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    expect(result.errors).toEqual([])
    expect(result.descriptor.scriptSetup).toBeTruthy()
    expect(result.descriptor.template).toBeTruthy()
  })

  it.each(SFC_FILES)('%s 的 script setup 与 template 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const id = 'mirror-' + file.replace('.vue', '')
    expect(() => sfc.compileScript(result.descriptor, { id })).not.toThrow()
    const template = sfc.compileTemplate({
      source: result.descriptor.template.content,
      filename: file,
      id,
      scoped: true,
    })
    expect(template.errors).toEqual([])
    expect(template.code.length).toBeGreaterThan(0)
  })

  it.each(SFC_FILES)('%s 的 scoped style 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const styles = result.descriptor.styles ?? []
    expect(styles.length).toBeGreaterThan(0)
    for (const style of styles) {
      const compiled = sfc.compileStyle({
        source: style.content,
        filename: file,
        id: 'data-v-mirror',
        scoped: Boolean(style.scoped),
      })
      expect(compiled.errors).toEqual([])
    }
  })

  it.each(SFC_FILES)('%s 不含 console 输出（镜像 token 不进日志）', (file) => {
    expect(readSfc(file)).not.toMatch(/console\./)
  })

  it('MirrorFrame 带最小 sandbox 与 no-referrer（04 §5.1 安全约定）', () => {
    const source = readSfc('MirrorFrame.vue')
    expect(source).toContain('no-referrer')
    const sandboxLine = source.split('\n').find((line) => line.includes('sandbox:')) ?? ''
    expect(sandboxLine).toContain('allow-scripts')
    expect(sandboxLine).toContain('allow-same-origin')
    expect(sandboxLine).not.toContain('allow-forms')
    expect(sandboxLine).not.toContain('allow-popups')
    expect(sandboxLine).not.toContain('allow-top-navigation')
    expect(sandboxLine).not.toContain('allow-modals')
  })
})
