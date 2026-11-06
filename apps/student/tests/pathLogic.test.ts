import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PATH_AMPLITUDE,
  PATH_STEP,
  PATH_WIDTH,
  currentIndex,
  deadlineView,
  doneIds,
  freeSide,
  labelHidden,
  layerFraction,
  newlyDone,
  nodeAction,
  nodeVisual,
  pathHeight,
  pathPoint,
  pathPoints,
  pointStyle,
  readSeen,
  segmentPath,
  stepsFor,
  unitOrdinalInChapter,
  writeSeen,
} from '@/components/path/pathLogic'
import type { PathItem } from '@/types/path'

function item(over: Partial<PathItem> = {}): PathItem {
  return {
    problemId: 'p',
    title: 't',
    stemPreview: 's',
    difficulty: 'easy',
    state: 'todo',
    currentLayer: null,
    layersDone: 0,
    layersTotal: 6,
    attemptId: null,
    reviewPublished: false,
    autoImported: false,
    softLocked: false,
    lessonAvailable: true,
    ...over,
  }
}

describe('路径几何', () => {
  it('节点从中线出发，左右来回，始终留在画布里', () => {
    expect(pathPoint(0).x).toBe(PATH_WIDTH / 2)
    const points = pathPoints(30)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(PATH_WIDTH / 2 - PATH_AMPLITUDE)
      expect(p.x).toBeLessThanOrEqual(PATH_WIDTH / 2 + PATH_AMPLITUDE)
    }
    expect(points.some((p) => p.x > PATH_WIDTH / 2 + 40)).toBe(true)
    expect(points.some((p) => p.x < PATH_WIDTH / 2 - 40)).toBe(true)
    for (let i = 1; i < points.length; i += 1) expect(points[i].y - points[i - 1].y).toBe(PATH_STEP)
  })

  it('高度够放下所有节点，百分比坐标不超过 100%', () => {
    const points = pathPoints(5)
    const height = pathHeight(5)
    for (const p of points) {
      expect(p.y).toBeLessThan(height)
      const style = pointStyle(p, height)
      expect(Number.parseFloat(style.left)).toBeLessThanOrEqual(100)
      expect(Number.parseFloat(style.top)).toBeLessThanOrEqual(100)
    }
    expect(pathHeight(0)).toBeGreaterThan(0)
    expect(pathPoints(0)).toEqual([])
  })

  it('一段路是从 a 到 b 的三次贝塞尔', () => {
    expect(segmentPath({ x: 10, y: 0 }, { x: 30, y: 100 })).toBe('M10 0C10 50 30 50 30 100')
  })

  it('第一个节点上方可以多留空间', () => {
    expect(pathPoint(0, 200).y).toBe(200)
    expect(pathHeight(3, 200) - pathHeight(3, 100)).toBe(100)
  })

  it('当前节点不显示标题；前一个节点和小方同侧时也收起', () => {
    expect(labelHidden(2, 2, ['right', 'left', 'left'])).toBe(true)
    expect(labelHidden(1, 2, ['right', 'left', 'left'])).toBe(true)
    expect(labelHidden(1, 2, ['right', 'right', 'left'])).toBe(false)
    expect(labelHidden(0, 2, ['left', 'left', 'left'])).toBe(false)
    expect(labelHidden(0, -1, ['left'])).toBe(false)
  })

  it('节点靠右时标题放左边，否则放右边', () => {
    expect(freeSide({ x: PATH_WIDTH - 20, y: 0 })).toBe('left')
    expect(freeSide({ x: 20, y: 0 })).toBe('right')
    expect(freeSide({ x: PATH_WIDTH / 2, y: 0 })).toBe('right')
  })
})

describe('节点状态', () => {
  it('当前节点：优先进行中，其次第一道没被软锁的，全做完是 -1', () => {
    expect(currentIndex([item({ state: 'done' }), item({ state: 'active' }), item({ softLocked: true })])).toBe(1)
    expect(currentIndex([item({ state: 'done' }), item(), item({ softLocked: true })])).toBe(1)
    expect(currentIndex([item({ state: 'done' }), item({ state: 'done' })])).toBe(-1)
    expect(currentIndex([])).toBe(-1)
  })

  it('外观只读服务端状态', () => {
    expect(nodeVisual(item({ state: 'done' }), false)).toBe('done')
    expect(nodeVisual(item({ state: 'active' }), true)).toBe('current')
    expect(nodeVisual(item({ state: 'active' }), false)).toBe('active')
    expect(nodeVisual(item({ softLocked: true }), false)).toBe('locked')
    expect(nodeVisual(item(), false)).toBe('todo')
    expect(nodeVisual(item(), true)).toBe('current')
  })

  it('动作：开始、继续、回看', () => {
    expect(nodeAction({ state: 'todo' })).toBe('start')
    expect(nodeAction({ state: 'active' })).toBe('continue')
    expect(nodeAction({ state: 'done' })).toBe('review')
  })

  it('进度环只在开始之后有', () => {
    expect(layerFraction(item())).toBe(0)
    expect(layerFraction(item({ state: 'active', layersDone: 3 }))).toBe(0.5)
    expect(layerFraction(item({ state: 'done' }))).toBe(1)
    expect(layerFraction(item({ state: 'active', layersTotal: 0 }))).toBe(0)
    expect(layerFraction(item({ state: 'active', layersDone: 9 }))).toBe(1)
  })
})

describe('步骤条', () => {
  it('六层题用六个名字，当前层之前算完成', () => {
    const steps = stepsFor(item({ state: 'active', currentLayer: 'L3', layersDone: 2 }))
    expect(steps.map((s) => s.label)).toEqual(['回忆定义', '搭骨架', '写证明', '自检', '换题试试', '总结'])
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'active', 'todo', 'todo', 'todo'])
  })

  it('导入题只有写证明和总结', () => {
    const steps = stepsFor(item({ state: 'active', currentLayer: 'L6', layersDone: 1, layersTotal: 2 }))
    expect(steps.map((s) => s.label)).toEqual(['写证明', '总结'])
    expect(steps.map((s) => s.state)).toEqual(['done', 'active'])
  })

  it('没开始全是待做，做完全是完成', () => {
    expect(stepsFor(item()).every((s) => s.state === 'todo')).toBe(true)
    expect(stepsFor(item({ state: 'done' })).every((s) => s.state === 'done')).toBe(true)
  })

  it('当前层不在已知列表里时按完成层数画；层数不认识时不猜名字', () => {
    const steps = stepsFor(item({ state: 'active', currentLayer: 'L4', layersDone: 1, layersTotal: 2 }))
    expect(steps.map((s) => s.state)).toEqual(['done', 'active'])
    const odd = stepsFor(item({ state: 'active', layersDone: 1, layersTotal: 3 }))
    expect(odd.map((s) => s.label)).toEqual(['', '', ''])
    expect(odd.map((s) => s.state)).toEqual(['done', 'active', 'todo'])
  })
})

describe('截止时间', () => {
  const NOW = new Date(2026, 10, 6, 10, 0).getTime()

  it('没有截止时间或坏值返回 null', () => {
    expect(deadlineView(null, NOW)).toBeNull()
    expect(deadlineView(undefined, NOW)).toBeNull()
    expect(deadlineView('不是时间', NOW)).toBeNull()
  })

  it('今天、明天、更远', () => {
    expect(deadlineView(new Date(2026, 10, 6, 18, 30).toISOString(), NOW)).toEqual({ text: '今天 18:30 截止', soon: true })
    expect(deadlineView(new Date(2026, 10, 7, 9, 0).toISOString(), NOW)).toEqual({ text: '明天 09:00 截止', soon: true })
    expect(deadlineView(new Date(2026, 10, 7, 23, 0).toISOString(), NOW)).toEqual({ text: '明天 23:00 截止', soon: false })
    expect(deadlineView(new Date(2026, 10, 12, 23, 59).toISOString(), NOW)).toEqual({ text: '11-12 23:59 截止', soon: false })
  })

  it('已过不说“迟了”，只说到了', () => {
    expect(deadlineView(new Date(2026, 10, 5, 9, 0).toISOString(), NOW)).toEqual({ text: '已到截止时间', soon: true })
  })
})

describe('路径动画的判断', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('第一次看不播，之后只播新完成的', () => {
    const items = [item({ problemId: 'a', state: 'done' }), item({ problemId: 'b', state: 'done' }), item({ problemId: 'c' })]
    expect(newlyDone(null, items)).toEqual([])
    expect(newlyDone(['a'], items)).toEqual(['b'])
    expect(newlyDone(['a', 'b'], items)).toEqual([])
    expect(doneIds(items)).toEqual(['a', 'b'])
  })

  it('本机记录：能读回来，坏数据和没有存储都当没看过', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    expect(readSeen('u1')).toBeNull()
    writeSeen('u1', ['a'])
    expect(readSeen('u1')).toEqual(['a'])
    expect(readSeen('u2')).toBeNull()
    store.set('pg.path.seen.v1', '不是 JSON')
    expect(readSeen('u1')).toBeNull()
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', undefined)
    expect(readSeen('u1')).toBeNull()
    expect(() => writeSeen('u1', ['a'])).not.toThrow()
  })
})

describe('unitOrdinalInChapter', () => {
  const units = [
    { id: 'a', chapterNo: 1 },
    { id: 'b', chapterNo: 1 },
    { id: 'c', chapterNo: 2 },
    { id: 'd', chapterNo: 2 },
  ]
  it('按本章里的位置从 1 数，不看库里的排序键', () => {
    expect(unitOrdinalInChapter(units, 'a')).toBe(1)
    expect(unitOrdinalInChapter(units, 'b')).toBe(2)
    expect(unitOrdinalInChapter(units, 'd')).toBe(2)
  })
  it('找不到时显示第 1 单元', () => {
    expect(unitOrdinalInChapter(units, 'x')).toBe(1)
    expect(unitOrdinalInChapter([], undefined)).toBe(1)
  })
})
