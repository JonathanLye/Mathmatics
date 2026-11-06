/**
 * 学生端词表：内部术语不外露，页面上的层名和标签只从这里取。
 * L1–L6、透露量、独立度是内部口径；学生看到的是下面这些词。
 */
import type { LayerId } from '@/types/attempt'

export const LAYER_NAMES: Readonly<Record<LayerId, string>> = {
  L1: '回忆定义',
  L2: '搭骨架',
  L3: '写证明',
  L4: '自检',
  L5: '换题试试',
  L6: '总结',
}

/** 层间过场：刚做完这一层时说什么。 */
export const LAYER_DONE: Readonly<Record<LayerId, string>> = {
  L1: '定义的成分都写到了。',
  L2: '证明的骨架搭好了。',
  L3: '关键步骤都写到了。',
  L4: '自检的问题都回答了。',
  L5: '换的这道题也做完了。',
  L6: '总结写好了。',
}

/** 层间过场：下一层一句话说明。 */
export const LAYER_INTRO: Readonly<Record<LayerId, string>> = {
  L1: '先把要用的定义写出来。',
  L2: '先搭开头和结尾，中间留空，不急着写构造。',
  L3: '一次写一行：这一行写什么，依据是什么。顺序你自己定。',
  L4: '用几个问题检验一下：你写的每一步都说得清吗？',
  L5: '换一道同类题，看刚才的骨架能不能用上。',
  L6: '用几句话把这道题讲给自己听，它会进你的证明本。',
}

export const LAYER_STATUS_TEXT: Readonly<Record<string, string>> = {
  locked: '未解锁',
  active: '进行中',
  done: '已完成',
  skipped: '已跳过',
  disabled: '不启用',
}

export function layerName(layer: LayerId | string | null | undefined): string {
  return layer ? (LAYER_NAMES[layer as LayerId] ?? '') : ''
}

/** 'L3' → 3；不是层编号时返回 0。 */
export function layerNumber(layer: LayerId | string | null | undefined): number {
  const match = /^L([1-6])$/.exec(String(layer ?? ''))
  return match ? Number(match[1]) : 0
}

/** “第 3 层 · 写证明”（首页卡片副标题）。 */
export function layerLabel(layer: LayerId | string | null | undefined): string {
  const n = layerNumber(layer)
  return n ? '第 ' + n + ' 层 · ' + layerName(layer) : ''
}

export const COPY = {
  hintBudget: '提示额度',
  /** 完成页的诚实说明：系统没有校验逻辑顺序，不能让学生以为这是判卷结果。 */
  honestNote: '系统核对关键步骤是否齐全，最终以老师讲评为准',
  /** mathlib 对照折叠在这个标题下面。 */
  extensionFold: '延伸',
  /** 没有昵称时的称呼；不显示匿名码。 */
  studentFallbackName: '同学',
  demoBadge: '演示数据',
} as const

/** 独立度的学生说法：“4 步里 3 步靠自己”。 */
export function independenceCopy(keysOwn: number | null | undefined, keysTotal: number | null | undefined): string {
  const total = Number(keysTotal)
  const own = Number(keysOwn)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(own)) return ''
  return total + ' 步里 ' + Math.max(0, Math.min(own, total)) + ' 步靠自己'
}

/** 称呼：只用昵称，匿名码（S-XXXX）一律不显示。 */
export function studentName(displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim()
  return name && !/^S-[0-9A-Z]+$/.test(name) ? name : COPY.studentFallbackName
}

/**
 * 批注署名：服务端和 mock 的 who 可能带内部层级（“H2 · 透露 0.5”“H1 · 追问”），翻译成学生的话。
 * 不认识的署名（助教、批注、老师……）原样显示。
 */
export function noteWhoLabel(who: string | null | undefined): string {
  const value = String(who ?? '')
  const reveal = /^H\d\s*·\s*透露\s*([\d.]+)$/.exec(value)
  if (reveal) return '提示 · 用掉 ' + reveal[1] + ' 额度'
  const tagged = /^H\d\s*·\s*(.+)$/.exec(value)
  if (tagged) return tagged[1]
  if (/^H\d$/.test(value)) return '提示'
  return value
}

/** 同意书版本号的显示形式：去掉内部阶段前缀（p0-v1 → v1）。提交给服务端的仍是原值。 */
export function consentVersionLabel(version: string | null | undefined): string {
  return String(version ?? '').replace(/^p\d+-/i, '')
}

export * from './pages'
