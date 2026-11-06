/**
 * 证明行列表的纯逻辑（issue #12；PR #90 复审第 5 条要求抽成纯函数进 CI 单测）。
 *
 * 只做渲染分组，不做任何判定：
 * - 批注按 note.lineId 精确挂载，保持服务端下发顺序；
 * - lineId 为空或对应行已不在 state 里的批注 → 列表末尾（与 components/README.md 一致）；
 * - 行号取 max(n)+1：契约有软删 deleteLine，行号会不连续，不能用数组长度 + 1。
 *
 * 为什么单独成文件：vitest（node 环境）可以直接测，不依赖 DOM / Vue 运行时；
 * .github/workflows/ci.yml 的 workspace job 会跑 pnpm test，这些用例自动进 CI。
 *
 * #151（#141 P2-1 A 侧）在这里补 4 个纯函数：
 * - parseNote：把 /help 的 res.note（openapi Note）做一次运行时收敛，缺字段/坏形状不渲染；
 * - mergeNotes：state.notes（刷新/重连后由服务端下发）与本次会话 check_line 返回的 note 按 noteId 去重合并；
 * - filterDismissedNotes：学生手动关闭的批注暂时不显示（只影响本次页面，不回写服务端）；
 * - formatNoteTime：批注时间显示（MM-DD HH:mm，可按 IANA 时区单测）。
 */
import type { HintLevel, Note, NoteKind, ProofLine } from '@/types/attempt'

/** note.lineId → 该行下方的批注（保持服务端下发顺序；lineId 为空的批注不进 map）。 */
export function groupNotesByLine(notes: readonly Note[]): Map<string, Note[]> {
  const map = new Map<string, Note[]>()
  for (const note of notes) {
    if (!note.lineId) continue
    const list = map.get(note.lineId)
    if (list) list.push(note)
    else map.set(note.lineId, [note])
  }
  return map
}

/** 找不到对应行（lineId 为空或该行已不在 state 里）的批注：按契约挂在列表末尾。 */
export function selectTailNotes(lines: readonly ProofLine[], notes: readonly Note[]): Note[] {
  const lineIds = new Set(lines.map((line) => line.lineId))
  return notes.filter((note) => !note.lineId || !lineIds.has(note.lineId))
}

/** 同一行下方的批注（没有则空数组，模板可直接 v-for）。 */
export function notesForLine(notesByLine: ReadonlyMap<string, Note[]>, lineId: string): Note[] {
  return notesByLine.get(lineId) ?? []
}

/** 下一个行号 = max(已渲染行的 n) + 1；没有行时是 1（服务端 n 从 1 开始）。 */
export function nextLineNoOf(lines: readonly ProofLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.n), 0) + 1
}

// ---------------------------------------------------------------------------
// #151 / #141 P2-1：check_line 行批注的前端处理（纯函数，便于单测）
// ---------------------------------------------------------------------------

const NOTE_KINDS: readonly NoteKind[] = [
  'annotation',
  'hint',
  'concept',
  'system',
  'refusal',
  'lesson',
  'nudge',
  'student',
]
const HINT_LEVELS: readonly HintLevel[] = ['H0', 'H1', 'H2', 'H3', 'H4']

/**
 * 把 /help 返回的 res.note（openapi Note：noteId/kind/who/text/at 必填，lineId 等可选）收敛成可渲染的 Note。
 * 形状不对（缺必填字段、kind 不在枚举、at 不是合法时间）就返回 null —— 前端只渲染确定能显示的内容，不展示半截卡片。
 * 契约之外的未知字段忽略（openapi Note 是 additionalProperties:false，正常不会出现）。
 */
export function parseNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const noteId = typeof record.noteId === 'string' ? record.noteId.trim() : ''
  const who = typeof record.who === 'string' ? record.who : ''
  const text = typeof record.text === 'string' ? record.text : ''
  const at = typeof record.at === 'string' && !Number.isNaN(new Date(record.at).getTime()) ? record.at : ''
  const kind =
    typeof record.kind === 'string' && NOTE_KINDS.includes(record.kind as NoteKind)
      ? (record.kind as NoteKind)
      : null
  if (!noteId || !who || !text || !at || !kind) return null
  const lineId = typeof record.lineId === 'string' && record.lineId ? record.lineId : null
  const level =
    typeof record.level === 'string' && HINT_LEVELS.includes(record.level as HintLevel)
      ? (record.level as HintLevel)
      : null
  const cost = typeof record.cost === 'number' && Number.isFinite(record.cost) ? record.cost : null
  const lessonConceptId =
    typeof record.lessonConceptId === 'string' && record.lessonConceptId ? record.lessonConceptId : null
  return { noteId, kind, who, text, lineId, level, cost, lessonConceptId, at, ...(record.aiGenerated === true ? { aiGenerated: true } : {}) }
}

/**
 * 合并多组批注并按 noteId 去重（先出现的优先，保持服务端下发顺序）。
 *
 * 用途：state.notes（刷新/重连后由服务端给出）+ 本次会话 check_line 返回的 res.note。
 * B 的 #141 目前只在 HelpResult 里返回 note、不写 state.notes；等 B 落库后同一个 note 会
 * 同时出现在两边，这里按 noteId 去重，保证只渲染一次（不伪造持久化，也不重复显示）。
 */
export function mergeNotes(...groups: Array<readonly Note[] | null | undefined>): Note[] {
  const seen = new Set<string>()
  const out: Note[] = []
  for (const group of groups) {
    if (!group) continue
    for (const note of group) {
      if (!note || typeof note.noteId !== 'string' || !note.noteId) continue
      if (seen.has(note.noteId)) continue
      seen.add(note.noteId)
      out.push(note)
    }
  }
  return out
}

/** 学生手动关闭的批注：只从当前渲染列表里去掉，不改服务端/state（刷新后是否再出现由服务端 state 决定）。 */
export function filterDismissedNotes(notes: readonly Note[], dismissedNoteIds: ReadonlySet<string>): Note[] {
  if (!dismissedNoteIds || dismissedNoteIds.size === 0) return notes.slice()
  return notes.filter((note) => !dismissedNoteIds.has(note.noteId))
}

/**
 * 批注时间：MM-DD HH:mm（本地时区；测试可传 IANA 时区得到确定输出）。
 * 非法/空时间返回空串，调用方据此隐藏时间行（不显示 Invalid Date）。
 */
export function formatNoteTime(at: string, timeZone?: string): string {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      ...(timeZone ? { timeZone } : {}),
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
    const month = part('month')
    const day = part('day')
    const hour = part('hour')
    const minute = part('minute')
    if (!month || !day || !hour || !minute) return ''
    return month + '-' + day + ' ' + hour + ':' + minute
  } catch {
    // 非法 IANA 时区等：退回空串，由调用方隐藏
    return ''
  }
}
