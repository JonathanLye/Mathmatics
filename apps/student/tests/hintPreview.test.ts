/**
 * 提示预览卡文案纯逻辑单测（issue #16；PR #91 审计 2）。
 * 重点：HintPreview 字段全可选时不能抛错/不能出现 undefined；7 种 reason 的文案；
 * blocked preview 没有 level/cost 时只渲染原因行。
 */
import { describe, expect, it } from 'vitest'
import type { BudgetView, HintPreview } from '@/types/attempt'
import {
  PREVIEW_ALLOWED_GUIDANCE,
  formatRevealAmount,
  previewAllowed,
  previewCanRetry,
  previewCostLine,
  previewDwellSeconds,
  previewReasonText,
  previewSoftLandingItems,
  previewTitle,
  softLandingAvailable,
  softLandingLabel,
} from '@/components/hintPreviewCopy'

const budget: BudgetView = { revealUsed: 0.5, revealMax: 2, keysOwn: 1, keysTotal: 4 }

describe('formatRevealAmount：缺字段不崩（blocked preview 没有 cost）', () => {
  it('正常数字按 BudgetBar 口径显示', () => {
    expect(formatRevealAmount(0.5)).toBe('0.5')
    expect(formatRevealAmount(1)).toBe('1')
    expect(formatRevealAmount(0)).toBe('0')
  })

  it('undefined / null / NaN 显示破折号而不是抛 TypeError', () => {
    expect(formatRevealAmount(undefined)).toBe('—')
    expect(formatRevealAmount(null)).toBe('—')
    expect(formatRevealAmount(Number.NaN)).toBe('—')
    expect(formatRevealAmount(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('previewTitle / previewCostLine：level 缺失只渲染原因行', () => {
  it('有 level 才有标题', () => {
    expect(previewTitle({ level: 'H2' })).toBe('下一条：方向提示（H2）')
    expect(previewTitle({ level: 'H3' })).toContain('局部一步')
    expect(previewTitle({ level: 'H4' })).toContain('示范一行')
    expect(previewTitle({})).toBe('')
  })

  it('有 cost 才显示成本行，且「剩余」= 上限 − 已用 − 本条', () => {
    expect(previewCostLine({ cost: 0.5 }, budget)).toBe('这条会计入透露 0.5（你已用 0.5 / 2），剩余 1。')
    expect(previewCostLine({ cost: 0.5 })).toBe('这条会计入透露 0.5。')
    expect(previewCostLine({ cost: 1 }, { ...budget, revealUsed: 1.5 })).toContain('剩余 0')
  })

  it('blocked preview（没有 level/cost）标题与成本行为空，只留原因行', () => {
    const blocked: HintPreview = { allowed: false, reason: 'need_attempt', waitSec: 20 }
    expect(previewTitle(blocked)).toBe('')
    expect(previewCostLine(blocked, budget)).toBe('')
    expect(previewReasonText(blocked)).toContain('先自己写完下一行')
  })
})

describe('previewAllowed / previewCanRetry：只透传服务端 allowed', () => {
  it('allowed 缺省视为不可领取', () => {
    expect(previewAllowed({})).toBe(false)
    expect(previewAllowed({ allowed: false })).toBe(false)
    expect(previewAllowed({ allowed: true })).toBe(true)
  })

  it('可重试的 reason：need_attempt / dwell / rapid_lock / null；不可重试：test_mode / complete / layer', () => {
    expect(previewCanRetry({ allowed: false, reason: 'need_attempt' })).toBe(true)
    expect(previewCanRetry({ allowed: false, reason: 'dwell', waitSec: 5 })).toBe(true)
    expect(previewCanRetry({ allowed: false, reason: 'rapid_lock', waitSec: 42 })).toBe(true)
    expect(previewCanRetry({ allowed: false, reason: null })).toBe(true)
    expect(previewCanRetry({ allowed: false, reason: 'test_mode' })).toBe(false)
    expect(previewCanRetry({ allowed: false, reason: 'complete' })).toBe(false)
    expect(previewCanRetry({ allowed: false, reason: 'layer' })).toBe(false)
    expect(previewCanRetry({ allowed: true })).toBe(false)
  })
})

describe('previewReasonText：7 种 reason 的渲染（至少 need_attempt/dwell/budget/test_mode）', () => {
  it('need_attempt', () => {
    expect(previewReasonText({ allowed: false, reason: 'need_attempt' })).toBe('先自己写完下一行，再来领取。')
  })

  it('dwell：秒数用页面倒计时；归零后提示可重新获取', () => {
    expect(previewReasonText({ allowed: false, reason: 'dwell', waitSec: 20 }, 5)).toBe('还要再停留 5 秒，才能领取。')
    expect(previewReasonText({ allowed: false, reason: 'dwell', waitSec: 20 }, 0)).toBe('停留时间已到，可以重新获取预览。')
  })

  it('rapid_lock：秒数用服务端 waitSec（不再写死 60 秒）', () => {
    expect(previewReasonText({ allowed: false, reason: 'rapid_lock', waitSec: 42 })).toContain('42 秒')
    expect(previewReasonText({ allowed: false, reason: 'rapid_lock' })).not.toContain('60')
  })

  it('budget / test_mode / layer / complete', () => {
    expect(previewReasonText({ allowed: false, reason: 'budget' })).toBe('本题透露额度已用完，不再升级提示。')
    expect(previewReasonText({ allowed: false, reason: 'test_mode' })).toBe('测验模式不提供提示。')
    expect(previewReasonText({ allowed: false, reason: 'layer' })).toBe('当前层还不能领取提示。')
    expect(previewReasonText({ allowed: false, reason: 'complete' })).toBe('本题已经完成。')
  })

  it('allowed=false 且 reason=null 时有默认文案；allowed=true 不显示原因', () => {
    expect(previewReasonText({ allowed: false })).toBe('现在还不能领取。')
    expect(previewReasonText({ allowed: true })).toBe('')
  })
})

describe('dwell 倒计时与可领取引导', () => {
  it('previewDwellSeconds 只从服务端 waitSec 取', () => {
    expect(previewDwellSeconds({ reason: 'dwell', waitSec: 20 })).toBe(20)
    expect(previewDwellSeconds({ reason: 'dwell' })).toBe(0)
    expect(previewDwellSeconds({ reason: 'need_attempt', waitSec: 20 })).toBeNull()
  })

  it('可领取引导不写死秒数（审计：revealAfter 是累计透露量，不是秒）', () => {
    expect(PREVIEW_ALLOWED_GUIDANCE).toContain('再写一行')
    expect(PREVIEW_ALLOWED_GUIDANCE).not.toContain('20')
  })
})

describe('softLanding：按钮文案与后端未实现项', () => {
  it('共享一份中文标签，未知 id 原串兜底', () => {
    expect(softLandingLabel('back_to_definition')).toBe('回到定义')
    expect(softLandingLabel('open_lesson')).toBe('看讲解')
    expect(softLandingLabel('park_and_next')).toBe('先做下一题')
    expect(softLandingLabel('unknown_action')).toBe('unknown_action')
  })

  it('flag_teacher（/flag-teacher 后端未实现）禁用', () => {
    expect(softLandingAvailable('flag_teacher')).toBe(false)
    expect(softLandingAvailable('back_to_definition')).toBe(true)
    const items = previewSoftLandingItems(['back_to_definition', 'flag_teacher', 'unknown_action'])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ id: 'back_to_definition', label: '回到定义', disabled: false })
    expect(items[1]).toMatchObject({ id: 'flag_teacher', label: '求助老师', disabled: true })
    expect(items[2]).toMatchObject({ id: 'unknown_action', label: 'unknown_action', disabled: false })
    expect(previewSoftLandingItems(undefined)).toEqual([])
  })
})
