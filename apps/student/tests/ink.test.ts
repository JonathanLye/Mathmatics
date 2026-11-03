import { describe, expect, it } from 'vitest'
import {
  INK_MAX_UNDO,
  InkFormatError,
  appendPoint,
  canRedoInk,
  canUndoInk,
  clearInk,
  commitInkStroke,
  createInkDocument,
  createInkEditState,
  detectScratch,
  eraseInkAlongPath,
  eraseInkStrokes,
  findStrokesNearPath,
  nextInkStrokeId,
  parseInk,
  redoInk,
  replayInk,
  serializeInk,
  setInkMeta,
  simplifyPoints,
  smoothPoints,
  undoInk,
  visibleStrokeIds,
  visibleStrokes,
  type InkDocument,
  type InkEditState,
  type InkPoint,
  type InkStroke,
} from '@ui-math/ink'
import { MAX_INK_CAPTURE_BYTES, buildInkCapture, gzipBase64 } from '@ui-math/inkCapture'

/** 03 §2.1 的官方示例 JSON（审计要求：用它做 fixture 覆盖 parse → replay）。 */
const INK_V1_FIXTURE: Record<string, unknown> = {
  v: 1,
  w: 1200,
  h: 360,
  dpr: 3,
  t0: 1762344000000,
  orientation: 'landscape',
  fullscreen: true,
  strokes: [{ id: 0, p: 'touch', pts: [[12.5, 40, 0, 0.5], [13.1, 41.2, 16, 0.5]] }],
  ops: [
    { op: 'erase', ids: [3, 4], t: 5230 },
    { op: 'undo', t: 6100 },
    { op: 'scratch', ids: [7], by: 8, t: 7400 },
  ],
}
const INK_V1_FIXTURE_JSON = JSON.stringify(INK_V1_FIXTURE)

const T0 = 1762344000000

function makeState(): InkEditState {
  return createInkEditState(
    createInkDocument({ w: 360, h: 180, dpr: 3, t0: T0, orientation: 'landscape', fullscreen: false }),
  )
}

function pts(...list: Array<[number, number, number, number]>): InkPoint[] {
  return list.map((p) => [p[0], p[1], p[2], p[3]] as InkPoint)
}

function strokeOf(id: number, points: InkPoint[], p: InkStroke['p'] = 'touch'): InkStroke {
  return { id, p, pts: points }
}

/** 一行 3 个「字」的笔迹（每笔 bbox 约 80x30，位于 y=40..70，pressure 固定 0.5）。 */
function existingLine(): InkStroke[] {
  return [
    strokeOf(0, pts([30, 60, 0, 0.5], [50, 40, 10, 0.5], [70, 70, 20, 0.5], [90, 40, 30, 0.5], [110, 60, 40, 0.5])),
    strokeOf(1, pts([120, 60, 50, 0.5], [140, 40, 60, 0.5], [160, 70, 70, 0.5], [180, 40, 80, 0.5], [200, 60, 90, 0.5])),
    strokeOf(2, pts([210, 60, 100, 0.5], [230, 40, 110, 0.5], [250, 70, 120, 0.5], [270, 40, 130, 0.5], [290, 60, 140, 0.5])),
  ]
}

/** 横向来回涂抹的「划掉」手势：x 在两端来回，y 逐行下移。 */
function zigzag(startY = 40, endY = 80, rows = 5, t0 = 200, pressure = 0.5): InkPoint[] {
  const out: InkPoint[] = []
  for (let i = 0; i < rows; i++) {
    const x = i % 2 === 0 ? 20 : 280
    const y = startY + ((endY - startY) * i) / (rows - 1)
    out.push([x, y, t0 + i * 16, pressure])
  }
  return out
}

function stateWithLine(): InkEditState {
  let state = makeState()
  for (const stroke of existingLine()) {
    state = commitInkStroke(state, { pts: stroke.pts }, stroke.pts[0]![2], { scratch: false }).state
  }
  return state
}

function mixedState(): InkEditState {
  let state = makeState()
  state = commitInkStroke(state, { pts: pts([10, 10, 0, 0.5], [20, 20, 10, 0.6], [30, 15, 20, 0.5]) }, 0).state
  state = commitInkStroke(state, { pts: pts([40, 40, 30, 0.4], [50, 50, 40, 0.5]), p: 'pen' }, 30).state
  state = commitInkStroke(state, { pts: pts([60, 60, 50, 0.5], [70, 70, 60, 0.5]) }, 50).state
  state = eraseInkStrokes(state, [1], 60)
  state = undoInk(state, 70) // 恢复 id=1
  return state
}

/** 解压 gzip(base64)（node 24 / Chrome 均有 DecompressionStream）。 */
async function gunzipText(base64: string): Promise<string> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

describe('ink-v1 格式：03 §2.1 示例 fixture（parse → replay）', () => {
  it('能解析 03 §2.1 的示例 JSON，并按 ops 重放', () => {
    const doc = parseInk(INK_V1_FIXTURE_JSON)
    expect(doc).toMatchObject({
      v: 1,
      w: 1200,
      h: 360,
      dpr: 3,
      t0: T0,
      orientation: 'landscape',
      fullscreen: true,
    })
    expect(doc.strokes).toHaveLength(1)
    expect(doc.strokes[0]!.p).toBe('touch')
    expect(doc.strokes[0]!.pts).toEqual([
      [12.5, 40, 0, 0.5],
      [13.1, 41.2, 16, 0.5],
    ])
    // erase/undo/scratch 指向不存在的笔画，不影响唯一一笔的可见性
    expect(replayInk(INK_V1_FIXTURE_JSON).map((stroke) => stroke.id)).toEqual([0])
    expect(visibleStrokeIds(doc)).toEqual([0])
  })

  it('序列化结果与 03 §2.1 示例逐字段一致（往返稳定）', () => {
    const roundTrip = JSON.parse(serializeInk(parseInk(INK_V1_FIXTURE_JSON)))
    expect(roundTrip).toEqual(INK_V1_FIXTURE)
  })

  it('导出顶层/笔画/操作字段严格按 03 §2.1', () => {
    const payload = JSON.parse(serializeInk(mixedState()))
    expect(Object.keys(payload)).toEqual(['v', 'w', 'h', 'dpr', 't0', 'orientation', 'fullscreen', 'strokes', 'ops'])
    expect(Object.keys(payload.strokes[0])).toEqual(['id', 'p', 'pts'])
    expect(payload.strokes[0].pts[0]).toHaveLength(4)
    expect(typeof payload.strokes[0].p).toBe('string')
    // ops 里 erase 带 ids，undo/redo 不带 ids（03 §2.1 示例）
    expect(payload.ops[0]).toEqual({ op: 'erase', ids: [1], t: 60 })
    expect(payload.ops[1]).toEqual({ op: 'undo', t: 70 })
  })

  it('记录 t0 / orientation / fullscreen / 尺寸（03 §2.6）', () => {
    let state = makeState()
    state = setInkMeta(state, { w: 390, h: 700, dpr: 3, t0: T0 + 1000, orientation: 'portrait', fullscreen: true })
    const payload = JSON.parse(serializeInk(state))
    expect(payload).toMatchObject({
      v: 1,
      w: 390,
      h: 700,
      dpr: 3,
      t0: T0 + 1000,
      orientation: 'portrait',
      fullscreen: true,
    })
  })

  it('pressure 与 pointerType 在序列化/重放中保留（无压感固定 0.5）', () => {
    let state = makeState()
    state = commitInkStroke(state, { pts: pts([1, 2, 0, 0.42], [3, 4, 8, 0.5]), p: 'pen' }, 0).state
    const doc = parseInk(serializeInk(state))
    expect(doc.strokes[0]!.p).toBe('pen')
    expect(doc.strokes[0]!.pts.map((p) => p[3])).toEqual([0.42, 0.5])
    expect(replayInk(serializeInk(state))[0]!.pts[0]![3]).toBe(0.42)
  })
})

describe('ink-v1 采样与平滑（03 §2.1/§2.2）', () => {
  it('appendPoint 丢弃过近的点、保证 t 单调不减、pressure 夹到 0–1', () => {
    let list: InkPoint[] = []
    list = appendPoint(list, [10, 10, 0, 0.5])
    list = appendPoint(list, [10.1, 10.1, 4, 0.5]) // 距离 < 0.5 px，丢弃
    expect(list).toHaveLength(1)
    list = appendPoint(list, [20, 20, 100, 1.4])
    expect(list[1]![2]).toBe(100)
    expect(list[1]![3]).toBe(1)
    list = appendPoint(list, [30, 30, 50, -1]) // 乱序 coalesced 事件：t 被夹到 100，pressure 夹到 0
    expect(list[2]![2]).toBe(100)
    expect(list[2]![3]).toBe(0)
    expect(list).toHaveLength(3)
  })

  it('smoothPoints 点数/t/pressure 不变、首尾点不动', () => {
    const raw = pts([0, 0, 0, 0.3], [10, 20, 10, 0.5], [20, 0, 20, 0.7], [30, 20, 30, 0.5], [40, 0, 40, 0.4])
    const smoothed = smoothPoints(raw, 3)
    expect(smoothed).toHaveLength(raw.length)
    expect(smoothed[0]).toEqual(raw[0])
    expect(smoothed[smoothed.length - 1]).toEqual(raw[raw.length - 1])
    expect(smoothed.map((p) => p[2])).toEqual(raw.map((p) => p[2]))
    expect(smoothed.map((p) => p[3])).toEqual(raw.map((p) => p[3]))
    expect(smoothed[2]![0]).toBeCloseTo(20, 6)
    expect(smoothed[2]![1]).toBeGreaterThan(0)
  })

  it('simplifyPoints 按 1 px 抽稀且保留首尾点', () => {
    const raw = pts([0, 0, 0, 0.5], [0.2, 0, 1, 0.5], [0.4, 0, 2, 0.5], [5, 0, 3, 0.5], [10, 0, 4, 0.5])
    const thin = simplifyPoints(raw, 1)
    expect(thin[0]).toEqual(raw[0])
    expect(thin[thin.length - 1]).toEqual(raw[raw.length - 1])
    expect(thin.length).toBeLessThan(raw.length)
  })
})

describe('ink-v1 划掉删除判定（03 §2.4）', () => {
  it('横向来回 ≥3 次 + 长度 ≥ 2.5×宽 + 重叠 ≥60% 时判定为划掉', () => {
    const result = detectScratch(existingLine(), zigzag())
    expect(result.matched).toBe(true)
    expect(result.reversals).toBeGreaterThanOrEqual(3)
    expect(result.lengthRatio).toBeGreaterThanOrEqual(2.5)
    expect(result.overlapRatio).toBeGreaterThanOrEqual(0.6)
    expect(result.coveredIds).toEqual([0, 1, 2])
    expect(result.failed).toEqual([])
  })

  it('直线一笔不判定为划掉（没有来回、长度也不够）', () => {
    const result = detectScratch(existingLine(), pts([20, 60, 0, 0.5], [280, 60, 16, 0.5]))
    expect(result.matched).toBe(false)
    expect(result.failed).toContain('reversals')
    expect(result.failed).toContain('length')
  })

  it('来回次数不够不判定为划掉', () => {
    const result = detectScratch(existingLine(), zigzag(40, 80, 3))
    expect(result.matched).toBe(false)
    expect(result.failed).toContain('reversals')
    expect(result.reversals).toBeLessThan(3)
  })

  it('离已有笔画太远（重叠面积不足）不判定为划掉', () => {
    const result = detectScratch(existingLine(), zigzag(140, 180, 5))
    expect(result.matched).toBe(false)
    expect(result.failed).toContain('overlap')
    expect(result.failed).toContain('no-covered')
  })

  it('commitInkStroke 命中划掉时隐藏被覆盖笔画与手势本身，撤销/重做正确', () => {
    let state = stateWithLine()
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2])

    const committed = commitInkStroke(state, { pts: zigzag() }, 500)
    state = committed.state
    expect(committed.scratch?.matched).toBe(true)
    expect(committed.scratch?.coveredIds).toEqual([0, 1, 2])
    expect(visibleStrokeIds(state.doc)).toEqual([])
    expect(state.doc.strokes).toHaveLength(4) // 手势笔迹仍保留（研究用）
    expect(state.doc.ops?.at(-1)).toEqual({ op: 'scratch', ids: [0, 1, 2], by: 3, t: 500 })
    expect(state.undoDepth).toBe(4) // 3 次落笔 + 1 次划掉

    state = undoInk(state, 600)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2]) // 恢复被覆盖笔画，不回放乱涂
    state = undoInk(state, 700)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1]) // 再撤销上一笔落笔，与编辑器撤销栈一致
    state = redoInk(state, 800)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2])
    state = redoInk(state, 900)
    expect(visibleStrokeIds(state.doc)).toEqual([])
  })
})

describe('ink-v1 撤销/重做（03 §2.3，栈深 100）', () => {
  it('提交两笔后撤销/重做按「操作」为单位，状态里的可见性由 ops 重放得出', () => {
    let state = makeState()
    state = commitInkStroke(state, { pts: pts([10, 10, 0, 0.5], [20, 20, 10, 0.5]) }, 0).state
    state = commitInkStroke(state, { pts: pts([30, 30, 20, 0.5], [40, 40, 30, 0.5]) }, 20).state
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
    expect(canUndoInk(state)).toBe(true)
    expect(canRedoInk(state)).toBe(false)

    state = undoInk(state, 30)
    expect(visibleStrokeIds(state.doc)).toEqual([0])
    state = undoInk(state, 40)
    expect(visibleStrokeIds(state.doc)).toEqual([])
    expect(canUndoInk(state)).toBe(false)

    state = redoInk(state, 50)
    expect(visibleStrokeIds(state.doc)).toEqual([0])
    state = redoInk(state, 60)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
    expect(canRedoInk(state)).toBe(false)
    // 重放结果与编辑器状态一致（DoD：导出的 ink-v1 能重放）
    expect(replayInk(serializeInk(state)).map((stroke) => stroke.id)).toEqual([0, 1])
  })

  it('撤销后新的编辑会清空重做栈', () => {
    let state = makeState()
    state = commitInkStroke(state, { pts: pts([10, 10, 0, 0.5], [20, 20, 10, 0.5]) }, 0).state
    state = commitInkStroke(state, { pts: pts([30, 30, 20, 0.5], [40, 40, 30, 0.5]) }, 20).state
    state = undoInk(state, 30)
    expect(canRedoInk(state)).toBe(true)
    state = commitInkStroke(state, { pts: pts([50, 50, 40, 0.5], [60, 60, 50, 0.5]) }, 40).state
    expect(canRedoInk(state)).toBe(false)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 2])
  })

  it('撤销栈上限 100：更早的操作不再可撤销，但重放结果仍然一致', () => {
    let state = makeState()
    for (let i = 0; i < 120; i++) state = commitInkStroke(state, { pts: pts([i, i, i, 0.5]) }, i).state
    expect(state.undoDepth).toBe(INK_MAX_UNDO)
    for (let i = 0; i < INK_MAX_UNDO; i++) state = undoInk(state, 1000 + i)
    expect(visibleStrokes(state.doc)).toHaveLength(120 - INK_MAX_UNDO)
    expect(replayInk(serializeInk(state))).toHaveLength(20)
  })
})

describe('ink-v1 橡皮/清空（03 §2.3）', () => {
  it('橡皮按轨迹删除相交的整笔，可撤销', () => {
    let state = makeState()
    state = commitInkStroke(state, { pts: pts([20, 20, 0, 0.5], [40, 20, 16, 0.5], [60, 20, 32, 0.5]) }, 0).state
    state = commitInkStroke(state, { pts: pts([200, 100, 40, 0.5], [220, 100, 56, 0.5]) }, 40).state
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
    expect(findStrokesNearPath(visibleStrokes(state.doc), pts([40, 20, 60, 0.5]), 10)).toEqual([0])

    state = eraseInkAlongPath(state, pts([40, 20, 60, 0.5], [41, 21, 66, 0.5]), 10, 60)
    expect(visibleStrokeIds(state.doc)).toEqual([1])
    state = undoInk(state, 70)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
  })

  it('清空记为一组 erase 操作，可撤销', () => {
    let state = stateWithLine()
    state = clearInk(state, 500)
    expect(visibleStrokeIds(state.doc)).toEqual([])
    expect(state.doc.ops?.at(-1)).toEqual({ op: 'erase', ids: [0, 1, 2], t: 500 })
    state = undoInk(state, 600)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2])
  })
})

describe('ink-v1 序列化 / 解析 / 重放（DoD）', () => {
  it('序列化 → 解析 → 重放得到相同笔画（id/点数/坐标/压力）', () => {
    const state = mixedState()
    const json = serializeInk(state)
    const doc = parseInk(json)
    const replayed = replayInk(json)
    const expected = visibleStrokes(state.doc)
    expect(replayed.map((stroke) => stroke.id)).toEqual(expected.map((stroke) => stroke.id))
    expect(replayed.map((stroke) => stroke.pts.length)).toEqual(expected.map((stroke) => stroke.pts.length))
    expect(replayed).toEqual(expected)
    expect(doc.w).toBe(360)
    expect(doc.h).toBe(180)
    expect(doc.dpr).toBe(3)
    expect(doc.t0).toBe(T0)
  })

  it('序列化是稳定的：再次 parse/serialize 字符串不变', () => {
    const json = serializeInk(mixedState())
    expect(serializeInk(parseInk(json))).toBe(json)
  })

  it('划掉 + 撤销后的文档也能重放（ops 生效）', () => {
    let state = stateWithLine()
    state = commitInkStroke(state, { pts: zigzag() }, 500).state
    const json = serializeInk(state)
    expect(replayInk(json)).toHaveLength(0)
    const parsed = parseInk(json)
    expect(parsed.ops?.at(-1)).toEqual({ op: 'scratch', ids: [0, 1, 2], by: 3, t: 500 })
  })

  it('nextInkStrokeId 取现有最大 id + 1', () => {
    const doc: InkDocument = createInkDocument({ w: 10, h: 10, dpr: 1, t0: 0 })
    doc.strokes.push(strokeOf(2, pts([0, 0, 0, 0.5])), strokeOf(0, pts([1, 1, 0, 0.5])))
    expect(nextInkStrokeId(doc)).toBe(3)
  })

  it('无效 JSON / 非 03 §2.1 结构一律拒绝并带中文原因', () => {
    expect(() => parseInk('{oops')).toThrow(InkFormatError)
    expect(() => parseInk('{}')).toThrow(/版本/)
    expect(() => parseInk(JSON.stringify({ v: 2, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [] }))).toThrow(/版本/)
    expect(() => parseInk(JSON.stringify({ v: 1, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [] }))).toThrow(/w/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 0, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [] }))).toThrow(/w/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'diagonal', fullscreen: false, strokes: [] }))).toThrow(/orientation/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: 'yes', strokes: [] }))).toThrow(/fullscreen/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [{ id: 0, p: 'touch', pts: [] }] }))).toThrow(/pts/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [{ id: 0, p: 'finger', pts: [[0, 0, 0, 0.5]] }] }))).toThrow(/p 必须是/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [{ id: 0, p: 'touch', pts: [[0, 0, 0]] }] }))).toThrow(/\[x, y, t, pressure\]/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [{ id: 0, p: 'touch', pts: [[0, 0, 0, 0.5]] }, { id: 0, p: 'touch', pts: [[1, 1, 0, 0.5]] }] }))).toThrow(/id 重复/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [], ops: [{ op: 'teleport', t: 0 }] }))).toThrow(/未知操作/)
    expect(() => parseInk(JSON.stringify({ v: 1, w: 10, h: 10, dpr: 1, t0: 0, orientation: 'landscape', fullscreen: false, strokes: [], ops: {} }))).toThrow(/ops/)
  })
})

describe('ink-v1 上传编码（03 §2.1：gzip + base64，≤256KB）', () => {
  it('上限常量为 256 KB', () => {
    expect(MAX_INK_CAPTURE_BYTES).toBe(256 * 1024)
  })

  it('gzipBase64（CompressionStream 路径）可解压还原 JSON', async () => {
    const json = serializeInk(mixedState())
    const base64 = await gzipBase64(json)
    expect(base64.length).toBeGreaterThan(0)
    expect(JSON.parse(await gunzipText(base64))).toEqual(JSON.parse(json))
  })

  it('gzipBase64 的 pako 兜底路径同样可解压还原 JSON', async () => {
    const json = serializeInk(mixedState())
    const base64 = await gzipBase64(json, { forcePako: true })
    expect(JSON.parse(await gunzipText(base64))).toEqual(JSON.parse(json))
  })

  it('buildInkCapture 返回可直接上传的 base64 与原始 JSON', async () => {
    const capture = await buildInkCapture(mixedState())
    expect(capture.simplified).toBe(false)
    expect(capture.overLimit).toBe(false)
    expect(capture.rawBytes).toBeGreaterThan(0)
    expect(capture.compressedBytes).toBeGreaterThan(0)
    expect(JSON.parse(await gunzipText(capture.base64))).toEqual(JSON.parse(capture.rawJson))
    expect(JSON.parse(capture.rawJson).v).toBe(1)
  })

  it('超过上限时按 1px 距离抽稀点后重试', async () => {
    let state = makeState()
    const dense: InkPoint[] = []
    for (let i = 0; i < 240; i++) dense.push([i * 1.2, 90 + Math.sin(i / 3) * 20, i * 4, 0.5])
    state = commitInkStroke(state, { pts: dense }, 0).state
    const capture = await buildInkCapture(state, { maxBytes: 1 })
    expect(capture.simplified).toBe(true)
    expect(capture.overLimit).toBe(true)
    const doc = parseInk(capture.rawJson)
    expect(doc.strokes[0]!.pts.length).toBeLessThan(240)
    expect(JSON.parse(await gunzipText(capture.base64))).toEqual(JSON.parse(capture.rawJson))
  })
})
