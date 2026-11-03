/**
 * 识别确认纯逻辑（issue #15，03 §3.1/§3.2、02 §4.6）。
 *
 * 一致性判定完全在服务端（03 §3.1 第 6 步：canon(主) 与 canon(交叉) 比对 → agree/diff）：
 * - `agree` 决定横幅文案与「直接显示 + 单按钮确认」分支（02 §4.6）；
 * - `diff[{start,end,alt}]`（主结果字符坐标）决定高亮位置与右路文本；
 * - 前端只渲染，不做任何归一化/LCS/数学等价判断（12 §1 接口边界）。03 §5.2 把
 *   packages/contracts/tools/canon.mjs 定为参考实现，前端另写一套必然分叉，所以这里不复制。
 *
 * 纯函数、无 DOM 依赖，可被小程序端与单测复用。
 */

/** 服务端 diff 的一段（start/end 是主结果 text 的字符下标，alt 是交叉路在这一段的文本） */
export interface RecognitionDiffSpan {
  start: number
  end: number
  alt: string
}

/** 本模块用到的 Recognition 子集（字段全部来自服务端；apps/student/src/types/attempt.ts 的 Recognition 可结构化赋值） */
export interface RecognitionLike {
  text?: string
  agree?: boolean | null
  diff?: RecognitionDiffSpan[]
  status?: string
  confidence?: number
}

/** 采用哪一路：左=主识别结果，右=交叉识别结果 */
export type RecognitionRoute = 'primary' | 'alternative'

/** 一处「两种识别不一致」：位置与两侧文本都来自服务端 diff，前端不重算 */
export interface RecognitionHighlight {
  index: number
  start: number
  end: number
  /** 主结果在该位置的原文（插入时为 '' ） */
  primary: string
  /** 交叉路在该位置的文本（服务端 diff.alt） */
  alternative: string
}

export interface RecognitionView {
  /** 主结果文本（服务端 recognition.text） */
  primary: string
  /** 主结果套用全部服务端 diff 后的交叉路文本（仅展示用，不参与一致性判断） */
  alternative: string
  /** 服务端两路是否一致；null = 服务端没给交叉比对（单路） */
  agree: boolean | null
  status: string
  /** 高亮位置：只由服务端 diff 生成；服务端 agree=true 时不消费 diff（以服务端结论为准） */
  conflicts: RecognitionHighlight[]
  /** 02 §4.6：agree=true 且 status=ok（置信度由服务端 status 表达）→ 直接显示、单按钮确认 */
  simple: boolean
  /** 服务端是否给了交叉比对 diff（渲染右路用） */
  hasDiff: boolean
}

interface NormalizedSpan {
  start: number
  end: number
  alt: string
}

/**
 * 归一化服务端 diff：裁剪到主结果长度、丢弃非法/重叠片段、按位置排序。
 * 只做坐标保护（前端不因脏数据崩），不做文本比较。
 */
function normalizeSpans(primary: string, diffs: RecognitionDiffSpan[] = []): NormalizedSpan[] {
  const text = String(primary ?? '')
  const spans = (Array.isArray(diffs) ? diffs : [])
    .filter(
      (span): span is RecognitionDiffSpan =>
        Boolean(span) && Number.isFinite(span.start) && Number.isFinite(span.end),
    )
    .map((span) => ({
      start: Math.max(0, Math.min(text.length, Math.trunc(span.start))),
      end: Math.max(0, Math.min(text.length, Math.trunc(span.end))),
      alt: String(span.alt ?? ''),
    }))
    .filter((span) => span.end >= span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const accepted: NormalizedSpan[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue // 重叠片段跳过
    accepted.push(span)
    cursor = span.end
  }
  return accepted
}

/**
 * 把服务端 diff（主结果坐标）套用到主结果上，得到交叉路文本（右路展示）。
 * 非法/重叠片段会被忽略（前端不因脏数据崩）。
 */
export function buildAlternativeText(primary: string, diffs: RecognitionDiffSpan[] = []): string {
  const text = String(primary ?? '')
  const spans = normalizeSpans(text, diffs)
  let result = text
  // 从后往前替换：前面的坐标不会被后面的替换影响
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index] as NormalizedSpan
    result = result.slice(0, span.start) + span.alt + result.slice(span.end)
  }
  return result
}

/** 服务端 diff → 高亮位置（主结果坐标）。前端不会自己找差异。 */
export function diffHighlights(primary: string, diffs: RecognitionDiffSpan[] = []): RecognitionHighlight[] {
  const text = String(primary ?? '')
  return normalizeSpans(text, diffs).map((span, index) => ({
    index,
    start: span.start,
    end: span.end,
    primary: text.slice(span.start, span.end),
    alternative: span.alt,
  }))
}

/**
 * 从 Recognition 组装视图：文本/一致与否/高亮/直接确认分支全部读服务端字段。
 * - agree=false：高亮只来自 diff；没有 diff 就不高亮（不猜）。
 * - agree=true 或 null：不消费 diff（服务端结论优先）。
 */
export function buildRecognitionView(recognition: RecognitionLike): RecognitionView {
  const primary = String(recognition.text ?? '')
  const diffs = Array.isArray(recognition.diff) ? recognition.diff : []
  const status = typeof recognition.status === 'string' && recognition.status !== '' ? recognition.status : 'ok'
  const agree = typeof recognition.agree === 'boolean' ? recognition.agree : null
  const conflicts = agree === false ? diffHighlights(primary, diffs) : []
  return {
    primary,
    alternative: buildAlternativeText(primary, diffs),
    agree,
    status,
    conflicts,
    hasDiff: normalizeSpans(primary, diffs).length > 0,
    simple: status === 'ok' && agree === true,
  }
}

/**
 * 02 §4.6 的横幅文案：一致/不一致只读服务端 agree，不在前端重算。
 * 返回空串表示服务端没给交叉比对（单路，不显示一致与否）。
 */
export function recognitionSummary(view: Pick<RecognitionView, 'agree' | 'status' | 'conflicts'>): string {
  if (view.status !== 'ok') return '识别没有成功'
  if (view.agree === true) return '两路识别一致'
  if (view.agree === false) {
    const count = view.conflicts.length
    return count > 0 ? `两路识别不一致 · 请核对高亮的 ${count} 处` : '两路识别不一致 · 请核对后确认'
  }
  return ''
}

/**
 * 按每个高亮的选择（默认左=主结果）合并出最终文本。
 * choices[i] = 'alternative' 时把第 i 处替换成服务端 diff.alt。
 */
export function mergeRecognitionResult(
  primary: string,
  conflicts: RecognitionHighlight[] = [],
  choices: RecognitionRoute[] = [],
): string {
  let text = String(primary ?? '')
  for (let index = conflicts.length - 1; index >= 0; index -= 1) {
    const conflict = conflicts[index] as RecognitionHighlight
    if ((choices[index] ?? 'primary') !== 'alternative') continue
    text = text.slice(0, conflict.start) + conflict.alternative + text.slice(conflict.end)
  }
  return text
}

// ---------------------------------------------------------------------------
// 渲染辅助（MathText 片段）
// ---------------------------------------------------------------------------

interface MathRange {
  /** $ 内第一个字符的位置 */
  start: number
  /** 闭合 $ 的位置 */
  end: number
}

/** 扫描 $…$ 的内部区间（与 mathText.ts 的转义/未闭合规则一致：未闭合按文本处理）。 */
function mathInteriorRanges(text: string): MathRange[] {
  const ranges: MathRange[] = []
  let open = -1
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\\' && text[index + 1] === '$') {
      index += 2
      continue
    }
    if (char === '$') {
      if (open === -1) open = index
      else {
        if (index > open + 1) ranges.push({ start: open + 1, end: index })
        open = -1
      }
      index += 1
      continue
    }
    index += 1
  }
  return ranges
}

/** position 是否在某个 $…$ 内部（含紧贴 $ 的位置）。 */
export function isInsideMathRange(text: string, position: number): boolean {
  const target = Math.trunc(Number(position) || 0)
  return mathInteriorRanges(String(text ?? '')).some((range) => target >= range.start && target <= range.end)
}

/**
 * 把片段包成可直接交给 <MathText> 的文本：
 * 片段整体落在 $…$ 内时补 $…$，否则原样返回（含 $ 定界符的片段不重复包）。
 */
export function toMathFragment(text: string, start: number, end: number): string {
  const source = String(text ?? '')
  const from = Math.max(0, Math.min(source.length, Math.trunc(Number(start) || 0)))
  const to = Math.max(from, Math.min(source.length, Math.trunc(Number(end) || 0)))
  const slice = source.slice(from, to)
  if (!slice) return ''
  if (slice.includes('$')) return slice
  const inMath = mathInteriorRanges(source).some((range) => from >= range.start && to <= range.end && from < to)
  return inMath ? '$' + slice + '$' : slice
}

/** 高亮右路（服务端 diff.alt）的展示文本：落在公式里时同样补 $…$。 */
export function alternativeDisplayText(
  primary: string,
  conflict: Pick<RecognitionHighlight, 'start' | 'alternative'>,
): string {
  const alt = String(conflict.alternative ?? '')
  if (!alt) return ''
  if (alt.includes('$')) return alt
  return isInsideMathRange(primary, conflict.start) ? '$' + alt + '$' : alt
}

/** 识别状态 → 学生可见提示（02 §4.6：永远不替学生改正，也不暗示对错）。 */
export function recognitionStatusHint(status?: string): string {
  switch (status) {
    case 'empty':
      return '没有识别到内容。再写一次，或者用键盘。'
    case 'low_confidence':
      return '没认出来，再写一次，或者用键盘。'
    case 'error':
      return '识别暂时不可用，再写一次，或者用键盘。'
    default:
      return ''
  }
}
