/**
 * 新手引导的纯逻辑：哪些提示看过了（settings.onboarding.seen.*）、现在该不该出、怎么合并写回。
 *
 * 服务端对 onboarding 是「整体替换」（PATCH 时 coalesce 整个 jsonb），所以每次写都必须带上完整的对象：
 * 我们不认识的键原样保留，只改 seen。这里的函数都不改入参，返回新对象。
 */

/** 所有“只出现一次”的提示。第二部分（做题页内的就地提示）只需要用这些名字，不用再改这里。 */
export const ONBOARDING_KEYS = [
  'welcome', // 欢迎页（昵称、每日目标、默认输入）
  'intro', // 4 幕开场动画
  'tour', // 首页 3 步导览
  'sandbox', // 登录前“先试一道”走完过
  'layer.L1',
  'layer.L2',
  'layer.L3',
  'layer.L4',
  'layer.L5',
  'layer.L6', // 第一次进入每一层
  'input.hand',
  'input.keyboard',
  'input.photo', // 第一次用手写 / 键盘 / 拍照
  'help.open', // 第一次打开求助
  'hint.costed', // 第一次用要花额度的提示
  'note.first', // 第一次看到批注
  'done.first', // 第一次完成
] as const

export type OnboardingKey = (typeof ONBOARDING_KEYS)[number]
export type SeenMap = Record<string, true>
export type OnboardingBlob = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读 onboarding.seen：只认值为 true 的键，坏数据当没看过。 */
export function readSeen(onboarding: unknown): SeenMap {
  const out: SeenMap = {}
  const seen = isRecord(onboarding) ? onboarding.seen : undefined
  if (!isRecord(seen)) return out
  for (const [key, value] of Object.entries(seen)) if (value === true) out[key] = true
  return out
}

export function unionSeen(...maps: SeenMap[]): SeenMap {
  const out: SeenMap = {}
  for (const map of maps) Object.assign(out, map)
  return out
}

/** 把一组键标成看过；onboarding 里 seen 以外的键保留。 */
export function withSeen(onboarding: unknown, keys: readonly string[]): OnboardingBlob {
  const base: OnboardingBlob = isRecord(onboarding) ? { ...onboarding } : {}
  const seen: Record<string, unknown> = isRecord(base.seen) ? { ...base.seen } : {}
  for (const key of keys) seen[key] = true
  base.seen = seen
  return base
}

/** 重看引导：清掉指定的键（默认清掉除 welcome 以外的全部：昵称和目标不用再填一遍）。 */
export function withoutSeen(onboarding: unknown, keys?: readonly string[]): OnboardingBlob {
  const base: OnboardingBlob = isRecord(onboarding) ? { ...onboarding } : {}
  const current = readSeen(base)
  const drop = keys ?? Object.keys(current).filter((key) => key !== 'welcome')
  const seen: Record<string, unknown> = isRecord(base.seen) ? { ...base.seen } : {}
  for (const key of drop) delete seen[key]
  base.seen = seen
  return base
}

export interface CanShowInput {
  key: string
  seen: SeenMap
  /** 设置已读到（读不到就什么都不出，不拿学生当新人反复弹）。 */
  ready: boolean
  /** 引导在当前环境启用（演示数据默认关）。 */
  active: boolean
  /** 测验模式：什么引导都不出。 */
  muted: boolean
}

export function canShow(input: CanShowInput): boolean {
  return input.ready && input.active && !input.muted && input.seen[input.key] !== true
}

/**
 * 要不要先走欢迎页。已经看过，或者昵称早就设好的老用户，都算走过（不去打扰已经在用的学生）。
 */
export function welcomeNeeded(input: { ready: boolean; active: boolean; muted: boolean; seen: SeenMap; nickname: string | null | undefined }): boolean {
  if (!input.ready || !input.active || input.muted) return false
  if (input.seen.welcome === true) return false
  return !(typeof input.nickname === 'string' && input.nickname.trim() !== '')
}

/** 本机缓存的键：同一台设备可能换人登录，按学生分开存。 */
export function localSeenKey(userId: string): string {
  return 'pg.onboarding.v1.' + userId
}

export function parseLocalSeen(raw: string | null | undefined): SeenMap {
  if (!raw) return {}
  try {
    return readSeen({ seen: JSON.parse(raw) })
  } catch {
    return {}
  }
}

/** 登录前（没有账号）的本机标记：这台设备看过开场动画吗。 */
export const DEVICE_INTRO_KEY = 'pg.intro.v1'

/** 登录前“先试一道”的沙盒页（pages/tour）做好之后改成 true，登录页的入口就会出现。 */
export const SANDBOX_READY = false
