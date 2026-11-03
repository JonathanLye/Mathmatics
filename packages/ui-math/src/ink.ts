/**
 * ink-v1 手写笔迹 —— 纯逻辑（无 DOM / 无 Vue 依赖，可在 vitest node 环境直接跑）。
 *
 * 格式口径：10-开发文档/03-手写键盘与识别.md §2.1「采集格式 ink-v1」（另见 §2.2–§2.4、§2.6）。
 * 导出 JSON 与 03 §2.1 完全一致：
 * {
 *   "v": 1,
 *   "w": 1200, "h": 360, "dpr": 3,
 *   "t0": 1762344000000,
 *   "orientation": "landscape",
 *   "fullscreen": true,
 *   "strokes": [
 *     { "id": 0, "p": "touch", "pts": [[12.5, 40.0, 0, 0.5], [13.1, 41.2, 16, 0.5]] }
 *   ],
 *   "ops": [
 *     { "op": "erase", "ids": [3, 4], "t": 5230 },
 *     { "op": "undo", "t": 6100 },
 *     { "op": "scratch", "ids": [7], "by": 8, "t": 7400 }
 *   ]
 * }
 *
 * 字段语义（03 §2.1）：
 * - 坐标是 CSS 像素，相对画布左上角；t 是相对 t0 的毫秒；
 * - pressure 取 0–1，设备不支持压感时固定 0.5；p 取 pen / touch / mouse（来自 PointerEvent.pointerType）；
 * - strokes 只增不删（研究要保留原始笔迹），ops 保留全部编辑操作；
 * - 最终参与识别的笔画 = 全部笔画按时间事件应用 ops 后的可见集合；
 *   erase / scratch 隐藏笔画，undo / redo 反向/正向应用上一步编辑（不需要在 ops 里重复记录 ids，
 *   与 03 §2.1 的示例一致；重放算法见 replayVisibleIds）。
 */

/** 一个笔迹点：[x, y, t, pressure]。x/y 为 CSS 像素，t 为相对 t0 的毫秒，pressure 0–1。 */
export type InkPoint = [number, number, number, number]

/** 指针来源（PointerEvent.pointerType）。 */
export type InkPointerType = 'pen' | 'touch' | 'mouse'

/** 画布方向（03 §2.6：进入/退出全屏、方向变化都写进 ink-v1）。 */
export type InkOrientation = 'portrait' | 'landscape'

/** 一笔笔迹：id 会话内唯一，p 是指针来源，pts 按落笔顺序。 */
export interface InkStroke {
  id: number
  p: InkPointerType
  pts: InkPoint[]
}

/** 编辑操作（研究字段，03 §2.1）。undo / redo 无 ids：重放时按时间顺序反向应用上一步。 */
export type InkOp =
  | { op: 'erase'; ids: number[]; t: number }
  | { op: 'scratch'; ids: number[]; by: number; t: number }
  | { op: 'undo'; t: number }
  | { op: 'redo'; t: number }

/** ink-v1 文档（字段与 03 §2.1 一致）。 */
export interface InkDocument {
  v: 1
  w: number
  h: number
  dpr: number
  t0: number
  orientation: InkOrientation
  fullscreen: boolean
  strokes: InkStroke[]
  ops?: InkOp[]
}

/** 可更新的画布元信息（朝向、全屏、尺寸、起始时间）。 */
export interface InkMeta {
  w: number
  h: number
  dpr: number
  t0: number
  orientation: InkOrientation
  fullscreen: boolean
}

/** 编辑状态：文档 + 可撤销/可重做的动作数（栈深 100，03 §2.3）。 */
export interface InkEditState {
  doc: InkDocument
  undoDepth: number
  redoDepth: number
}

/** 提交一笔新笔迹时由调用方提供的部分（id 由内部生成）。 */
export interface NewInkStroke {
  pts: readonly InkPoint[]
  p?: InkPointerType
}

/** 划掉判定参数（测试与调参用，默认值来自 03 §2.4）。 */
export interface ScratchOptions {
  minReversals?: number
  minLengthRatio?: number
  minOverlapRatio?: number
  overlapSamples?: number
}

export type ScratchFailReason = 'not-horizontal' | 'reversals' | 'length' | 'overlap' | 'no-covered'

/** 划掉判定结果（matched=false 时 failed 说明差在哪）。 */
export interface ScratchResult {
  matched: boolean
  reversals: number
  length: number
  bboxWidth: number
  bboxHeight: number
  lengthRatio: number
  overlapRatio: number
  coveredIds: number[]
  failed: ScratchFailReason[]
}

/** ink-v1 版本号；不兼容版本 parseInk 会拒绝。 */
export const INK_VERSION = 1 as const
/** 撤销栈深度上限（03 §2.3：栈深 100）。 */
export const INK_MAX_UNDO = 100
/** 无压感设备固定 pressure（03 §2.1）。 */
export const DEFAULT_PRESSURE = 0.5
/** 橡皮半径（CSS 像素）：与橡皮轨迹相交的整笔删除（03 §2.3）。 */
export const DEFAULT_ERASER_RADIUS = 14
/** 相邻采样点最小距离（去抖，避免同一像素堆点）。 */
export const MIN_POINT_DISTANCE = 0.5
/** 划掉删除的三个阈值（03 §2.4）。 */
export const SCRATCH_MIN_REVERSALS = 3
export const SCRATCH_MIN_LENGTH_RATIO = 2.5
export const SCRATCH_MIN_OVERLAP_RATIO = 0.6

/** 解析 ink-v1 失败时抛出的错误；调用方应提示「笔迹数据无效」而不是崩溃。 */
export class InkFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InkFormatError'
  }
}

interface InkBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function roundInt(value: number): number {
  return Math.round(value)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRESSURE
  return Math.min(1, Math.max(0, value))
}

function clonePoint(point: InkPoint): InkPoint {
  return [point[0], point[1], point[2], point[3]]
}

function cloneStroke(stroke: InkStroke): InkStroke {
  return { id: stroke.id, p: stroke.p, pts: stroke.pts.map(clonePoint) }
}

function cloneOp(op: InkOp): InkOp {
  if (op.op === 'scratch') return { op: 'scratch', ids: [...op.ids], by: op.by, t: op.t }
  if (op.op === 'erase') return { op: 'erase', ids: [...op.ids], t: op.t }
  return { op: op.op, t: op.t }
}

function cloneDocument(doc: InkDocument): InkDocument {
  const next: InkDocument = {
    v: INK_VERSION,
    w: doc.w,
    h: doc.h,
    dpr: doc.dpr,
    t0: doc.t0,
    orientation: doc.orientation,
    fullscreen: doc.fullscreen,
    strokes: doc.strokes.map(cloneStroke),
  }
  if (doc.ops && doc.ops.length > 0) next.ops = doc.ops.map(cloneOp)
  return next
}

/** 新建空白 ink-v1 文档；画布挂载后由 setInkMeta 覆盖真实尺寸/起始时间。 */
export function createInkDocument(init: Partial<InkMeta> = {}): InkDocument {
  return {
    v: INK_VERSION,
    w: init.w ?? 1,
    h: init.h ?? 1,
    dpr: init.dpr ?? 1,
    t0: init.t0 ?? 0,
    orientation: init.orientation ?? 'landscape',
    fullscreen: init.fullscreen ?? false,
    strokes: [],
  }
}

/** 新建编辑状态；传入已有文档时撤销/重做栈从空开始（文档里的 ops 仍参与重放）。 */
export function createInkEditState(doc: InkDocument = createInkDocument()): InkEditState {
  return { doc: cloneDocument(doc), undoDepth: 0, redoDepth: 0 }
}

// ---------------------------------------------------------------------------
// 采样 / 平滑
// ---------------------------------------------------------------------------

/**
 * 追加一个采样点（不可变：返回新数组）。
 * - 距上一点 < minDistance 时丢弃（同一像素抖动）；
 * - t 强制单调不减（防时钟回拨/乱序 coalesced 事件）；
 * - pressure 夹到 0–1。
 */
export function appendPoint(
  points: readonly InkPoint[],
  point: readonly [number, number, number, number],
  minDistance = MIN_POINT_DISTANCE,
): InkPoint[] {
  const x = round2(point[0])
  const y = round2(point[1])
  const pressure = Number.isFinite(point[3]) ? round2(clamp01(point[3])) : DEFAULT_PRESSURE
  const last = points[points.length - 1]
  let t = Math.max(0, roundInt(point[2]))
  if (last) {
    if (Math.hypot(x - last[0], y - last[1]) < minDistance) return points.slice() as InkPoint[]
    if (t < last[2]) t = last[2]
  }
  return [...points, [x, y, t, pressure]]
}

/**
 * 滑动平均平滑（窗口默认 3，首尾点保持不动）。
 * 只平滑 x/y；t 与 pressure 保持不变（时间轴与压感要保留原始信息）。
 */
export function smoothPoints(points: readonly InkPoint[], window = 3): InkPoint[] {
  const count = points.length
  if (count <= 2 || window < 3) return points.map(clonePoint)
  const half = Math.floor(window / 2)
  const out: InkPoint[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const point = points[i]
    if (!point) continue
    if (i === 0 || i === count - 1) {
      out[i] = clonePoint(point)
      continue
    }
    const from = Math.max(0, i - half)
    const to = Math.min(count - 1, i + half)
    let sumX = 0
    let sumY = 0
    let n = 0
    for (let k = from; k <= to; k++) {
      const p = points[k]
      if (!p) continue
      sumX += p[0]
      sumY += p[1]
      n++
    }
    out[i] = [round2(sumX / n), round2(sumY / n), point[2], point[3]]
  }
  return out
}

/** 按最小距离抽稀点（03 §2.1：上传超 256 KB 时按 1 px 距离抽稀）；始终保留首尾点。 */
export function simplifyPoints(points: readonly InkPoint[], minDistance = 1): InkPoint[] {
  if (points.length <= 2) return points.map(clonePoint)
  const out: InkPoint[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance) out.push(clonePoint(point))
  }
  const tail = points[points.length - 1]
  const lastKept = out[out.length - 1]
  if (tail && lastKept && (lastKept[0] !== tail[0] || lastKept[1] !== tail[1])) out.push(clonePoint(tail))
  return out
}

// ---------------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------------

/** 路径总长（CSS 像素）。 */
export function pathLength(points: readonly InkPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

/** 单笔包围盒；空笔迹返回 null。 */
export function strokeBBox(stroke: InkStroke): InkBBox | null {
  return pointsBBox(stroke.pts)
}

/** 多笔包围盒；全空返回 null。 */
export function strokesBBox(strokes: readonly InkStroke[]): InkBBox | null {
  const boxes = strokes.map(strokeBBox).filter((bbox): bbox is InkBBox => bbox !== null)
  if (!boxes.length) return null
  return mergeBBoxes(boxes)
}

function pointsBBox(points: readonly InkPoint[]): InkBBox | null {
  if (!points.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function mergeBBoxes(boxes: readonly InkBBox[]): InkBBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    if (box.minX < minX) minX = box.minX
    if (box.minY < minY) minY = box.minY
    if (box.maxX > maxX) maxX = box.maxX
    if (box.maxY > maxY) maxY = box.maxY
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** 水平方向反转次数（忽略 < minDelta 的手抖，03 §2.4）。 */
export function countHorizontalReversals(points: readonly InkPoint[], minDelta = 1.5): number {
  let reversals = 0
  let direction = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    if (!prev || !curr) continue
    const dx = curr[0] - prev[0]
    if (Math.abs(dx) < minDelta) continue
    const sign = dx > 0 ? 1 : -1
    if (direction !== 0 && sign !== direction) reversals++
    direction = sign
  }
  return reversals
}

/** 点到线段距离（用于橡皮轨迹命中判定）。 */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsIntersect(a1: InkPoint, a2: InkPoint, b1: InkPoint, b2: InkPoint): boolean {
  const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number) =>
    (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)
  const d1 = cross(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1])
  const d2 = cross(a1[0], a1[1], a2[0], a2[1], b2[0], b2[1])
  const d3 = cross(b1[0], b1[1], b2[0], b2[1], a1[0], a1[1])
  const d4 = cross(b1[0], b1[1], b2[0], b2[1], a2[0], a2[1])
  return d1 * d2 <= 0 && d3 * d4 <= 0
}

function segmentDistance(a1: InkPoint, a2: InkPoint, b1: InkPoint, b2: InkPoint): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    distancePointToSegment(a1[0], a1[1], b1[0], b1[1], b2[0], b2[1]),
    distancePointToSegment(a2[0], a2[1], b1[0], b1[1], b2[0], b2[1]),
    distancePointToSegment(b1[0], b1[1], a1[0], a1[1], a2[0], a2[1]),
    distancePointToSegment(b2[0], b2[1], a1[0], a1[1], a2[0], a2[1]),
  )
}

function strokeSegments(points: readonly InkPoint[]): Array<[InkPoint, InkPoint]> {
  if (points.length === 1) {
    const only = points[0]
    return only ? [[only, only]] : []
  }
  const segments: Array<[InkPoint, InkPoint]> = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a && b) segments.push([a, b])
  }
  return segments
}

/** 橡皮轨迹命中的整笔 id（03 §2.3：擦除与橡皮轨迹相交的整笔，不做像素级擦除）。 */
export function findStrokesNearPath(
  strokes: readonly InkStroke[],
  path: readonly InkPoint[],
  radius = DEFAULT_ERASER_RADIUS,
): number[] {
  if (!path.length) return []
  const pathSegments = strokeSegments(path)
  const hits: number[] = []
  for (const stroke of strokes) {
    let hit = false
    for (const [a, b] of strokeSegments(stroke.pts)) {
      for (const [c, d] of pathSegments) {
        if (segmentDistance(a, b, c, d) <= radius) {
          hit = true
          break
        }
      }
      if (hit) break
    }
    if (hit) hits.push(stroke.id)
  }
  return hits
}

/** 包围盒重叠面积比（采样网格；对细线条笔画加 2 px 容差，避免 bbox 高/宽为 0 时永远分不到）。 */
function bboxOverlapRatio(target: InkBBox, others: readonly InkBBox[], samples = 10): number {
  if (!others.length || target.width <= 0 || target.height <= 0) return 0
  const pad = 2
  let covered = 0
  for (let iy = 0; iy < samples; iy++) {
    for (let ix = 0; ix < samples; ix++) {
      const x = target.minX + (target.width * (ix + 0.5)) / samples
      const y = target.minY + (target.height * (iy + 0.5)) / samples
      if (
        others.some(
          (box) => x >= box.minX - pad && x <= box.maxX + pad && y >= box.minY - pad && y <= box.maxY + pad,
        )
      ) {
        covered++
      }
    }
  }
  return covered / (samples * samples)
}

function bboxIntersects(a: InkBBox, b: InkBBox, pad = 2): boolean {
  return a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY
}

// ---------------------------------------------------------------------------
// 划掉删除判定（03 §2.4）
// ---------------------------------------------------------------------------

function isInkStroke(value: InkStroke | readonly InkPoint[]): value is InkStroke {
  return !Array.isArray(value)
}

/**
 * 判定一笔是不是「划掉」手势（03 §2.4）：
 * 水平方向来回 ≥ 3 次、路径总长 ≥ 包围盒宽度 × 2.5、与已有笔画包围盒重叠 ≥ 60%，且覆盖到至少一笔；
 * 另要求包围盒横向（宽 ≥ 高），对应产品里的「横向划掉」。
 */
export function detectScratch(
  existing: readonly InkStroke[],
  candidate: readonly InkPoint[] | InkStroke,
  options: ScratchOptions = {},
): ScratchResult {
  const points: readonly InkPoint[] = isInkStroke(candidate) ? candidate.pts : candidate
  const minReversals = options.minReversals ?? SCRATCH_MIN_REVERSALS
  const minLengthRatio = options.minLengthRatio ?? SCRATCH_MIN_LENGTH_RATIO
  const minOverlapRatio = options.minOverlapRatio ?? SCRATCH_MIN_OVERLAP_RATIO
  const samples = options.overlapSamples ?? 10

  const bbox = pointsBBox(points)
  const reversals = countHorizontalReversals(points)
  const length = pathLength(points)
  const bboxWidth = bbox?.width ?? 0
  const bboxHeight = bbox?.height ?? 0
  const lengthRatio = bboxWidth > 0 ? length / bboxWidth : 0
  const boxes = existing
    .map((stroke) => ({ id: stroke.id, box: strokeBBox(stroke) }))
    .filter((item): item is { id: number; box: InkBBox } => item.box !== null)
  const overlapRatio = bbox ? bboxOverlapRatio(bbox, boxes.map((item) => item.box), samples) : 0
  const coveredIds = bbox ? boxes.filter((item) => bboxIntersects(bbox, item.box)).map((item) => item.id) : []

  const failed: ScratchFailReason[] = []
  if (!bbox || bboxWidth <= 0 || bboxWidth < bboxHeight) failed.push('not-horizontal')
  if (reversals < minReversals) failed.push('reversals')
  if (lengthRatio < minLengthRatio) failed.push('length')
  if (overlapRatio < minOverlapRatio) failed.push('overlap')
  if (coveredIds.length === 0) failed.push('no-covered')

  return {
    matched: failed.length === 0,
    reversals,
    length,
    bboxWidth,
    bboxHeight,
    lengthRatio,
    overlapRatio,
    coveredIds,
    failed,
  }
}

// ---------------------------------------------------------------------------
// 可见性 / 重放（03 §2.1：全部笔画 − 被擦除/划掉/撤销的笔画）
// ---------------------------------------------------------------------------

interface ReplayAction {
  kind: 'add' | 'erase' | 'scratch'
  ids: number[]
}

interface ReplayEvent {
  t: number
  /** 同一时刻先处理落笔（0），再处理编辑操作（1）。 */
  order: number
  index: number
  strokeId?: number
  op?: InkOp
}

function strokeStartT(stroke: InkStroke): number {
  return stroke.pts[0]?.[2] ?? 0
}

function removeLastAddAction(stack: ReplayAction[], strokeId: number): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    const action = stack[i]
    if (action && action.kind === 'add' && action.ids[0] === strokeId) {
      stack.splice(i, 1)
      return
    }
  }
}

/**
 * 重放可见性：把「落笔」与「ops 编辑」按 t 排序后依次应用。
 * undo / redo 不需要在 ops 里记录 ids：undo 反向应用上一步动作，redo 重新应用被撤销的动作。
 * 这是 03 §2.1「最终参与识别的笔画 = 全部笔画 − 被擦除/划掉/撤销的笔画」的可执行定义。
 */
export function replayVisibleIds(doc: InkDocument): number[] {
  const events: ReplayEvent[] = []
  doc.strokes.forEach((stroke, index) => {
    events.push({ t: strokeStartT(stroke), order: 0, index, strokeId: stroke.id })
  })
  ;(doc.ops ?? []).forEach((op, index) => {
    events.push({ t: op.t, order: 1, index, op })
  })
  events.sort((a, b) => a.t - b.t || a.order - b.order || a.index - b.index)

  const visible = new Set<number>()
  const undoStack: ReplayAction[] = []
  const redoStack: ReplayAction[] = []
  for (const event of events) {
    if (event.strokeId !== undefined) {
      visible.add(event.strokeId)
      undoStack.push({ kind: 'add', ids: [event.strokeId] })
      redoStack.length = 0
      continue
    }
    const op = event.op
    if (!op) continue
    if (op.op === 'erase') {
      for (const id of op.ids) visible.delete(id)
      undoStack.push({ kind: 'erase', ids: [...op.ids] })
      redoStack.length = 0
    } else if (op.op === 'scratch') {
      for (const id of op.ids) visible.delete(id)
      visible.delete(op.by)
      // 划掉手势本身随这一笔一起消失，不再作为一次可单独撤销的动作（与编辑器的撤销栈一致）
      removeLastAddAction(undoStack, op.by)
      undoStack.push({ kind: 'scratch', ids: [...op.ids] })
      redoStack.length = 0
    } else if (op.op === 'undo') {
      const action = undoStack.pop()
      if (!action) continue
      applyAction(visible, action, true)
      redoStack.push(action)
    } else {
      const action = redoStack.pop()
      if (!action) continue
      applyAction(visible, action, false)
      undoStack.push(action)
    }
  }
  return doc.strokes.filter((stroke) => visible.has(stroke.id)).map((stroke) => stroke.id)
}

function applyAction(visible: Set<number>, action: ReplayAction, reverse: boolean): void {
  if (action.kind === 'add') {
    const id = action.ids[0]
    if (id === undefined) return
    if (reverse) visible.delete(id)
    else visible.add(id)
    return
  }
  for (const id of action.ids) {
    if (reverse) visible.add(id)
    else visible.delete(id)
  }
}

/** 还可见的笔画 id（保持落笔顺序）。 */
export function visibleStrokeIds(doc: InkDocument): number[] {
  return replayVisibleIds(doc)
}

/** 还可见的笔画（保持落笔顺序），供绘制与重放。 */
export function visibleStrokes(doc: InkDocument): InkStroke[] {
  const ids = new Set(replayVisibleIds(doc))
  return doc.strokes.filter((stroke) => ids.has(stroke.id)).map(cloneStroke)
}

/**
 * 重放：解析 ink-v1 JSON（或直接传文档），按 ops 还原成可绘制的笔画列表。
 * 只读回放 / 缩略图 / 服务端栅格化都用它，保证「导出的 ink-v1 能重放」。
 */
export function replayInk(
  input: string | InkDocument,
  options: { smooth?: boolean; window?: number } = {},
): InkStroke[] {
  const doc = typeof input === 'string' ? parseInk(input) : input
  const strokes = visibleStrokes(doc)
  if (!options.smooth) return strokes
  const window = options.window ?? 3
  return strokes.map((stroke) => ({ ...stroke, pts: smoothPoints(stroke.pts, window) }))
}

// ---------------------------------------------------------------------------
// 序列化 / 解析（严格按 03 §2.1 校验）
// ---------------------------------------------------------------------------

interface SerializedInkDocument {
  v: 1
  w: number
  h: number
  dpr: number
  t0: number
  orientation: InkOrientation
  fullscreen: boolean
  strokes: Array<{ id: number; p: InkPointerType; pts: Array<[number, number, number, number]> }>
  ops?: InkOp[]
}

/** 序列化成 ink-v1 JSON 字符串（字段顺序与 03 §2.1 示例一致）。数值统一保留 2 位小数、t 取整。 */
export function serializeInk(input: InkDocument | InkEditState): string {
  const doc = 'doc' in input ? input.doc : input
  const payload: SerializedInkDocument = {
    v: INK_VERSION,
    w: round2(doc.w),
    h: round2(doc.h),
    dpr: round2(doc.dpr),
    t0: roundInt(doc.t0),
    orientation: doc.orientation,
    fullscreen: doc.fullscreen,
    strokes: doc.strokes.map((stroke) => ({
      id: stroke.id,
      p: stroke.p,
      pts: stroke.pts.map((point) => [round2(point[0]), round2(point[1]), roundInt(point[2]), round2(point[3])]),
    })),
  }
  if (doc.ops && doc.ops.length > 0) payload.ops = doc.ops.map(serializeOp)
  return JSON.stringify(payload)
}

function serializeOp(op: InkOp): InkOp {
  if (op.op === 'scratch') return { op: 'scratch', ids: [...op.ids], by: op.by, t: roundInt(op.t) }
  if (op.op === 'erase') return { op: 'erase', ids: [...op.ids], t: roundInt(op.t) }
  return { op: op.op, t: roundInt(op.t) }
}

/** 解析并校验 ink-v1 JSON；不合法时抛 InkFormatError（带中文原因）。 */
export function parseInk(input: string): InkDocument {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch {
    throw new InkFormatError('ink-v1 不是合法 JSON')
  }
  return normalizeInkDocument(raw)
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InkFormatError(message)
  return value as Record<string, unknown>
}

function requirePositive(value: unknown, field: string): number {
  if (!isFiniteNumber(value) || value <= 0) throw new InkFormatError('ink-v1.' + field + ' 必须是正数')
  return value
}

function requireNonNegative(value: unknown, field: string): number {
  if (!isFiniteNumber(value) || value < 0) throw new InkFormatError('ink-v1.' + field + ' 必须是非负数')
  return value
}

/** 校验 + 归一化 03 §2.1 的 ink-v1（不接受其它版本/格式）。 */
export function normalizeInkDocument(raw: unknown): InkDocument {
  const obj = asRecord(raw, 'ink-v1 顶层必须是对象')
  if (obj.v !== INK_VERSION) {
    throw new InkFormatError('不支持的 ink-v1 版本：' + String(obj.v) + '（只支持 ' + INK_VERSION + '）')
  }
  const w = requirePositive(obj.w, 'w')
  const h = requirePositive(obj.h, 'h')
  const dpr = requirePositive(obj.dpr, 'dpr')
  const t0 = requireNonNegative(obj.t0, 't0')
  const orientation = obj.orientation
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new InkFormatError('ink-v1.orientation 必须是 portrait 或 landscape')
  }
  if (typeof obj.fullscreen !== 'boolean') throw new InkFormatError('ink-v1.fullscreen 必须是布尔值')

  const strokesRaw = obj.strokes
  if (!Array.isArray(strokesRaw)) throw new InkFormatError('ink-v1.strokes 必须是数组')
  const seenIds = new Set<number>()
  const strokes: InkStroke[] = strokesRaw.map((item, index) => normalizeStroke(item, index, seenIds))

  const opsRaw = obj.ops
  let ops: InkOp[] | undefined
  if (opsRaw !== undefined) {
    if (!Array.isArray(opsRaw)) throw new InkFormatError('ink-v1.ops 必须是数组')
    ops = opsRaw.map((item, index) => normalizeOp(item, index))
  }

  const doc: InkDocument = {
    v: INK_VERSION,
    w,
    h,
    dpr,
    t0,
    orientation,
    fullscreen: obj.fullscreen,
    strokes,
  }
  if (ops && ops.length > 0) doc.ops = ops
  return doc
}

function normalizeStroke(item: unknown, index: number, seenIds: Set<number>): InkStroke {
  const obj = asRecord(item, 'ink-v1.strokes[' + index + '] 必须是对象')
  if (!isFiniteNumber(obj.id) || !Number.isInteger(obj.id) || obj.id < 0) {
    throw new InkFormatError('ink-v1.strokes[' + index + '].id 必须是非负整数')
  }
  const id = obj.id
  if (seenIds.has(id)) throw new InkFormatError('ink-v1.strokes 里 id 重复：' + id)
  seenIds.add(id)
  const p = obj.p
  if (p !== 'pen' && p !== 'touch' && p !== 'mouse') {
    throw new InkFormatError('ink-v1.strokes[' + index + '].p 必须是 pen / touch / mouse')
  }
  const pointsRaw = obj.pts
  if (!Array.isArray(pointsRaw) || pointsRaw.length === 0) {
    throw new InkFormatError('ink-v1.strokes[' + index + '].pts 必须是非空数组')
  }
  const points: InkPoint[] = pointsRaw.map((point, pointIndex) => normalizePoint(point, index, pointIndex))
  return { id, p, pts: points }
}

function normalizePoint(item: unknown, strokeIndex: number, pointIndex: number): InkPoint {
  if (!Array.isArray(item) || item.length < 4) {
    throw new InkFormatError(
      'ink-v1.strokes[' + strokeIndex + '].pts[' + pointIndex + '] 必须是 [x, y, t, pressure] 数组',
    )
  }
  const x = item[0]
  const y = item[1]
  const t = item[2]
  const pressure = item[3]
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(t) || !isFiniteNumber(pressure)) {
    throw new InkFormatError(
      'ink-v1.strokes[' + strokeIndex + '].pts[' + pointIndex + '] 的坐标/时间/压力必须是数字',
    )
  }
  return [x, y, t, round2(clamp01(pressure))]
}

function normalizeIds(value: unknown, index: number): number[] {
  if (!Array.isArray(value) || value.some((id) => !isFiniteNumber(id) || !Number.isInteger(id))) {
    throw new InkFormatError('ink-v1.ops[' + index + '].ids 必须是整数数组')
  }
  return (value as number[]).map((id) => roundInt(id))
}

function normalizeOp(item: unknown, index: number): InkOp {
  const obj = asRecord(item, 'ink-v1.ops[' + index + '] 必须是对象')
  const t = isFiniteNumber(obj.t) && obj.t >= 0 ? obj.t : 0
  if (obj.op === 'erase') return { op: 'erase', ids: normalizeIds(obj.ids, index), t: roundInt(t) }
  if (obj.op === 'scratch') {
    if (!isFiniteNumber(obj.by) || !Number.isInteger(obj.by)) {
      throw new InkFormatError('ink-v1.ops[' + index + '].by 必须是整数')
    }
    return { op: 'scratch', ids: normalizeIds(obj.ids, index), by: obj.by, t: roundInt(t) }
  }
  if (obj.op === 'undo' || obj.op === 'redo') return { op: obj.op, t: roundInt(t) }
  throw new InkFormatError('ink-v1.ops[' + index + '] 有未知操作：' + String(obj.op))
}

// ---------------------------------------------------------------------------
// 编辑操作（撤销/重做/橡皮/清空/划掉）—— 纯函数，返回新状态
// ---------------------------------------------------------------------------

function appendOp(doc: InkDocument, op: InkOp): InkDocument {
  return { ...doc, ops: [...(doc.ops ?? []), op] }
}

function afterAction(state: InkEditState, doc: InkDocument): InkEditState {
  return { doc, undoDepth: Math.min(INK_MAX_UNDO, state.undoDepth + 1), redoDepth: 0 }
}

/** 下一笔的 id（取现有最大 id + 1）。 */
export function nextInkStrokeId(doc: InkDocument): number {
  let max = -1
  for (const stroke of doc.strokes) if (stroke.id > max) max = stroke.id
  return max + 1
}

/**
 * 提交一笔：默认先做划掉判定（03 §2.4），命中就记一条 scratch 操作，
 * 隐藏被覆盖笔画与划掉手势本身（手势笔迹仍保留在 strokes 里给教研用）。
 */
export function commitInkStroke(
  state: InkEditState,
  stroke: NewInkStroke,
  t = 0,
  options: { scratch?: ScratchOptions | false } = {},
): { state: InkEditState; stroke: InkStroke; scratch?: ScratchResult } {
  if (!stroke.pts.length) throw new Error('笔迹至少需要一个点')
  const full: InkStroke = {
    id: nextInkStrokeId(state.doc),
    p: stroke.p ?? 'touch',
    pts: stroke.pts.map(clonePoint),
  }
  const scratch =
    options.scratch === false ? undefined : detectScratch(visibleStrokes(state.doc), full, options.scratch ?? {})
  const doc: InkDocument = { ...cloneDocument(state.doc), strokes: [...state.doc.strokes.map(cloneStroke), full] }
  if (scratch?.matched) {
    doc.ops = [...(state.doc.ops ?? []), { op: 'scratch', ids: [...scratch.coveredIds], by: full.id, t: roundInt(t) }]
    return { state: afterAction(state, doc), stroke: full, scratch }
  }
  return { state: afterAction(state, doc), stroke: full, scratch }
}

/** 橡皮：按 id 删除（只影响当前可见的笔画），记一条 erase 操作。 */
export function eraseInkStrokes(state: InkEditState, ids: readonly number[], t = 0): InkEditState {
  const visible = new Set(visibleStrokes(state.doc).map((stroke) => stroke.id))
  const targets = [...new Set(ids)].filter((id) => visible.has(id))
  if (!targets.length) return state
  const doc = appendOp(cloneDocument(state.doc), { op: 'erase', ids: targets, t: roundInt(t) })
  return afterAction(state, doc)
}

/** 橡皮：沿橡皮轨迹删除相交的整笔（03 §2.3）。 */
export function eraseInkAlongPath(
  state: InkEditState,
  path: readonly InkPoint[],
  radius = DEFAULT_ERASER_RADIUS,
  t = 0,
): InkEditState {
  const targets = findStrokesNearPath(visibleStrokes(state.doc), path, radius)
  return eraseInkStrokes(state, targets, t)
}

/** 清空：记为一组 erase 操作（03 §2.3，可撤销）。 */
export function clearInk(state: InkEditState, t = 0): InkEditState {
  return eraseInkStrokes(
    state,
    visibleStrokes(state.doc).map((stroke) => stroke.id),
    t,
  )
}

/** 撤销上一步（以「操作」为单位，03 §2.3）。 */
export function undoInk(state: InkEditState, t = 0): InkEditState {
  if (state.undoDepth <= 0) return state
  const doc = appendOp(cloneDocument(state.doc), { op: 'undo', t: roundInt(t) })
  return { doc, undoDepth: state.undoDepth - 1, redoDepth: Math.min(INK_MAX_UNDO, state.redoDepth + 1) }
}

/** 重做。 */
export function redoInk(state: InkEditState, t = 0): InkEditState {
  if (state.redoDepth <= 0) return state
  const doc = appendOp(cloneDocument(state.doc), { op: 'redo', t: roundInt(t) })
  return { doc, undoDepth: Math.min(INK_MAX_UNDO, state.undoDepth + 1), redoDepth: state.redoDepth - 1 }
}

export function canUndoInk(state: InkEditState): boolean {
  return state.undoDepth > 0
}

export function canRedoInk(state: InkEditState): boolean {
  return state.redoDepth > 0
}

/** 画布尺寸/dpr/朝向/全屏/起始时间变化时同步进文档（03 §2.6）。不产生撤销记录。 */
export function setInkMeta(state: InkEditState, meta: Partial<InkMeta>): InkEditState {
  const doc = cloneDocument(state.doc)
  if (meta.w !== undefined) doc.w = round2(Math.max(1, meta.w))
  if (meta.h !== undefined) doc.h = round2(Math.max(1, meta.h))
  if (meta.dpr !== undefined) doc.dpr = round2(Math.max(1, meta.dpr))
  if (meta.t0 !== undefined) doc.t0 = Math.max(0, roundInt(meta.t0))
  if (meta.orientation !== undefined) doc.orientation = meta.orientation
  if (meta.fullscreen !== undefined) doc.fullscreen = meta.fullscreen
  return { ...state, doc }
}
