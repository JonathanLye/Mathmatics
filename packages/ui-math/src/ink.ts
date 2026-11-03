/**
 * ink-v1 手写笔迹 —— 纯逻辑（无 DOM / 无 Vue 依赖，可在 vitest node 环境直接跑）。
 *
 * 口径：10-开发文档/03-手写键盘与识别.md §2（ink-v1 采集、平滑、撤销/重做、橡皮、划掉删除），
 *       issue #14「手写画布（ink-v1）」。
 *
 * 对外导出的 ink-v1 JSON（见 serializeInk）：
 * {
 *   "version": 1,
 *   "canvas": { "width": 360, "height": 180, "dpr": 3 },
 *   "strokes": [
 *     { "id": 0, "color": "#1d2430", "width": 2.6, "points": [[12.5, 40, 0], [13.1, 41.2, 16]] }
 *   ],
 *   "ops": [                                    // 可选：编辑操作，保留给研究用（03 §2.1）；无编辑时省略
 *     { "op": "erase", "ids": [1], "t": 5230 },
 *     { "op": "scratch", "ids": [2], "by": 3, "t": 7400 },
 *     { "op": "undo", "ids": [4], "t": 6100 },
 *     { "op": "redo", "ids": [4], "t": 6300 }
 *   ]
 * }
 *
 * 取舍（与 03 §2.1 草案的差异，已在 #14 汇报中标注，待 B 的 #21 对齐后再定稿上传格式）：
 * - 用 version/canvas/strokes[points[x,y,t]] 的新结构（issue #14 约定）；
 * - 03 §2.1 的 v/w/h/pts[x,y,t,pressure]/p 旧结构 parseInk 仍兼容读取，统一归一化成新结构；
 * - 暂不采集 pressure / pointerType：P0 手写行主要来自手指与触控笔，压感对识别收益未知，
 *   先按固定线宽采集（画布组件仍有 width 字段，后续补压力不破格式）。
 *
 * 可见性模型（03 §2.1「最终参与识别的笔画 = 全部笔画 − 被擦除/划掉/撤销的笔画」）：
 * - strokes 只增不删（研究要保留原始笔迹）；
 * - ops 按时间顺序追加，决定最终哪些笔画可见：
 *   · erase   ：隐藏 ids；
 *   · scratch ：隐藏 ids 与实施划掉的笔画 by；
 *   · undo    ：翻转 ids 的可见性（撤销上一步）；
 *   · redo    ：再翻转回来（重做）；
 * - visibleStrokes()/replayInk() 都按这套规则还原，序列化-解析-重放因此可逆。
 */

/** 一个笔迹点：[x, y, t]；x/y 为 CSS 像素（相对画布左上角），t 为相对会话起点的毫秒。 */
export type InkPoint = [number, number, number]

/** 一笔笔迹：id 在会话内唯一，color/width 是渲染属性，points 按落笔顺序。 */
export interface InkStroke {
  id: number
  color: string
  width: number
  points: InkPoint[]
}

/** 画布元信息：CSS 尺寸 + 设备像素比（高清渲染用）。 */
export interface InkCanvasMeta {
  width: number
  height: number
  dpr: number
}

/** 编辑操作（研究字段，见 03 §2.1）。 */
export type InkOp =
  | { op: 'erase'; ids: number[]; t: number }
  | { op: 'scratch'; ids: number[]; by: number; t: number }
  | { op: 'undo'; ids: number[]; t: number }
  | { op: 'redo'; ids: number[]; t: number }

/** ink-v1 文档。 */
export interface InkDocument {
  version: 1
  canvas: InkCanvasMeta
  strokes: InkStroke[]
  ops?: InkOp[]
}

/** 编辑状态：文档 + 撤销/重做栈（栈里存「本次操作翻转可见性的笔画 id」）。 */
export interface InkEditState {
  doc: InkDocument
  undoStack: number[][]
  redoStack: number[][]
}

/** 提交一笔新笔迹时由调用方提供的部分（id/颜色/线宽可省略）。 */
export interface NewInkStroke {
  points: readonly InkPoint[]
  color?: string
  width?: number
}

/** 画布组件可注入的划掉判定参数（测试与调参用）。 */
export interface ScratchOptions {
  /** 水平方向反转次数下限，默认 3（03 §2.4）。 */
  minReversals?: number
  /** 路径总长 / 包围盒宽度 下限，默认 2.5（03 §2.4）。 */
  minLengthRatio?: number
  /** 与已有笔画包围盒的重叠面积比下限，默认 0.6（03 §2.4）。 */
  minOverlapRatio?: number
  /** 重叠面积采样网格边长，默认 10。 */
  overlapSamples?: number
}

export type ScratchFailReason = 'not-horizontal' | 'reversals' | 'length' | 'overlap' | 'no-covered'

/** 划掉判定结果（matched=false 时 failed 说明差在哪，便于调参与测试）。 */
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

/** ink-v1 版本号；不兼容的版本 parseInk 会拒绝。 */
export const INK_VERSION = 1 as const
/** 撤销栈深度上限（03 §2.3：栈深 100）。 */
export const INK_MAX_UNDO = 100
/** 线宽/颜色缺省值；真实画布会从 tokens 读取 --ink 后显式传入。 */
export const DEFAULT_STROKE_COLOR = 'currentColor'
export const DEFAULT_STROKE_WIDTH = 2.6
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

/** 新建一份空白 ink-v1 文档；画布挂载后由 setInkCanvas 覆盖真实尺寸。 */
export function createInkDocument(meta: Partial<InkCanvasMeta> = {}): InkDocument {
  return {
    version: INK_VERSION,
    canvas: {
      width: meta.width ?? 1,
      height: meta.height ?? 1,
      dpr: meta.dpr ?? 1,
    },
    strokes: [],
  }
}

/** 新建编辑状态；传入已有文档时撤销栈从空开始（文档里的 ops 仍参与重放）。 */
export function createInkEditState(doc: InkDocument = createInkDocument()): InkEditState {
  return { doc: cloneDoc(doc), undoStack: [], redoStack: [] }
}

export function cloneStroke(stroke: InkStroke): InkStroke {
  return { ...stroke, points: stroke.points.map((p) => [p[0], p[1], p[2]] as InkPoint) }
}

function cloneOps(ops: InkOp[] | undefined): InkOp[] | undefined {
  if (!ops) return undefined
  return ops.map((op) =>
    op.op === 'scratch'
      ? { op: 'scratch', ids: [...op.ids], by: op.by, t: op.t }
      : { op: op.op, ids: [...op.ids], t: op.t },
  )
}

function cloneDoc(doc: InkDocument): InkDocument {
  const next: InkDocument = { version: INK_VERSION, canvas: { ...doc.canvas }, strokes: doc.strokes.map(cloneStroke) }
  const ops = cloneOps(doc.ops)
  if (ops && ops.length > 0) next.ops = ops
  return next
}

// ---------------------------------------------------------------------------
// 采样 / 平滑
// ---------------------------------------------------------------------------

/**
 * 追加一个采样点（不可变：返回新数组）。
 * - 距上一点 < minDistance 时丢弃（同一像素抖动）；
 * - t 强制单调不减（防系统时钟回拨/乱序 coalesced 事件）。
 */
export function appendPoint(
  points: readonly InkPoint[],
  point: readonly [number, number, number],
  minDistance = MIN_POINT_DISTANCE,
): InkPoint[] {
  const x = round2(point[0])
  const y = round2(point[1])
  const last = points[points.length - 1]
  let t = Math.max(0, roundInt(point[2]))
  if (last) {
    if (Math.hypot(x - last[0], y - last[1]) < minDistance) return points.slice() as InkPoint[]
    if (t < last[2]) t = last[2]
  }
  return [...points, [x, y, t]]
}

/**
 * 滑动平均平滑（窗口默认 3，首尾点保持不动）。
 * 只动 x/y，不动 t —— 时间轴必须保持原采样顺序（重放/研究都依赖它）。
 */
export function smoothPoints(points: readonly InkPoint[], window = 3): InkPoint[] {
  const count = points.length
  if (count <= 2 || window < 3) return points.map((p) => [p[0], p[1], p[2]] as InkPoint)
  const half = Math.floor(window / 2)
  const out: InkPoint[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const point = points[i]
    if (!point) continue
    if (i === 0 || i === count - 1) {
      out[i] = [point[0], point[1], point[2]]
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
    out[i] = [round2(sumX / n), round2(sumY / n), point[2]]
  }
  return out
}

/** 平滑一整笔（点数量与时间戳不变，便于序列化后逐点对照）。 */
export function smoothStroke(stroke: InkStroke, window = 3): InkStroke {
  return { ...stroke, points: smoothPoints(stroke.points, window) }
}

/** 按最小距离抽稀点（03 §2.1：上传超 256 KB 时按 1 px 抽稀）；始终保留首尾点。 */
export function simplifyPoints(points: readonly InkPoint[], minDistance = 1): InkPoint[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1], p[2]] as InkPoint)
  const out: InkPoint[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance) {
      out.push([point[0], point[1], point[2]])
    }
  }
  const tail = points[points.length - 1]
  const lastKept = out[out.length - 1]
  if (tail && lastKept && (lastKept[0] !== tail[0] || lastKept[1] !== tail[1])) {
    out.push([tail[0], tail[1], tail[2]])
  }
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
  return pointsBBox(stroke.points)
}

/** 多笔包围盒；全空返回 null。 */
export function strokesBBox(strokes: readonly InkStroke[]): InkBBox | null {
  const boxes = strokes.map(strokeBBox).filter((b): b is InkBBox => b !== null)
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

/** 水平方向反转到次数（忽略 < minDelta 的手抖，03 §2.4）。 */
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
    for (const [a, b] of strokeSegments(stroke.points)) {
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
 * 水平来回 ≥ 3 次、路径总长 ≥ 包围盒宽度 × 2.5、与已有笔画包围盒重叠 ≥ 60%，且覆盖到至少一笔；
 * 另要求包围盒横向（宽 ≥ 高），对应产品里的「横向划掉」。
 */
export function detectScratch(
  existing: readonly InkStroke[],
  candidate: readonly InkPoint[] | InkStroke,
  options: ScratchOptions = {},
): ScratchResult {
  const points: readonly InkPoint[] = isInkStroke(candidate) ? candidate.points : candidate
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
// 可见性 / 重放
// ---------------------------------------------------------------------------

/** 按 ops 计算还可见的笔画 id（03 §2.1：最终参与识别的笔画）。 */
export function visibleStrokeIds(doc: InkDocument): number[] {
  const visible = new Set(doc.strokes.map((stroke) => stroke.id))
  for (const op of doc.ops ?? []) {
    if (op.op === 'erase') {
      for (const id of op.ids) visible.delete(id)
    } else if (op.op === 'scratch') {
      for (const id of op.ids) visible.delete(id)
      visible.delete(op.by)
    } else {
      for (const id of op.ids) {
        if (visible.has(id)) visible.delete(id)
        else visible.add(id)
      }
    }
  }
  return doc.strokes.filter((stroke) => visible.has(stroke.id)).map((stroke) => stroke.id)
}

/** 还可见的笔画（保持落笔顺序），供绘制与重放。 */
export function visibleStrokes(doc: InkDocument): InkStroke[] {
  const ids = new Set(visibleStrokeIds(doc))
  return doc.strokes.filter((stroke) => ids.has(stroke.id)).map(cloneStroke)
}

/**
 * 重放：解析 ink-v1 JSON（或直接传文档），按 ops 还原成可绘制的笔画列表。
 * 只读回放 / 缩略图 / 后续服务端栅格化都用它，保证「导出的 ink-v1 能重放」。
 */
export function replayInk(
  input: string | InkDocument,
  options: { smooth?: boolean; window?: number } = {},
): InkStroke[] {
  const doc = typeof input === 'string' ? parseInk(input) : input
  const strokes = visibleStrokes(doc)
  if (!options.smooth) return strokes
  return strokes.map((stroke) => smoothStroke(stroke, options.window ?? 3))
}

// ---------------------------------------------------------------------------
// 序列化 / 解析（带校验）
// ---------------------------------------------------------------------------

/** 序列化成 ink-v1 JSON 字符串。数值统一保留 2 位小数、t 取整，保证往返稳定。 */
export function serializeInk(input: InkDocument | InkEditState): string {
  const doc = 'doc' in input ? input.doc : input
  const payload: {
    version: 1
    canvas: { width: number; height: number; dpr: number }
    strokes: Array<{ id: number; color: string; width: number; points: Array<[number, number, number]> }>
    ops?: InkOp[]
  } = {
    version: INK_VERSION,
    canvas: {
      width: round2(doc.canvas.width),
      height: round2(doc.canvas.height),
      dpr: round2(doc.canvas.dpr),
    },
    strokes: doc.strokes.map((stroke) => ({
      id: stroke.id,
      color: stroke.color,
      width: round2(stroke.width),
      points: stroke.points.map((point) => [round2(point[0]), round2(point[1]), roundInt(point[2])]),
    })),
  }
  if (doc.ops && doc.ops.length > 0) payload.ops = doc.ops.map(cloneOpForSerialize)
  return JSON.stringify(payload)
}

function cloneOpForSerialize(op: InkOp): InkOp {
  return op.op === 'scratch'
    ? { op: 'scratch', ids: [...op.ids], by: op.by, t: roundInt(op.t) }
    : { op: op.op, ids: [...op.ids], t: roundInt(op.t) }
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

/** 校验 + 归一化（兼容 03 §2.1 的 v/w/h/pts 旧结构）。 */
export function normalizeInkDocument(raw: unknown): InkDocument {
  const obj = asRecord(raw, 'ink-v1 顶层必须是对象')
  const version = obj.version ?? obj.v
  if (version !== INK_VERSION) {
    throw new InkFormatError('不支持的 ink-v1 版本：' + String(version) + '（只支持 ' + INK_VERSION + '）')
  }

  const canvas = normalizeCanvas(obj)
  if (!canvas) throw new InkFormatError('ink-v1 缺少合法的画布尺寸（canvas.width / canvas.height）')

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

  const doc: InkDocument = { version: INK_VERSION, canvas, strokes }
  if (ops && ops.length > 0) doc.ops = ops
  return doc
}

function normalizeCanvas(obj: Record<string, unknown>): InkCanvasMeta | null {
  if (obj.canvas !== undefined) {
    const canvas = asRecord(obj.canvas, 'ink-v1.canvas 必须是对象')
    const width = canvas.width
    const height = canvas.height
    if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) return null
    const dpr = isFiniteNumber(canvas.dpr) && canvas.dpr > 0 ? canvas.dpr : 1
    return { width, height, dpr }
  }
  // 兼容 03 §2.1 旧结构：w / h / dpr
  const width = obj.w
  const height = obj.h
  if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) return null
  const dpr = isFiniteNumber(obj.dpr) && obj.dpr > 0 ? obj.dpr : 1
  return { width, height, dpr }
}

function normalizeStroke(item: unknown, index: number, seenIds: Set<number>): InkStroke {
  const obj = asRecord(item, 'ink-v1.strokes[' + index + '] 必须是对象')
  const id = isFiniteNumber(obj.id) ? roundInt(obj.id) : index
  if (id < 0) throw new InkFormatError('ink-v1.strokes[' + index + '].id 不能为负')
  if (seenIds.has(id)) throw new InkFormatError('ink-v1.strokes 里 id 重复：' + id)
  seenIds.add(id)
  const color = typeof obj.color === 'string' && obj.color.trim() ? obj.color : DEFAULT_STROKE_COLOR
  const width = isFiniteNumber(obj.width) && obj.width > 0 ? obj.width : DEFAULT_STROKE_WIDTH
  const pointsRaw = obj.points ?? obj.pts
  if (!Array.isArray(pointsRaw) || pointsRaw.length === 0) {
    throw new InkFormatError('ink-v1.strokes[' + index + '].points 必须是非空数组')
  }
  const points: InkPoint[] = pointsRaw.map((point, pointIndex) => normalizePoint(point, index, pointIndex))
  return { id, color, width, points }
}

function normalizePoint(item: unknown, strokeIndex: number, pointIndex: number): InkPoint {
  if (!Array.isArray(item) || item.length < 3) {
    throw new InkFormatError(
      'ink-v1.strokes[' + strokeIndex + '].points[' + pointIndex + '] 必须是 [x, y, t] 数组',
    )
  }
  const x = item[0]
  const y = item[1]
  const t = item[2]
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(t)) {
    throw new InkFormatError('ink-v1.strokes[' + strokeIndex + '].points[' + pointIndex + '] 坐标必须是数字')
  }
  return [x, y, t]
}

function normalizeOp(item: unknown, index: number): InkOp {
  const obj = asRecord(item, 'ink-v1.ops[' + index + '] 必须是对象')
  const op = obj.op
  const t = isFiniteNumber(obj.t) ? obj.t : 0
  if (op === 'erase' || op === 'undo' || op === 'redo') {
    return { op, ids: normalizeIds(obj.ids, index), t }
  }
  if (op === 'scratch') {
    const by = obj.by
    if (!isFiniteNumber(by)) throw new InkFormatError('ink-v1.ops[' + index + '].by 必须是数字')
    return { op: 'scratch', ids: normalizeIds(obj.ids, index), by, t }
  }
  throw new InkFormatError('ink-v1.ops[' + index + '] 有未知操作：' + String(op))
}

function normalizeIds(value: unknown, index: number): number[] {
  if (!Array.isArray(value) || value.some((id) => !isFiniteNumber(id))) {
    throw new InkFormatError('ink-v1.ops[' + index + '].ids 必须是数字数组')
  }
  return value.map((id) => roundInt(id as number))
}

// ---------------------------------------------------------------------------
// 编辑操作（撤销/重做/橡皮/清空/划掉）—— 纯函数，返回新状态
// ---------------------------------------------------------------------------

function appendOp(doc: InkDocument, op: InkOp): InkDocument {
  return { ...doc, ops: [...(doc.ops ?? []), op] }
}

function withEdit(state: InkEditState, doc: InkDocument, toggleIds: readonly number[]): InkEditState {
  const undoStack = [...state.undoStack, [...toggleIds]]
  while (undoStack.length > INK_MAX_UNDO) undoStack.shift()
  return { doc, undoStack, redoStack: [] }
}

/** 下一笔的 id（取现有最大 id + 1）。 */
export function nextInkStrokeId(doc: InkDocument): number {
  let max = -1
  for (const stroke of doc.strokes) if (stroke.id > max) max = stroke.id
  return max + 1
}

/** 提交一笔：默认先做划掉判定（03 §2.4），命中就按 scratch 隐藏被覆盖笔画与这一笔本身。 */
export function commitInkStroke(
  state: InkEditState,
  stroke: NewInkStroke,
  t = 0,
  options: { scratch?: ScratchOptions | false } = {},
): { state: InkEditState; stroke: InkStroke; scratch?: ScratchResult } {
  if (!stroke.points.length) throw new Error('笔迹至少需要一个点')
  const id = nextInkStrokeId(state.doc)
  const full: InkStroke = {
    id,
    color: stroke.color ?? DEFAULT_STROKE_COLOR,
    width: stroke.width ?? DEFAULT_STROKE_WIDTH,
    points: stroke.points.map((p) => [p[0], p[1], p[2]] as InkPoint),
  }
  const scratch =
    options.scratch === false ? undefined : detectScratch(visibleStrokes(state.doc), full, options.scratch ?? {})
  const doc: InkDocument = { ...state.doc, strokes: [...cloneDoc(state.doc).strokes, full] }
  if (scratch?.matched) {
    doc.ops = [...(state.doc.ops ?? []), { op: 'scratch', ids: [...scratch.coveredIds], by: id, t: roundInt(t) }]
    // 注意：撤销划掉 = 让被覆盖笔画重新可见；划掉手势本身保持隐藏（不回放乱涂）。
    return { state: withEdit(state, doc, scratch.coveredIds), stroke: full, scratch }
  }
  return { state: withEdit(state, doc, [id]), stroke: full, scratch }
}

/** 橡皮：按 id 删除（只影响当前可见的笔画），记一条 erase 操作。 */
export function eraseInkStrokes(state: InkEditState, ids: readonly number[], t = 0): InkEditState {
  const visible = new Set(visibleStrokes(state.doc).map((stroke) => stroke.id))
  const targets = [...new Set(ids)].filter((id) => visible.has(id))
  if (!targets.length) return state
  const doc = appendOp(state.doc, { op: 'erase', ids: targets, t: roundInt(t) })
  return withEdit(state, doc, targets)
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

/** 撤销上一步（以「操作」为单位）。时间 t 用于研究日志。 */
export function undoInk(state: InkEditState, t = 0): InkEditState {
  const ids = state.undoStack[state.undoStack.length - 1]
  if (!ids) return state
  const undoStack = state.undoStack.slice(0, -1)
  const doc = appendOp(state.doc, { op: 'undo', ids: [...ids], t: roundInt(t) })
  return { doc, undoStack, redoStack: [...state.redoStack, ids] }
}

/** 重做。 */
export function redoInk(state: InkEditState, t = 0): InkEditState {
  const ids = state.redoStack[state.redoStack.length - 1]
  if (!ids) return state
  const redoStack = state.redoStack.slice(0, -1)
  const doc = appendOp(state.doc, { op: 'redo', ids: [...ids], t: roundInt(t) })
  return { doc, undoStack: [...state.undoStack, ids], redoStack }
}

export function canUndoInk(state: InkEditState): boolean {
  return state.undoStack.length > 0
}

export function canRedoInk(state: InkEditState): boolean {
  return state.redoStack.length > 0
}

/** 画布尺寸/dpr 变化时同步进文档（旋转、全屏、窗口缩放）。不产生撤销记录。 */
export function setInkCanvas(state: InkEditState, meta: Partial<InkCanvasMeta>): InkEditState {
  const next = {
    width: meta.width ?? state.doc.canvas.width,
    height: meta.height ?? state.doc.canvas.height,
    dpr: meta.dpr ?? state.doc.canvas.dpr,
  }
  const canvas: InkCanvasMeta = {
    width: round2(Math.max(1, next.width)),
    height: round2(Math.max(1, next.height)),
    dpr: round2(Math.max(1, next.dpr)),
  }
  return { ...state, doc: { ...state.doc, canvas } }
}
