import { describe, expect, it } from 'vitest'
import {
  consentChoices,
  consentSectionKind,
  feedbackBody,
  goalChoices,
  isSignableKey,
  nicknameError,
  passwordFormError,
  versionLabel,
} from '@/components/me/meLogic'
import { ACCOUNT_COPY, ME_COPY } from '@/copy'
import type { ConsentDoc } from '@/types/attempt'

const sections: ConsentDoc['sections'] = [
  { key: 'service', title: '服务', body: '', required: true },
  { key: 'crossBorderHosting', title: '托管', body: '', required: true },
  { key: 'monitoring', title: '监测', body: '', required: true },
  { key: 'crossBorderModel', title: '模型', body: '', required: false },
  { key: 'research', title: '教研', body: '', required: false },
  { key: 'guardianNotice', title: '监护人', body: '', required: false },
]

describe('昵称', () => {
  it('空白不行，其余交给服务端', () => {
    expect(nicknameError('   ')).toBe(ME_COPY.nameEmpty)
    expect(nicknameError(' 小明 ')).toBe('')
  })
})

describe('改密码表单', () => {
  it('按顺序提示第一处问题', () => {
    expect(passwordFormError({ current: '', next: 'a', confirm: 'a' })).toEqual({ field: 'current', message: ACCOUNT_COPY.needCurrent })
    expect(passwordFormError({ current: 'x', next: '', confirm: '' })).toEqual({ field: 'next', message: ACCOUNT_COPY.needNext })
    expect(passwordFormError({ current: 'x', next: 'abc', confirm: 'abd' })).toEqual({ field: 'confirm', message: ACCOUNT_COPY.mismatch })
  })

  it('都填好时没有错误', () => {
    expect(passwordFormError({ current: 'x', next: 'abcdefgh', confirm: 'abcdefgh' })).toEqual({ field: '', message: '' })
  })
})

describe('每日目标选项', () => {
  it('常用四档', () => {
    expect(goalChoices(3)).toEqual([1, 3, 5, 8])
    expect(goalChoices(null)).toEqual([1, 3, 5, 8])
  })

  it('账号里的值不在常用档时也显示，并且排好序', () => {
    expect(goalChoices(12)).toEqual([1, 3, 5, 8, 12])
    expect(goalChoices(2)).toEqual([1, 2, 3, 5, 8])
  })
})

describe('同意书', () => {
  it('已签过：完全按签署内容，五个键都在', () => {
    const items = { service: true, crossBorderHosting: true, monitoring: true, crossBorderModel: true, research: false }
    expect(consentChoices({ sections, signed: { version: 'v1', signedAt: '2026-11-01', items } })).toEqual(items)
  })

  it('没签过：必选算同意，可选算没同意', () => {
    expect(consentChoices({ sections, signed: null })).toEqual({
      service: true,
      crossBorderHosting: true,
      monitoring: true,
      crossBorderModel: false,
      research: false,
    })
  })

  it('监护人说明只读，不参与签署', () => {
    expect(isSignableKey('guardianNotice')).toBe(false)
    expect(consentSectionKind(sections[5])).toBe('readonly')
    expect(consentSectionKind(sections[0])).toBe('required')
    expect(consentSectionKind(sections[3])).toBe('optional')
  })
})

describe('反馈和版本', () => {
  it('反馈内容去掉首尾空白', () => {
    expect(feedbackBody('  有问题 \n')).toBe('有问题')
    expect(feedbackBody('   ')).toBe('')
  })

  it('版本号缺失时不编造', () => {
    expect(versionLabel('0.1.0')).toBe('0.1.0')
    expect(versionLabel(undefined)).toBe('—')
  })
})
