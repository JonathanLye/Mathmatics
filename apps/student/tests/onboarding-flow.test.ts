import { describe, expect, it } from 'vitest'

import { planAfterLogin, resolveAfterLogin, WELCOME_ROUTE } from '@/auth/afterLogin'
import { friendlyLoginError } from '@/auth/loginForm'
import { introStepFrom, shouldSwipe } from '@/components/onboarding/introLogic'
import { INTRO_SCENES, TOUR_STEPS, WELCOME_COPY } from '@/copy/onboarding'
import { nextWelcomeStep, previousWelcomeStep } from '@/onboarding/welcomeSteps'
import type { MeView } from '@/types/attempt'

// 首次登录一路接得上：设密码 → 年龄 → 同意 → 欢迎页 → 首页；中途停在任何一步再登录，都回到该去的那一步。

const ME: MeView = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  anonCode: 'S-TEST',
  displayName: null,
  classes: [],
  consentRequired: true,
  ageBand: null,
  needsPassword: true,
  features: {},
}

const needWelcome = async () => true
const noWelcome = async () => false

describe('登录后的去向（含欢迎页）', () => {
  it('第一次登录：先设密码，不问欢迎页', async () => {
    let asked = false
    const plan = await resolveAfterLogin(ME, false, async () => ((asked = true), true))
    expect(plan).toEqual({ url: '/pages/set-password/index', pending: '' })
    expect(asked).toBe(false)
  })

  it('设完密码、还没选年龄：去年龄页，原目标记成同意页', async () => {
    expect(await resolveAfterLogin({ ...ME, needsPassword: false }, false, needWelcome)).toEqual({ url: '/pages/age/index', pending: '/pages/consent/index' })
  })

  it('选完年龄、还没签同意书：去同意页', async () => {
    expect(await resolveAfterLogin({ ...ME, needsPassword: false, ageBand: 'ge18' }, false, needWelcome)).toEqual({ url: '/pages/consent/index', pending: '' })
  })

  it('签完同意书、欢迎页没走完：去欢迎页', async () => {
    expect(await resolveAfterLogin({ ...ME, needsPassword: false, ageBand: 'ge18', consentRequired: false }, true, needWelcome)).toEqual({ url: WELCOME_ROUTE, pending: '' })
  })

  it('全走完：直接首页', async () => {
    expect(await resolveAfterLogin({ ...ME, needsPassword: false, ageBand: '14to17', consentRequired: false }, true, noWelcome)).toEqual({ url: '/pages/home/index', pending: '' })
  })

  it('未满 14 岁：始终停在年龄页（那里有退出登录），不会被送去欢迎页', async () => {
    const plan = await resolveAfterLogin({ ...ME, needsPassword: false, ageBand: 'lt14', consentRequired: false }, true, needWelcome)
    expect(plan.url).toBe('/pages/age/index')
  })

  it('不改 planAfterLogin 的既有返回值（它不认识欢迎页）', () => {
    expect(planAfterLogin({ ...ME, needsPassword: false, ageBand: 'ge18', consentRequired: false }, true)).toEqual({ url: '/pages/home/index', pending: '' })
  })
})

describe('登录错误文案', () => {
  it('服务端给了中文原因就直接用，英文或技术性的话换成友好的一句', () => {
    expect(friendlyLoginError('学号或密码不对', '兜底')).toBe('学号或密码不对')
    expect(friendlyLoginError('Failed to fetch', '兜底')).toBe('兜底')
    expect(friendlyLoginError('', '兜底')).toBe('兜底')
    expect(friendlyLoginError(null, '兜底')).toBe('兜底')
  })
})

describe('开场动画翻页与滑动', () => {
  it('在最后一幕往后翻是结束；第一幕往前翻留在原地', () => {
    const total = INTRO_SCENES.length
    expect(total).toBe(4)
    expect(introStepFrom(0, 1, total)).toEqual({ index: 1, finish: false })
    expect(introStepFrom(total - 1, 1, total)).toEqual({ index: total - 1, finish: true })
    expect(introStepFrom(0, -1, total)).toEqual({ index: 0, finish: false })
    expect(introStepFrom(2, -1, total)).toEqual({ index: 1, finish: false })
  })

  it('左滑下一幕，右滑上一幕；太短或竖着滑不算', () => {
    expect(shouldSwipe(-80, 5)).toBe('next')
    expect(shouldSwipe(80, -5)).toBe('prev')
    expect(shouldSwipe(-20, 0)).toBeNull()
    expect(shouldSwipe(-80, 90)).toBeNull()
  })

  it('每一幕都有标题和说明，且按“什么 → 六步 → 问 → 每天”的顺序', () => {
    expect(INTRO_SCENES.map((s) => s.id)).toEqual(['what', 'path', 'ask', 'daily'])
    for (const scene of INTRO_SCENES) {
      expect(scene.title.length).toBeGreaterThan(0)
      expect(scene.body.length).toBeGreaterThan(0)
    }
    expect(INTRO_SCENES[2].body).toContain('不会把答案写给你')
  })
})

describe('欢迎页', () => {
  it('三屏顺序：昵称 → 目标 → 默认输入；最后一屏之后保存', () => {
    expect(nextWelcomeStep('name')).toBe('goal')
    expect(nextWelcomeStep('goal')).toBe('input')
    expect(nextWelcomeStep('input')).toBeNull()
    expect(previousWelcomeStep('input')).toBe('goal')
    expect(previousWelcomeStep('name')).toBeNull()
  })

  it('庆祝标题带昵称', () => {
    expect(WELCOME_COPY.readyTitle('小明')).toContain('小明')
  })
})

describe('首页导览', () => {
  it('三步：路径 → 今日目标 → 我的；按 data-testid 找目标，不依赖首页具体结构', () => {
    expect(TOUR_STEPS).toHaveLength(3)
    for (const step of TOUR_STEPS) {
      expect(step.target).toContain('data-testid')
      expect(step.title.length).toBeGreaterThan(0)
    }
    expect(TOUR_STEPS[2].target).toBe('[data-testid="tab-me"]')
  })
})
