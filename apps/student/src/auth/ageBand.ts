/**
 * 年龄分档纯逻辑（issue #145 / 13 §4；契约：#131 的 Me.ageBand + POST /auth/student/age-band）。
 *
 * 原则：前端只做「展示 + 路由引导 + 错误文案映射」，**不做未成年人合规判定**：
 * - 是否允许使用、能不能改档，以服务端返回/错误码为准（409 AGE_BAND_LOCKED、403 AGE_RESTRICTED）；
 * - 字段缺失（旧服务端/部分测试桩）不拦截，只有契约明确的 null（尚未选择）才引导去选择页。
 */
import type { AgeBand } from '@/types/attempt'

/** 分档选择页的三档（顺序：≥18 / 14–17 / <14，按 13 §4）。 */
export const AGE_BAND_OPTIONS: Array<{ value: AgeBand; label: string; hint: string }> = [
  { value: 'ge18', label: '18 岁及以上', hint: '按成年人规则处理。' },
  { value: '14to17', label: '14–17 岁', hint: '可以正常使用；同意书会附加「建议告知监护人」。' },
  { value: 'lt14', label: '未满 14 岁', hint: '本期暂不开通。' },
]

/** < 14 的风险说明（13 §4：需要监护人同意的流程本期不做）。 */
export const AGE_BAND_LT14_RISK =
  '未满 14 岁暂不开通：需要监护人同意的流程本期还没做。如确有需要，请联系老师。'

export const AGE_BAND_REQUIRED_MESSAGE = '请先选择年龄分段，再开始练习。'
export const AGE_RESTRICTED_MESSAGE = '未满 14 岁暂不开通本练习；如有疑问请联系老师。'
export const AGE_BAND_LOCKED_MESSAGE = '年龄已记录，如需修改请联系老师。'

/** 路由守卫结论：ok 放行；need-age 去选择页；blocked 去选择页看「暂不开通」；unknown 不拦截。 */
export type AgeGateDecision = 'ok' | 'need-age' | 'blocked' | 'unknown'

/** 解析服务端/URL 的 ageBand：合法档位原样返回，显式 null 返回 null，其余（缺失/非法）返回 undefined。 */
export function parseAgeBand(value: unknown): AgeBand | null | undefined {
  if (value === null) return null
  if (value === 'lt14' || value === '14to17' || value === 'ge18') return value
  return undefined
}

export function ageBandLabel(value: unknown): string {
  const band = parseAgeBand(value)
  if (band === null) return '未选择'
  if (band === undefined) return ''
  return AGE_BAND_OPTIONS.find((option) => option.value === band)?.label ?? ''
}

/**
 * 路由守卫：只有契约明确的 null 才要求去选择页；lt14 → blocked；
 * 字段缺失/非法值 → unknown（不拦截，交给服务端实际错误，避免旧服务端/测试桩被误伤）。
 */
export function ageGateFor(value: unknown): AgeGateDecision {
  const band = parseAgeBand(value)
  if (band === null) return 'need-age'
  if (band === undefined) return 'unknown'
  return band === 'lt14' ? 'blocked' : 'ok'
}

/** 守卫是否放行当前页面（ok / unknown 都放行）。 */
export function ageGateAllows(value: unknown): boolean {
  const decision = ageGateFor(value)
  return decision === 'ok' || decision === 'unknown'
}

/** 服务端错误码 → 学生可见文案（不伪造成功；只做展示映射）。 */
export function ageBandErrorMessage(code: unknown): string | null {
  switch (code) {
    case 'AGE_BAND_REQUIRED':
      return AGE_BAND_REQUIRED_MESSAGE
    case 'AGE_RESTRICTED':
      return AGE_RESTRICTED_MESSAGE
    case 'AGE_BAND_LOCKED':
      return AGE_BAND_LOCKED_MESSAGE
    default:
      return null
  }
}

/** 从 query string（可带或不带 ?）读取 mock/演示用的 ageBand 覆盖值。 */
export function ageBandFromQuery(search: string): AgeBand | null | undefined {
  const query = String(search ?? '').replace(/^\?/, '')
  const raw = new URLSearchParams(query).get('ageBand')
  if (raw === null) return undefined
  if (raw === 'null') return null
  return parseAgeBand(raw)
}

/** 当前 H5 hash 路由（如 /pages/practice/index?mock=l3-active），供守卫记录「原目标」。 */
export function currentHashRoute(locationLike?: { hash?: string }): string {
  const hash =
    locationLike?.hash ?? (typeof window !== 'undefined' ? (window.location?.hash ?? '') : '')
  if (!hash) return ''
  const index = hash.indexOf('#')
  return hash.slice(index === -1 ? 0 : index + 1)
}

/** 只允许回到应用内页面，避免 ?next= 被拿来做开放重定向。 */
export function safeNextRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (!value) return null
  try {
    value = decodeURIComponent(value)
  } catch {
    /* 保留原串继续校验 */
  }
  const hashIndex = value.indexOf('#/')
  if (hashIndex >= 0) value = value.slice(hashIndex + 1)
  if (!value.startsWith('/pages/')) return null
  if (value.includes('//')) return null
  return value
}

/** guardianNotice 是只读说明段：不渲染开关、不参与 signed choices（#131）。 */
export function isReadOnlyConsentSection(key: unknown): boolean {
  return key === 'guardianNotice'
}
