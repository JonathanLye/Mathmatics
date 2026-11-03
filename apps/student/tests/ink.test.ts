import { describe, expect, it } from 'vitest'
import {
  INK_MAX_UNDO,
  InkFormatError,
  appendPoint,
  canRedoInk,
  canUndoInk,
  clearInk,
  commitInkStroke,
  createInkEditState,
  detectScratch,
  eraseInkAlongPath,
  eraseInkStrokes,
  findStrokesNearPath,
  parseInk,
  redoInk,
  replayInk,
  serializeInk,
  setInkCanvas,
  simplifyPoints,
  smoothPoints,
  undoInk,
  visibleStrokeIds,
  visibleStrokes,
  type InkEditState,
  type InkPoint,
  type InkStroke,
} from '@ui-math/ink'

/** 画布基准尺寸（与组件 H5 实际情况同量级）。 */
const CANVAS = { width: 360, height: 180, dpr: 3 }

function makeState(): InkEditState {
  return setInkCanvas(createInkEditState(), CANVAS)
}

function pts(...list: Array<[number, number, number]>): InkPoint[] {
  return list.map((p) => [p[0], p[1], p[2]] as InkPoint)
}

function strokeOf(id: number, points: InkPoint[]): InkStroke {
  return { id, color: '#1d2430', width: 2.6, points }
}

/** 一行 3 个「字」的笔迹（每笔 bbox 约 80x30，位于 y=40..70）。 */
function existingLine(): InkStroke[] {
  return [
    strokeOf(0, pts([30, 60, 0], [50, 40, 10], [70, 70, 20], [90, 40, 30], [110, 60, 40])),
    strokeOf(1, pts([120, 60, 50], [140, 40, 60], [160, 70, 70], [180, 40, 80], [200, 60, 90])),
    strokeOf(2, pts([210, 60, 100], [230, 40, 110], [250, 70, 120], [270, 40, 130], [290, 60, 140])),
  ]
}

/** 横向来回涂抹的「划掉」手势：x 在两端来回，y 逐行下移。 */
function zigzag(startY = 40, endY = 80, rows = 5, t0 = 200): InkPoint[] {
  const out: InkPoint[] = []
  for (let i = 0; i < rows; i++) {
    const x = i % 2 === 0 ? 20 : 280
    const y = startY + ((endY - startY) * i) / (rows - 1)
    out.push([x, y, t0 + i * 16])
  }
  return out
}

function stateWithLine(): InkEditState {
  let state = makeState()
  for (const stroke of existingLine()) {
    state = commitInkStroke(state, { points: stroke.points }, stroke.points[0]![2], { scratch: false }).state
  }
  return state
}

describe('ink-v1 采样与平滑（03 §2.1/§2.2）', () => {
  it('appendPoint 丢弃过近的点，并保证时间单调不减', () => {
    let list: InkPoint[] = []
    list = appendPoint(list, [10, 10, 0])
    list = appendPoint(list, [10.1, 10.1, 4]) // 距离 < 0.5 px，丢弃
    expect(list).toHaveLength(1)
    list = appendPoint(list, [20, 20, 100])
    expect(list[1]![2]).toBe(100)
    list = appendPoint(list, [30, 30, 50]) // 乱序的 coalesced 事件：t 被夹到 100
    expect(list[2]![2]).toBe(100)
    expect(list).toHaveLength(3)
  })

  it('smoothPoints 点数与 t 不变、首尾点不动、t 单调不减', () => {
    const raw = pts([0, 0, 0], [10, 20, 10], [20, 0, 20], [30, 20, 30], [40, 0, 40])
    const smoothed = smoothPoints(raw, 3)
    expect(smoothed).toHaveLength(raw.length)
    expect(smoothed[0]).toEqual(raw[0])
    expect(smoothed[smoothed.length - 1]).toEqual(raw[raw.length - 1])
    expect(smoothed.map((p) => p[2])).toEqual(raw.map((p) => p[2]))
    for (let i = 1; i < smoothed.length; i++) {
      expect(smoothed[i]![2]).toBeGreaterThanOrEqual(smoothed[i - 1]![2])
    }
    // 中点被邻居平均：x 仍然是 20，y 从 0 变成 (20+0+20)/3
    expect(smoothed[2]![0]).toBeCloseTo(20, 6)
    expect(smoothed[2]![1]).toBeGreaterThan(0)
  })

  it('simplifyPoints 按 1 px 抽稀且保留首尾点', () => {
    const raw = pts([0, 0, 0], [0.2, 0, 1], [0.4, 0, 2], [5, 0, 3], [10, 0, 4])
    const thin = simplifyPoints(raw, 1)
    expect(thin[0]).toEqual(raw[0])
    expect(thin[thin.length - 1]).toEqual(raw[raw.length - 1])
    expect(thin.length).toBeLessThan(raw.length)
  })
})

describe('ink-v1 划掉删除判定（03 §2.4）', () => {
  it('横向来回 ≥3 次 + 长度 ≥ 2.5×宽 + 包围盒重叠 ≥60% 时判定为划掉', () => {
    const result = detectScratch(existingLine(), zigzag())
    expect(result.matched).toBe(true)
    expect(result.reversals).toBeGreaterThanOrEqual(3)
    expect(result.lengthRatio).toBeGreaterThanOrEqual(2.5)
    expect(result.overlapRatio).toBeGreaterThanOrEqual(0.6)
    expect(result.coveredIds).toEqual([0, 1, 2])
    expect(result.failed).toEqual([])
  })

  it('直线一笔不判定为划掉（没有来回、长度也不够）', () => {
    const result = detectScratch(existingLine(), pts([20, 60, 0], [280, 60, 16]))
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

  it('commitInkStroke 命中划掉时隐藏被覆盖笔画与手势本身，撤销可恢复', () => {
    let state = stateWithLine()
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2])

    const committed = commitInkStroke(state, { points: zigzag() }, 500)
    state = committed.state
    expect(committed.scratch?.matched).toBe(true)
    expect(committed.scratch?.coveredIds).toEqual([0, 1, 2])
    // 被覆盖的 3 笔与划掉手势本身都不可见；手势笔迹仍留在 strokes 里（研究用）
    expect(visibleStrokeIds(state.doc)).toEqual([])
    expect(state.doc.strokes).toHaveLength(4)
    const scratchOp = state.doc.ops?.[0]
    expect(scratchOp).toMatchObject({ op: 'scratch', ids: [0, 1, 2], by: 3, t: 500 })

    state = undoInk(state, 600)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2]) // 撤销恢复被覆盖笔画，但不回放乱涂
    state = redoInk(state, 700)
    expect(visibleStrokeIds(state.doc)).toEqual([])
  })
})

describe('ink-v1 撤销/重做（03 §2.3，栈深 100）', () => {
  it('提交两笔后撤销/重做按「操作」为单位', () => {
    let state = makeState()
    state = commitInkStroke(state, { points: pts([10, 10, 0], [20, 20, 10]) }, 0).state
    state = commitInkStroke(state, { points: pts([30, 30, 20], [40, 40, 30]) }, 20).state
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
  })

  it('撤销后新的编辑会清空重做栈', () => {
    let state = makeState()
    state = commitInkStroke(state, { points: pts([10, 10, 0], [20, 20, 10]) }, 0).state
    state = commitInkStroke(state, { points: pts([30, 30, 20], [40, 40, 30]) }, 20).state
    state = undoInk(state, 30)
    expect(canRedoInk(state)).toBe(true)
    state = commitInkStroke(state, { points: pts([50, 50, 40], [60, 60, 50]) }, 40).state
    expect(canRedoInk(state)).toBe(false)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 2])
  })

  it('撤销栈上限 100：更早的操作不再可撤销，但重放结果仍然一致', () => {
    let state = makeState()
    for (let i = 0; i < 120; i++) {
      state = commitInkStroke(state, { points: pts([i, i, i]) }, i).state
    }
    expect(state.undoStack.length).toBe(INK_MAX_UNDO)
    for (let i = 0; i < INK_MAX_UNDO; i++) state = undoInk(state, 1000 + i)
    expect(visibleStrokes(state.doc)).toHaveLength(120 - INK_MAX_UNDO)
    expect(replayInk(serializeInk(state))).toHaveLength(20)
  })
})

describe('ink-v1 橡皮/清空（03 §2.3）', () => {
  it('橡皮按轨迹删除相交的整笔，可撤销', () => {
    let state = makeState()
    state = commitInkStroke(state, { points: pts([20, 20, 0], [40, 20, 16], [60, 20, 32]) }, 0).state
    state = commitInkStroke(state, { points: pts([200, 100, 40], [220, 100, 56]) }, 40).state
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
    expect(findStrokesNearPath(visibleStrokes(state.doc), pts([40, 20, 60]), 10)).toEqual([0])

    state = eraseInkAlongPath(state, pts([40, 20, 60], [41, 21, 66]), 10, 60)
    expect(visibleStrokeIds(state.doc)).toEqual([1])
    state = undoInk(state, 70)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1])
  })

  it('清空记为一组 erase 操作，可撤销', () => {
    let state = stateWithLine()
    state = clearInk(state, 500)
    expect(visibleStrokeIds(state.doc)).toEqual([])
    expect(state.doc.ops?.[state.doc.ops.length - 1]).toMatchObject({ op: 'erase', ids: [0, 1, 2] })
    state = undoInk(state, 600)
    expect(visibleStrokeIds(state.doc)).toEqual([0, 1, 2])
  })
})

describe('ink-v1 序列化 / 解析 / 重放（DoD）', () => {
  function mixedState(): InkEditState {
    let state = makeState()
    state = commitInkStroke(state, { points: pts([10, 10, 0], [20, 20, 10], [30, 15, 20]) }, 0).state
    state = commitInkStroke(state, { points: pts([40, 40, 30], [50, 50, 40]) }, 30).state
    state = commitInkStroke(state, { points: pts([60, 60, 50], [70, 70, 60]) }, 50).state
    state = eraseInkStrokes(state, [1], 60)
    state = undoInk(state, 70) // 恢复 id=1
    return state
  }

  it('序列化 → 解析 → 重放得到相同笔画（id/点数/坐标）', () => {
    const state = mixedState()
    const json = serializeInk(state)
    const doc = parseInk(json)
    const replayed = replayInk(json)
    const expected = visibleStrokes(state.doc)

    expect(replayed.map((stroke) => stroke.id)).toEqual(expected.map((stroke) => stroke.id))
    expect(replayed.map((stroke) => stroke.points.length)).toEqual(expected.map((stroke) => stroke.points.length))
    expect(replayed).toEqual(expected)
    expect(doc.canvas).toEqual(CANVAS)
  })

  it('序列化是稳定的：再次 parse/serialize 字符串不变', () => {
    const json = serializeInk(mixedState())
    expect(serializeInk(parseInk(json))).toBe(json)
  })

  it('划掉 + 撤销后的文档也能重放（ops 生效）', () => {
    let state = stateWithLine()
    state = commitInkStroke(state, { points: zigzag() }, 500).state
    const json = serializeInk(state)
    expect(replayInk(json)).toHaveLength(0)
    const parsed = parseInk(json)
    expect(parsed.ops?.[0]).toMatchObject({ op: 'scratch', ids: [0, 1, 2], by: 3 })
  })

  it('兼容解析 03 §2.1 的旧草案（v/w/h/pts 带 pressure）', () => {
    const legacy = JSON.stringify({
      v: 1,
      w: 640,
      h: 240,
      dpr: 2,
      strokes: [{ id: 0, p: 'touch', pts: [[1, 2, 0, 0.5], [3, 4, 10, 0.5]] }],
    })
    const doc = parseInk(legacy)
    expect(doc.canvas).toEqual({ width: 640, height: 240, dpr: 2 })
    expect(doc.strokes[0]!.points).toEqual([[1, 2, 0], [3, 4, 10]])
    expect(replayInk(legacy)).toHaveLength(1)
  })

  it('无效 JSON 一律拒绝并带中文原因', () => {
    expect(() => parseInk('{oops')).toThrow(InkFormatError)
    expect(() => parseInk('{}')).toThrow(/版本/)
    expect(
      () => parseInk(JSON.stringify({ version: 2, canvas: { width: 10, height: 10, dpr: 1 }, strokes: [] })),
    ).toThrow(/版本/)
    expect(() => parseInk(JSON.stringify({ version: 1, strokes: [] }))).toThrow(/画布/)
    expect(
      () =>
        parseInk(
          JSON.stringify({ version: 1, canvas: { width: 10, height: 10, dpr: 1 }, strokes: [{ id: 0, points: [] }] }),
        ),
    ).toThrow(/points/)
    expect(
      () =>
        parseInk(
          JSON.stringify({
            version: 1,
            canvas: { width: 10, height: 10, dpr: 1 },
            strokes: [
              { id: 0, points: [[1, 2, 0]] },
              { id: 0, points: [[3, 4, 0]] },
            ],
          }),
        ),
    ).toThrow(/id 重复/)
    expect(
      () =>
        parseInk(
          JSON.stringify({
            version: 1,
            canvas: { width: 10, height: 10, dpr: 1 },
            strokes: [{ id: 0, points: [['a', 2, 0]] }],
          }),
        ),
    ).toThrow(/坐标必须是数字/)
    expect(
      () =>
        parseInk(
          JSON.stringify({
            version: 1,
            canvas: { width: 10, height: 10, dpr: 1 },
            strokes: [],
            ops: [{ op: 'teleport', ids: [], t: 0 }],
          }),
        ),
    ).toThrow(/未知操作/)
  })
})
