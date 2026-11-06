/**
 * 登录表单的纯逻辑（页面只负责渲染和调用）：两种模式
 * - password：学号 + 密码（默认；已设密码的学生每天用这个）；
 * - invite：邀请码 + 学号（第一次来 / 被老师重置密码之后）。
 * 邀请码出现在链接参数里，或离线演示（mock）模式（没有密码这回事）时，默认进邀请码模式。
 */
import type { LoginCredentials } from '@/api/client'

export type LoginMode = 'password' | 'invite'

export const FORGOT_PASSWORD_HELP = '请找老师在名单里重置密码；重置后用邀请码重新激活，再设一个新密码。'

export function initialLoginMode(options: { mock: boolean; inviteFromLink: string }): LoginMode {
  return options.mock || options.inviteFromLink !== '' ? 'invite' : 'password'
}

/** 服务端给了中文原因就直接用；拿到的是英文或技术性的话（断网、超时）就换成学生看得懂的一句。 */
export function friendlyLoginError(raw: string | null | undefined, fallback: string): string {
  const text = String(raw ?? '').trim()
  return /[一-鿿]/.test(text) ? text : fallback
}

export interface LoginFields {
  invite: string
  studentNo: string
  password: string
}

export type BuiltCredentials = { ok: true; credentials: LoginCredentials } | { ok: false; error: string }

export function buildLoginCredentials(mode: LoginMode, fields: LoginFields): BuiltCredentials {
  const studentNo = fields.studentNo.trim()
  if (mode === 'invite') {
    const invite = fields.invite.trim()
    if (invite.length !== 6) return { ok: false, error: '请输入 6 位邀请码（可问老师要）' }
    if (!studentNo) return { ok: false, error: '请输入学号' }
    return { ok: true, credentials: { inviteCode: invite, studentNo } }
  }
  if (!studentNo) return { ok: false, error: '请输入学号' }
  if (!fields.password) return { ok: false, error: '请输入密码' }
  return { ok: true, credentials: { studentNo, password: fields.password } }
}
