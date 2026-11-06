/**
 * 学习路径的纯逻辑（无 DOM，tests/pathLogic.test.ts 覆盖）：蜿蜒路径的几何、节点外观、步骤条、截止时间。
 * 完成、锁定都是服务端给的；这里只决定怎么画，不判定对错。
 */
import { LAYER_NAMES } from '@/copy'
import type { SegmentState } from '@/components/ui/uiLogic'
import type { LayerId } from '@/types/attempt'
import type { PathItem } from '@/types/path'

/** 路径用一张逻辑画布（340 宽），按容器宽度等比缩放：节点坐标是百分比，首帧不用量宽度。 */
export const PATH_WIDTH = 340
export const PATH_STEP = 148
/** 第一个节点就是当前节点时，上面要留出“继续”气泡和小方说话的位置。 */
export const PATH_TOP_ROOMY = 124
export const PATH_TOP = 60
export const PATH_BOTTOM = 92
export const PATH_AMPLITUDE = 92
/** 正弦相位步长：约 7 个节点绕一圈，左右来回，又不会每个节点都急转。 */
const PATH_PHASE = 0.9

export interface PathPoint {
  x: number
  y: number
}

/** 第 i 个点的位置；从中线出发，向右摆到最远再摆回左边。 */
export function pathPoint(index: number, top: number = PATH_TOP): PathPoint {
  return {
    x: Math.round((PATH_WIDTH / 2 + PATH_AMPLITUDE * Math.sin(index * PATH_PHASE)) * 10) / 10,
    y: top + index * PATH_STEP,
  }
}

export function pathPoints(count: number, top: number = PATH_TOP): PathPoint[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => pathPoint(i, top))
}

export function pathHeight(count: number, top: number = PATH_TOP): number {
  return count <= 0 ? top + PATH_BOTTOM : top + (count - 1) * PATH_STEP + PATH_BOTTOM
}

/** 节点的标题让不让位：当前节点不显示（小方在说）；前一个节点和小方同侧时也收起来，免得和气泡挤在一起。 */
export function labelHidden(index: number, current: number, sides: readonly ('left' | 'right')[]): boolean {
  if (index === current) return true
  return current > 0 && index === current - 1 && sides[index] === sides[current]
}

/** 两点之间的一段路：两端都竖直进出，连起来是顺滑的 S 形。 */
export function segmentPath(a: PathPoint, b: PathPoint): string {
  const mid = (b.y - a.y) / 2
  return `M${a.x} ${a.y}C${a.x} ${a.y + mid} ${b.x} ${b.y - mid} ${b.x} ${b.y}`
}

/** 节点在容器里的百分比坐标。 */
export function pointStyle(point: PathPoint, height: number): { left: string; top: string } {
  return {
    left: `${Math.round((point.x / PATH_WIDTH) * 10000) / 100}%`,
    top: `${Math.round((point.y / height) * 10000) / 100}%`,
  }
}

/** 节点哪一侧空：标题和小方放在这一侧。 */
export function freeSide(point: PathPoint): 'left' | 'right' {
  return point.x > PATH_WIDTH / 2 + 8 ? 'left' : 'right'
}

export type NodeVisual = 'done' | 'current' | 'active' | 'todo' | 'locked'

/** 当前该做的那一道：第一道进行中的；没有就第一道没被软锁的未开始题；都做完了返回 -1。 */
export function currentIndex(items: readonly PathItem[]): number {
  const active = items.findIndex((item) => item.state === 'active')
  if (active !== -1) return active
  return items.findIndex((item) => item.state === 'todo' && !item.softLocked)
}

export function nodeVisual(item: PathItem, isCurrent: boolean): NodeVisual {
  if (item.state === 'done') return 'done'
  if (isCurrent) return 'current'
  if (item.state === 'active') return 'active'
  return item.softLocked ? 'locked' : 'todo'
}

export type NodeActionKind = 'start' | 'continue' | 'review'

export function nodeAction(item: Pick<PathItem, 'state'>): NodeActionKind {
  if (item.state === 'done') return 'review'
  return item.state === 'active' ? 'continue' : 'start'
}

/** 进度环：做了几层。只有开始了才有环。 */
export function layerFraction(item: Pick<PathItem, 'state' | 'layersDone' | 'layersTotal'>): number {
  if (item.state === 'done') return 1
  if (item.state !== 'active' || item.layersTotal <= 0) return 0
  return Math.min(1, Math.max(0, item.layersDone / item.layersTotal))
}

export interface StepView {
  id: LayerId | null
  label: string
  state: SegmentState
}

const ALL_LAYERS: readonly LayerId[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']
/** 导入题只有写证明和总结两层。 */
const IMPORTED_LAYERS: readonly LayerId[] = ['L3', 'L6']

function positionState(i: number, at: number): SegmentState {
  if (i < at) return 'done'
  return i === at ? 'active' : 'todo'
}

/** 卡片上的步骤条。层数既不是 6 也不是 2 时，只画段数，不猜名字。 */
export function stepsFor(item: Pick<PathItem, 'state' | 'currentLayer' | 'layersDone' | 'layersTotal'>): StepView[] {
  const total = Math.max(0, item.layersTotal)
  const ids: ReadonlyArray<LayerId | null> =
    total === 6 ? ALL_LAYERS : total === 2 ? IMPORTED_LAYERS : Array.from({ length: total }, () => null)
  const known = item.currentLayer ? ids.indexOf(item.currentLayer) : -1
  const at = known !== -1 ? known : item.layersDone
  return ids.map((id, i) => {
    const label = id ? LAYER_NAMES[id] : ''
    if (item.state === 'done') return { id, label, state: 'done' }
    if (item.state !== 'active') return { id, label, state: 'todo' }
    return { id, label, state: positionState(i, at) }
  })
}

export interface DeadlineView {
  text: string
  /** 24 小时内截止：换提醒色。 */
  soon: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => pad(d.getHours()) + ':' + pad(d.getMinutes())
const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000

/** 老师布置的截止时间（本地时区）。没有截止时间返回 null，由页面不显示。 */
export function deadlineView(closeAt: string | null | undefined, now: number = Date.now()): DeadlineView | null {
  if (!closeAt) return null
  const end = new Date(closeAt)
  if (Number.isNaN(end.getTime())) return null
  const left = end.getTime() - now
  if (left <= 0) return { text: '已到截止时间', soon: true }
  const days = dayNumber(end) - dayNumber(new Date(now))
  const soon = left <= 24 * 60 * 60 * 1000
  if (days === 0) return { text: `今天 ${hhmm(end)} 截止`, soon }
  if (days === 1) return { text: `明天 ${hhmm(end)} 截止`, soon }
  return { text: `${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${hhmm(end)} 截止`, soon }
}

/** 上次看路径时已完成的节点，和这次比：这次新完成的就是要播动画的。 */
export function newlyDone(seen: readonly string[] | null, items: readonly PathItem[]): string[] {
  if (seen === null) return []
  const known = new Set(seen)
  return items.filter((item) => item.state === 'done' && !known.has(item.problemId)).map((item) => item.problemId)
}

export function doneIds(items: readonly PathItem[]): string[] {
  return items.filter((item) => item.state === 'done').map((item) => item.problemId)
}

const SEEN_KEY = 'pg.path.seen.v1'

/** 本机记一下每个单元看到过哪些已完成节点；存不了就当没看过，不播动画。 */
export function readSeen(unitId: string): string[] | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>
    const list = all[unitId]
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : null
  } catch {
    return null
  }
}

export function writeSeen(unitId: string, ids: readonly string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>
    all[unitId] = ids
    localStorage.setItem(SEEN_KEY, JSON.stringify(all))
  } catch {
    /* 隐私模式写不进去：下次不播动画而已 */
  }
}

/** 这个单元是本章第几个（从 1 数）。库里的 unitNo 是排序键（如 101、102），不能直接给人看。 */
export function unitOrdinalInChapter(units: ReadonlyArray<{ id: string; chapterNo: number }>, unitId: string | undefined): number {
  const unit = units.find((u) => u.id === unitId)
  if (!unit) return 1
  return units.filter((u) => u.chapterNo === unit.chapterNo).findIndex((u) => u.id === unitId) + 1
}
