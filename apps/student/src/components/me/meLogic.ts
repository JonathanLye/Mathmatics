/**
 * “我的”和子页面的校验、选项（无 DOM）。
 * 这里只挡明显的空输入，策略以服务端为准（返回的文案原样显示）。
 */
import { ACCOUNT_COPY, ME_COPY } from '@/copy'
import type { ConsentChoices, ConsentDoc, ConsentKey, ConsentSection } from '@/types/attempt'

export const NICKNAME_MAX = 16

/** 昵称：trim 后 1 到 16 个字。返回错误文案，没问题返回空串。 */
export function nicknameError(raw: string): string {
  return raw.trim().length === 0 ? ME_COPY.nameEmpty : ''
}

export interface PasswordForm {
  current: string
  next: string
  confirm: string
}

export type PasswordField = keyof PasswordForm | ''

/** 改密码的前端校验：先挡空的和两次不一样的，长度、弱密码由服务端判断。 */
export function passwordFormError(form: PasswordForm): { field: PasswordField; message: string } {
  if (!form.current) return { field: 'current', message: ACCOUNT_COPY.needCurrent }
  if (!form.next) return { field: 'next', message: ACCOUNT_COPY.needNext }
  if (form.next !== form.confirm) return { field: 'confirm', message: ACCOUNT_COPY.mismatch }
  return { field: '', message: '' }
}

const BASE_GOALS: readonly number[] = [1, 3, 5, 8]

/** 每日目标的选项：常用四档；账号里存了别的值（老师或别的版本改的）也要能显示出来。 */
export function goalChoices(current: number | null | undefined): number[] {
  const value = typeof current === 'number' && Number.isInteger(current) && current > 0 ? current : null
  if (value === null || BASE_GOALS.includes(value)) return [...BASE_GOALS]
  return [...BASE_GOALS, value].sort((a, b) => a - b)
}

const CONSENT_KEYS: readonly ConsentKey[] = ['service', 'crossBorderHosting', 'crossBorderModel', 'monitoring', 'research']

export function isSignableKey(key: string): key is ConsentKey {
  return (CONSENT_KEYS as readonly string[]).includes(key)
}

/** 当前的选择：以已签的版本为准；没签过时必选项算同意，可选项算没同意。 */
export function consentChoices(doc: Pick<ConsentDoc, 'sections' | 'signed'>): ConsentChoices {
  const choices = {} as ConsentChoices
  for (const key of CONSENT_KEYS) {
    const section = doc.sections.find((entry) => entry.key === key)
    choices[key] = doc.signed?.items?.[key] ?? Boolean(section?.required)
  }
  return choices
}

export type ConsentSectionKind = 'required' | 'optional' | 'readonly'

/** 必选项不能关，只读说明（监护人告知）不参与签署，其余才给开关。 */
export function consentSectionKind(section: Pick<ConsentSection, 'key' | 'required'>): ConsentSectionKind {
  if (!isSignableKey(section.key)) return 'readonly'
  return section.required ? 'required' : 'optional'
}

/** 反馈内容：trim 后不能空，超过接口上限就截断提示交给输入框的 maxlength。 */
export const FEEDBACK_MAX = 2000

export function feedbackBody(raw: string): string {
  return raw.trim()
}

/** manifest.json 的版本号，显示给学生看。 */
export function versionLabel(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '—'
}
