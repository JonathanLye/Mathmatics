/**
 * 识别确认纯逻辑（issue #15，03 §3.1/§3.2、02 §4.6）。
 *
 * 输入是服务端 Recognition（主结果 text + 交叉比对 diff[{start,end,alt}]，见 openapi.yaml）。
 * 两路结果 = 主结果 + 「主结果套用 diff 替换」：
 * - diff 的 start/end 是主结果里的字符坐标，alt 是交叉路在这一段的文本；
 * - 一致/不一致片段按字符级 LCS 切分，返回带 highlight 位置（primaryStart/End）的片段数组；
 * - 归一化：空白、$ 定界符、常见等价 LaTeX（\left/\right、\dfrac、\le/\leq…）视为一致，
 *   避免把排版差异当成「两种识别不一致」；
 * - 合并：可逐处「选左/选右」，得到最终确认文本。
 *
 * 纯函数、无 DOM 依赖，可被小程序端与单测复用；不做 canon()（那是服务端引擎的职责）。
 */

/** 服务端 diff 的一段（主结果坐标） */
export interface RecognitionDiffSpan {
  start: number
  end: number
  alt: string
}

/** 本模块用到的 Recognition 子集（apps/student/src/types/attempt.ts 的 Recognition 可结构化赋值进来） */
export interface RecognitionLike {
  text?: string
  lines?: Array<{ text?: string; confidence?: number }>
  agree?: boolean | null
  diff?: RecognitionDiffSpan[]
  status?: string
  confidence?: number
}

/** 采用哪一路：左=主识别结果，右=交叉识别结果 */
export type RecognitionRoute = 'primary' | 'alternative'

/** 一致/不一致片段（坐标是各自文本的字符下标） */
export interface CompareSegment {
  kind: 'same' | 'diff'
  /** 主路片段文本 */
  primary: string
  /** 备路片段文本（kind='same' 且因归一化判同时可能与 primary 不同） */
  alternative: string
  primaryStart: number
  primaryEnd: number
  alternativeStart: number
  alternativeEnd: number
  /** 两段原文是否逐字一致（false 但 kind='same' 表示只差空白/LaTeX 写法） */
  rawEqual: boolean
}

/** 一处不一致（主结果坐标，便于直接高亮） */
export interface RecognitionConflict {
  index: number
  segmentIndex: number
  start: number
  end: number
  primary: string
  alternative: string
}

export interface RecognitionComparison {
  primary: string
  alternative: string
  segments: CompareSegment[]
  conflicts: RecognitionConflict[]
  /** 两路原文是否逐字相同 */
  identical: boolean
  /** 归一化后是否一致（true 时不需要高亮/二选一） */
  equal: boolean
  /** 服务端 agree 字段（可能为 null）；null 时以本模块的 equal 为准 */
  serverAgree: boolean | null
  status: string
}

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

/** 常见等价 LaTeX 写法：只做「同一含义的写法」归一，不做数学等价（canon 是服务端职责）。 */
const LATEX_NORMALIZE: Array<readonly [RegExp, string]> = [
  [/\\left\b/g, ''],
  [/\\right\b/g, ''],
  [/\\dfrac\b/g, '\\frac'],
  [/\\tfrac\b/g, '\\frac'],
  [/\\leq\b/g, '\\le'],
  [/\\geq\b/g, '\\ge'],
  [/\\neq\b/g, '\\ne'],
  [/\\rightarrow\b/g, '\\to'],
  [/\\leftarrow\b/g, '\\gets'],
  [/\\(?:cdots|ldots|dots)\b/g, '...'],
  [/\\quad\b/g, ''],
  [/\\qquad\b/g, ''],
  [/\\[,;:! ]/g, ''],
]

/**
 * 识别比对用的归一化：去掉空白与 $ 定界符、统一常见等价 LaTeX。
 * 只用于「两路是否一致」的展示判断，不写回学生文本（永远不替学生改正）。
 */
export function normalizeRecognitionText(text: string): string {
  let out = String(text ?? '')
  // 先保护转义美元符 \$，避免被当成定界符删掉
  out = out.replace(/\\\$/g, '\u0000PG_DOLLAR\u0000')
  out = out.replace(/\$/g, '')
  for (const [pattern, replacement] of LATEX_NORMALIZE) out = out.replace(pattern, replacement)
  out = out.replace(/[\s\u00a0\u3000]+/g, '')
  out = out.replace(/\u0000PG_DOLLAR\u0000/g, '$')
  return out
}

// ---------------------------------------------------------------------------
// 主结果 + diff → 交叉路文本
// ---------------------------------------------------------------------------

/**
 * 把服务端 diff（主结果坐标）套用到主结果上，得到交叉路文本。
 * 非法/重叠片段会被忽略（前端不因脏数据崩）。
 */
export function buildAlternativeText(primary: string, diffs: RecognitionDiffSpan[] = []): string {
  const text = String(primary ?? '')
  const spans = (Array.isArray(diffs) ? diffs : [])
    .filter((span): span is RecognitionDiffSpan => Boolean(span) && Number.isFinite(span.start) && Number.isFinite(span.end))
    .map((span) => ({
      start: Math.max(0, Math.min(text.length, Math.trunc(span.start))),
      end: Math.max(0, Math.min(text.length, Math.trunc(span.end))),
      alt: String(span.alt ?? ''),
    }))
    .filter((span) => span.end >= span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const accepted: typeof spans = []
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue // 重叠片段跳过
    accepted.push(span)
    cursor = span.end
  }
  let result = text
  // 从后往前替换：前面的坐标不会被后面的替换影响
  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    const span = accepted[i] as RecognitionDiffSpan
    result = result.slice(0, span.start) + span.alt + result.slice(span.end)
  }
  return result
}

// ---------------------------------------------------------------------------
// 字符级 LCS diff → 片段
// ---------------------------------------------------------------------------

interface DiffOp {
  type: 'same' | 'del' | 'ins'
  text: string
  aIndex: number
  bIndex: number
}

interface RawRun {
  kind: 'same' | 'diff'
  primary: string
  alternative: string
  primaryStart: number
  primaryEnd: number
  alternativeStart: number
  alternativeEnd: number
}

function lcsOps(primary: string, alternative: string): DiffOp[] {
  const n = primary.length
  const m = alternative.length
  const width = m + 1
  // dp[i][j] = primary[i..] 与 alternative[j..] 的 LCS 长度（Int32Array 压平）
  const dp = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        primary[i] === alternative[j]
          ? (dp[(i + 1) * width + j + 1] as number) + 1
          : Math.max(dp[(i + 1) * width + j] as number, dp[i * width + j + 1] as number)
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (primary[i] === alternative[j]) {
      ops.push({ type: 'same', text: primary[i] as string, aIndex: i, bIndex: j })
      i += 1
      j += 1
      continue
    }
    if ((dp[(i + 1) * width + j] as number) >= (dp[i * width + j + 1] as number)) {
      ops.push({ type: 'del', text: primary[i] as string, aIndex: i, bIndex: j })
      i += 1
    } else {
      ops.push({ type: 'ins', text: alternative[j] as string, aIndex: i, bIndex: j })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: primary[i] as string, aIndex: i, bIndex: j })
    i += 1
  }
  while (j < m) {
    ops.push({ type: 'ins', text: alternative[j] as string, aIndex: i, bIndex: j })
    j += 1
  }
  return ops
}

function opsToRuns(ops: DiffOp[]): RawRun[] {
  const runs: RawRun[] = []
  let index = 0
  while (index < ops.length) {
    const first = ops[index] as DiffOp
    if (first.type === 'same') {
      let text = ''
      let last = first
      const startA = first.aIndex
      const startB = first.bIndex
      while (index < ops.length && (ops[index] as DiffOp).type === 'same') {
        last = ops[index] as DiffOp
        text += last.text
        index += 1
      }
      runs.push({
        kind: 'same',
        primary: text,
        alternative: text,
        primaryStart: startA,
        primaryEnd: last.aIndex + 1,
        alternativeStart: startB,
        alternativeEnd: last.bIndex + 1,
      })
      continue
    }
    let primaryPart = ''
    let alternativePart = ''
    const startA = first.aIndex
    const startB = first.bIndex
    while (index < ops.length && (ops[index] as DiffOp).type !== 'same') {
      const op = ops[index] as DiffOp
      if (op.type === 'del') primaryPart += op.text
      else alternativePart += op.text
      index += 1
    }
    runs.push({
      kind: 'diff',
      primary: primaryPart,
      alternative: alternativePart,
      primaryStart: startA,
      primaryEnd: startA + primaryPart.length,
      alternativeStart: startB,
      alternativeEnd: startB + alternativePart.length,
    })
  }
  return runs
}

/**
 * 切分两路文本：一致片段 kind='same'，不一致片段 kind='diff'。
 * 只差空白/LaTeX 写法的片段按归一化归入 same（不误报）。
 */
export function diffRecognitionTexts(primary: string, alternative: string): CompareSegment[] {
  const textA = String(primary ?? '')
  const textB = String(alternative ?? '')
  const mapped = opsToRuns(lcsOps(textA, textB)).map((run): CompareSegment => {
    const same = run.kind === 'same' || normalizeRecognitionText(run.primary) === normalizeRecognitionText(run.alternative)
    return {
      kind: same ? 'same' : 'diff',
      primary: run.primary,
      alternative: run.alternative,
      primaryStart: run.primaryStart,
      primaryEnd: run.primaryEnd,
      alternativeStart: run.alternativeStart,
      alternativeEnd: run.alternativeEnd,
      rawEqual: run.primary === run.alternative,
    }
  })
  // 合并相邻的一致片段，前端渲染时片段数更少
  const merged: CompareSegment[] = []
  for (const segment of mapped) {
    const previous = merged[merged.length - 1]
    if (previous && previous.kind === 'same' && segment.kind === 'same') {
      previous.primaryEnd = segment.primaryEnd
      previous.alternativeEnd = segment.alternativeEnd
      previous.primary = textA.slice(previous.primaryStart, previous.primaryEnd)
      previous.alternative = textB.slice(previous.alternativeStart, previous.alternativeEnd)
      previous.rawEqual = previous.primary === previous.alternative
      continue
    }
    merged.push(segment)
  }
  return merged
}

// ---------------------------------------------------------------------------
// 组装 / 合并
// ---------------------------------------------------------------------------

/** 从 Recognition 得到两路文本并比较（diff 用服务端给的；没有 diff 时退回 lines[1]）。 */
export function compareRecognition(recognition: RecognitionLike): RecognitionComparison {
  const primary = String(recognition.text ?? recognition.lines?.[0]?.text ?? '')
  let alternative = primary
  if (Array.isArray(recognition.diff) && recognition.diff.length > 0) {
    alternative = buildAlternativeText(primary, recognition.diff)
  } else if (Array.isArray(recognition.lines) && recognition.lines.length > 1) {
    alternative = String(recognition.lines[1]?.text ?? primary)
  }
  const segments = diffRecognitionTexts(primary, alternative)
  const conflicts: RecognitionConflict[] = []
  segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== 'diff') return
    conflicts.push({
      index: conflicts.length,
      segmentIndex,
      start: segment.primaryStart,
      end: segment.primaryEnd,
      primary: segment.primary,
      alternative: segment.alternative,
    })
  })
  return {
    primary,
    alternative,
    segments,
    conflicts,
    identical: primary === alternative,
    equal: conflicts.length === 0,
    serverAgree: typeof recognition.agree === 'boolean' ? recognition.agree : null,
    status: typeof recognition.status === 'string' ? recognition.status : 'ok',
  }
}

/**
 * 按每个冲突的选择（默认左=主结果）合并出最终文本。
 * choices[i] = 'alternative' 时把第 i 处替换成右路文本。
 */
export function mergeRecognitionResult(
  comparison: RecognitionComparison,
  choices: RecognitionRoute[] = [],
): string {
  let text = comparison.primary
  for (let i = comparison.conflicts.length - 1; i >= 0; i -= 1) {
    const conflict = comparison.conflicts[i] as RecognitionConflict
    if ((choices[i] ?? 'primary') !== 'alternative') continue
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

/** 冲突右路（alt）的展示文本：冲突落在公式里时同样补 $…$。 */
export function alternativeDisplayText(primary: string, conflict: Pick<RecognitionConflict, 'start' | 'alternative'>): string {
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
