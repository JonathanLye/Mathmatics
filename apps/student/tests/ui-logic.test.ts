import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buttonClasses,
  buttonDisabled,
  canDismiss,
  clampProgress,
  coachmarkBubble,
  coachmarkNext,
  isFatalVueError,
  mascotMotionClasses,
  nextSegmentIndex,
  retryRoute,
  segmentFromLayerStatus,
  segmentsProgress,
  shouldShine,
  spotlightRect,
  switchNextValue,
  TAB_ITEMS,
  tabTarget,
} from '@/components/ui/uiLogic'
import { TOAST_DEFAULT_MS, useToast } from '@/components/ui/useToast'

describe('PgButton', () => {
  it('默认 primary + md；块级、堆叠、加载各有类名', () => {
    expect(buttonClasses({})).toEqual(['pg-button--primary', 'pg-button--md'])
    expect(buttonClasses({ variant: 'sea', size: 'lg', block: true, stack: true, loading: true })).toEqual([
      'pg-button--sea',
      'pg-button--lg',
      'pg-button--block',
      'pg-button--stack',
      'pg-button--loading',
    ])
  })

  it('加载中不能再点，防止重复提交', () => {
    expect(buttonDisabled({ loading: true })).toBe(true)
    expect(buttonDisabled({ disabled: true })).toBe(true)
    expect(buttonDisabled({})).toBe(false)
  })
})

describe('PgMascot', () => {
  it('动作可以是单个或多个，默认没有（教师镜像保持静止）', () => {
    expect(mascotMotionClasses(null)).toEqual([])
    expect(mascotMotionClasses(undefined)).toEqual([])
    expect(mascotMotionClasses('hop')).toEqual(['pg-mascot--hop'])
    expect(mascotMotionClasses(['breathe', 'blink'])).toEqual(['pg-mascot--breathe', 'pg-mascot--blink'])
  })
})

describe('PgProgress', () => {
  it('层状态映射成段状态', () => {
    expect(segmentFromLayerStatus('done')).toBe('done')
    expect(segmentFromLayerStatus('active')).toBe('active')
    expect(segmentFromLayerStatus('skipped')).toBe('skipped')
    expect(segmentFromLayerStatus('disabled')).toBe('off')
    expect(segmentFromLayerStatus('locked')).toBe('todo')
  })

  it('连续进度夹到 0–1，坏值当 0', () => {
    expect(clampProgress(0.4)).toBe(0.4)
    expect(clampProgress(2)).toBe(1)
    expect(clampProgress(-1)).toBe(0)
    expect(clampProgress(Number.NaN)).toBe(0)
    expect(clampProgress(null)).toBe(0)
  })

  it('只有前进才闪光：初次渲染和回退都不闪', () => {
    expect(shouldShine(null, 1)).toBe(false)
    expect(shouldShine(1, 1)).toBe(false)
    expect(shouldShine(2, 1)).toBe(false)
    expect(shouldShine(1, 2)).toBe(true)
  })

  it('分段完成量：完成和跳过算 1，进行中算一半', () => {
    expect(segmentsProgress(['done', 'skipped', 'active', 'todo', 'off'])).toBe(2.5)
  })
})

describe('PgSegmented', () => {
  it('方向键循环移动', () => {
    expect(nextSegmentIndex(0, 1, [false, false, false])).toBe(1)
    expect(nextSegmentIndex(2, 1, [false, false, false])).toBe(0)
    expect(nextSegmentIndex(0, -1, [false, false, false])).toBe(2)
  })

  it('跳过禁用项；全禁用时不动', () => {
    expect(nextSegmentIndex(0, 1, [false, true, false])).toBe(2)
    expect(nextSegmentIndex(2, -1, [false, true, false])).toBe(0)
    expect(nextSegmentIndex(0, 1, [true, true, true])).toBe(0)
    expect(nextSegmentIndex(0, 1, [])).toBe(0)
  })
})

describe('PgSwitch / PgSheet', () => {
  it('禁用的开关不翻转', () => {
    expect(switchNextValue(true, false)).toBe(false)
    expect(switchNextValue(false, false)).toBe(true)
    expect(switchNextValue(true, true)).toBe(true)
  })

  it('persistent 的弹层遮罩和 Esc 都关不掉', () => {
    expect(canDismiss(true)).toBe(false)
    expect(canDismiss(false)).toBe(true)
    expect(canDismiss(undefined)).toBe(true)
  })
})

describe('PgTabBar', () => {
  it('五个标签，路由符合规格', () => {
    expect(TAB_ITEMS.map((t) => [t.label, t.url])).toEqual([
      ['路径', '/pages/home/index'],
      ['练习', '/pages/practice-zone/index'],
      ['错题', '/pages/mistakes/index'],
      ['证明本', '/pages/proofbook/index'],
      ['我的', '/pages/me/index'],
    ])
  })

  it('点已激活的标签不跳转', () => {
    expect(tabTarget('path', 'path')).toBeNull()
    expect(tabTarget('path', 'me')).toBe('/pages/me/index')
    expect(tabTarget(null, 'path')).toBe('/pages/home/index')
  })
})

describe('PgCoachmark', () => {
  const viewport = { width: 390, height: 844 }

  it('聚光灯外扩 padding，并夹在视口内', () => {
    expect(spotlightRect({ top: 100, left: 100, width: 50, height: 20 }, viewport)).toEqual({ top: 92, left: 92, width: 66, height: 36 })
    expect(spotlightRect({ top: 0, left: 0, width: 390, height: 844 }, viewport)).toEqual({ top: 0, left: 0, width: 390, height: 844 })
  })

  it('气泡优先放下方；放不下放上方；都放不下贴底', () => {
    expect(coachmarkBubble({ top: 100, left: 20, width: 100, height: 50 }, viewport, 180).side).toBe('below')
    const above = coachmarkBubble({ top: 700, left: 20, width: 100, height: 50 }, viewport, 180)
    expect(above.side).toBe('above')
    expect(above.top).toBe(700 - 12 - 180)
    const tall = coachmarkBubble({ top: 0, left: 0, width: 390, height: 844 }, viewport, 180)
    expect(tall.top).toBe(844 - 16 - 180)
  })

  it('气泡不超出屏幕左右，宽屏不超过 360', () => {
    const left = coachmarkBubble({ top: 100, left: 0, width: 20, height: 20 }, viewport, 180)
    expect(left.left).toBe(16)
    expect(left.width).toBe(358)
    const wide = coachmarkBubble({ top: 100, left: 1000, width: 280, height: 20 }, { width: 1280, height: 800 }, 180)
    expect(wide.width).toBe(360)
    expect(wide.left + wide.width).toBeLessThanOrEqual(1280 - 16)
  })

  it('最后一步之后结束', () => {
    expect(coachmarkNext(0, 2)).toBe(1)
    expect(coachmarkNext(1, 2)).toBeNull()
  })
})

describe('错误边界', () => {
  it('只有 setup / render 出错才整页换成错误页', () => {
    expect(isFatalVueError('render function')).toBe(true)
    expect(isFatalVueError('setup function')).toBe(true)
    expect(isFatalVueError('https://vuejs.org/error-reference/#runtime-1')).toBe(true)
    expect(isFatalVueError('https://vuejs.org/error-reference/#runtime-0')).toBe(true)
    expect(isFatalVueError('native event handler')).toBe(false)
    expect(isFatalVueError('https://vuejs.org/error-reference/#runtime-5')).toBe(false)
    expect(isFatalVueError(null)).toBe(false)
  })

  it('“再试一次”只回站内页面，不回兜底页自己', () => {
    expect(retryRoute('/pages/practice/index?mock=l1-active')).toBe('/pages/practice/index?mock=l1-active')
    expect(retryRoute('/pages/not-found/index?kind=error')).toBeNull()
    expect(retryRoute('https://evil.example/pages/home/index')).toBeNull()
    expect(retryRoute('//evil.example')).toBeNull()
    expect(retryRoute(null)).toBeNull()
  })
})

describe('useToast', () => {
  afterEach(() => {
    useToast().hide()
    vi.useRealTimers()
  })

  it('显示后到时自动消失；新消息覆盖旧消息并重新计时', () => {
    vi.useFakeTimers()
    const toast = useToast()
    toast.show('第一条')
    expect(toast.state.message).toBe('第一条')
    vi.advanceTimersByTime(TOAST_DEFAULT_MS - 100)
    toast.show('第二条', { tone: 'warn' })
    expect(toast.state.message).toBe('第二条')
    expect(toast.state.tone).toBe('warn')
    vi.advanceTimersByTime(TOAST_DEFAULT_MS - 100)
    expect(toast.state.message).toBe('第二条')
    vi.advanceTimersByTime(100)
    expect(toast.state.message).toBe('')
  })
})
