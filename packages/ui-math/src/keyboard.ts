/**
 * 证明键盘与 MathText 编辑器的纯逻辑（#13）。
 *
 * 分工：
 * - 本文件不依赖 DOM / Vue，可被单测（apps/student/tests/keyboard.test.ts）与小程序端复用；
 * - 布局数据只读自 `contracts/keyboard-layout.json`（唯一源：10-开发文档/contracts/，由
 *   tools/sync-contracts.mjs 同步到 packages/contracts 的只读副本，本文件不修改契约）；
 * - 契约里的键只有 `label` / `insert` / `mode` / `kind` / `variants`，没有 `id`；
 *   这里按「层 + 行 + 列」派生稳定的 `id`，组件 v-for 与测试都引用派生 id。
 *
 * 插入语义（03-手写键盘与识别.md §4.2）：
 * - `insert` 里的 `#0` 是插入后的光标位置；`#1 #2…` 是「⇥」依次跳到的占位；
 * - `mode: "math"` 的键在光标不在 `$…$` 内时由编辑器自动补成 `$…$`（光标和占位一起平移）；
 * - `mode: "text"` 的键（证明句式）原样插入（句式自带 `$…$`）。
 */
// 布局读只读副本 packages/contracts/keyboard-layout.json（唯一源：10-开发文档/contracts/）。
// 为什么走 @ui-math 别名而不是相对路径：uni-app 的 Vite 配置开了 preserveSymlinks，pnpm 软链下
// 包内相对路径会被算在 apps/student/node_modules/@proof-gym/ui-math/... 上；@ui-math 在 app 与
// vitest 两边都映射到 packages/ui-math/src（真实源码目录），从那里再回到仓库根的 packages/contracts。
import rawKeyboardLayout from '@ui-math/../../../packages/contracts/keyboard-layout.json'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type KeyboardKeyMode = 'math' | 'text'
export type KeyboardKeyKind = 'symbol' | 'template' | 'phrase'

export const KEYBOARD_KEY_MODES: readonly KeyboardKeyMode[] = ['math', 'text']
export const KEYBOARD_KEY_KINDS: readonly KeyboardKeyKind[] = ['symbol', 'template', 'phrase']

/** 右侧固定动作列的 id（03 §4.1 / 02 §4.7） */
export const KEYBOARD_ACTION_IDS = ['left', 'right', 'next', 'backspace', 'system', 'ink', 'done'] as const
export type KeyboardActionId = (typeof KEYBOARD_ACTION_IDS)[number]

/** 归一化后的键（带派生 id 与默认值） */
export interface KeyboardLayoutKey {
  /** 稳定 id：契约有 id 用契约的，没有则由「层-行-列」派生 */
  id: string
  /** 键帽文字（学生看到的符号/句式简称） */
  label: string
  /** 插入到 MathText 的文本；可含 #0/#1… 占位标记 */
  insert: string
  /** math：需要 $…$；text：原样插入 */
  mode: KeyboardKeyMode
  /** symbol 普通键 / template 模板键 / phrase 证明句式键 */
  kind: KeyboardKeyKind
  /** 长按变体（与 insert 同语法，可含占位标记） */
  variants: string[]
  /** 可选：键帽 LaTeX 预览（契约里给模板键用） */
  latex?: string
  /** 可选：无障碍提示 */
  hint?: string
}

export interface KeyboardLayer {
  id: string
  label: string
  note?: string
  rows: KeyboardLayoutKey[][]
}

export interface KeyboardAction {
  id: KeyboardActionId
  label: string
  hint?: string
}

export interface KeyboardLayout {
  schemaVersion: string
  description?: string
  rowsMax: number
  actions: KeyboardAction[]
  layers: KeyboardLayer[]
}

/** 契约 JSON 的宽松形态（字段都可能缺省，交给 normalize 校验） */
export interface RawKeyboardLayoutKey {
  id?: string
  label?: string
  insert?: string
  mode?: string
  kind?: string
  variants?: string[]
  latex?: string
  hint?: string
}

export interface RawKeyboardLayer {
  id?: string
  label?: string
  note?: string
  rows?: RawKeyboardLayoutKey[][]
}

export interface RawKeyboardAction {
  id?: string
  label?: string
  hint?: string
}

export interface RawKeyboardLayout {
  schemaVersion?: string
  description?: string
  rowsMax?: number
  actions?: RawKeyboardAction[]
  layers?: RawKeyboardLayer[]
}

/** ProofKeyboard 点击键时 emit 的载荷（组件契约的 insert 事件的扩展形态） */
export interface KeyboardInsertPayload {
  /** 插入文本（含 #n 占位标记） */
  text: string
  mode: KeyboardKeyMode
  kind: KeyboardKeyKind
  keyId: string
  label: string
  latex?: string
  /** 兼容组件契约：模板键的光标由 #0 决定，这里通常是 0 */
  cursorOffset: number
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 去重并升序（占位符位置用） */
export function uniqueSortedPositions(values: Iterable<number>): number[] {
  const out: number[] = []
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const n = Math.trunc(value)
    if (!out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// 布局：校验 + 归一化
// ---------------------------------------------------------------------------

export interface KeyboardLayoutIssue {
  /** 出错位置，如 layers[0].rows[2][3].insert */
  path: string
  message: string
}

/**
 * 校验契约数据（只读，不修改）：返回问题列表，空数组表示结构合法。
 * 契约里键没有 id，所以这里只要求 label/insert，派生 id 由 normalizeKeyboardLayout 负责。
 */
export function validateKeyboardLayout(raw: unknown): KeyboardLayoutIssue[] {
  const issues: KeyboardLayoutIssue[] = []
  if (!isRecord(raw)) {
    issues.push({ path: '', message: '布局必须是对象' })
    return issues
  }
  const layers = raw.layers
  if (!Array.isArray(layers) || layers.length === 0) {
    issues.push({ path: 'layers', message: '至少要有 1 层' })
  } else {
    const seenLayerIds = new Set<string>()
    layers.forEach((layer, layerIndex) => {
      const path = `layers[${layerIndex}]`
      if (!isRecord(layer)) {
        issues.push({ path, message: '层必须是对象' })
        return
      }
      const layerId = asString(layer.id)
      if (!layerId || !layerId.trim()) issues.push({ path: path + '.id', message: '层 id 必须是非空字符串' })
      else if (seenLayerIds.has(layerId)) issues.push({ path: path + '.id', message: `层 id 重复：${layerId}` })
      else seenLayerIds.add(layerId)
      const layerLabel = asString(layer.label)
      if (!layerLabel || !layerLabel.trim()) issues.push({ path: path + '.label', message: '层 label 必须是非空字符串' })
      if (!Array.isArray(layer.rows) || layer.rows.length === 0) {
        issues.push({ path: path + '.rows', message: '层至少要有 1 行' })
        return
      }
      layer.rows.forEach((row, rowIndex) => {
        const rowPath = `${path}.rows[${rowIndex}]`
        if (!Array.isArray(row) || row.length === 0) {
          issues.push({ path: rowPath, message: '行必须是非空数组' })
          return
        }
        row.forEach((key, keyIndex) => {
          const keyPath = `${rowPath}[${keyIndex}]`
          if (!isRecord(key)) {
            issues.push({ path: keyPath, message: '键必须是对象' })
            return
          }
          const label = asString(key.label)
          if (!label || !label.trim()) issues.push({ path: keyPath + '.label', message: '键要有非空 label' })
          const insert = asString(key.insert)
          if (insert === null) issues.push({ path: keyPath + '.insert', message: '键要有字符串 insert' })
          else if (!insert) issues.push({ path: keyPath + '.insert', message: '键的 insert 不能为空' })
          const mode = asString(key.mode)
          if (mode !== null && !KEYBOARD_KEY_MODES.includes(mode as KeyboardKeyMode)) {
            issues.push({ path: keyPath + '.mode', message: `mode 只能是 math/text，收到 ${mode}` })
          }
          const kind = asString(key.kind)
          if (kind !== null && !KEYBOARD_KEY_KINDS.includes(kind as KeyboardKeyKind)) {
            issues.push({ path: keyPath + '.kind', message: `kind 只能是 symbol/template/phrase，收到 ${kind}` })
          }
          if (key.variants !== undefined) {
            if (!Array.isArray(key.variants)) issues.push({ path: keyPath + '.variants', message: 'variants 必须是数组' })
            else {
              key.variants.forEach((variant, variantIndex) => {
                if (typeof variant !== 'string' || !variant) {
                  issues.push({ path: `${keyPath}.variants[${variantIndex}]`, message: 'variant 必须是非空字符串' })
                }
              })
            }
          }
          if (key.latex !== undefined && typeof key.latex !== 'string') {
            issues.push({ path: keyPath + '.latex', message: 'latex 必须是字符串' })
          }
          if (key.id !== undefined && (typeof key.id !== 'string' || !key.id.trim())) {
            issues.push({ path: keyPath + '.id', message: '若提供 id，必须是非空字符串' })
          }
        })
      })
    })
  }
  const actions = raw.actions
  if (actions !== undefined) {
    if (!Array.isArray(actions)) issues.push({ path: 'actions', message: 'actions 必须是数组' })
    else {
      const seen = new Set<string>()
      actions.forEach((action, index) => {
        const path = `actions[${index}]`
        if (!isRecord(action)) {
          issues.push({ path, message: '动作必须是对象' })
          return
        }
        const id = asString(action.id)
        if (!id || !KEYBOARD_ACTION_IDS.includes(id as KeyboardActionId)) {
          issues.push({ path: path + '.id', message: '动作 id 必须是 ' + KEYBOARD_ACTION_IDS.join('/') })
        } else if (seen.has(id)) {
          issues.push({ path: path + '.id', message: `动作 id 重复：${id}` })
        } else seen.add(id)
        if (!asString(action.label)) issues.push({ path: path + '.label', message: '动作要有 label' })
      })
    }
  }
  if (raw.rowsMax !== undefined && (typeof raw.rowsMax !== 'number' || !Number.isFinite(raw.rowsMax))) {
    issues.push({ path: 'rowsMax', message: 'rowsMax 必须是数字' })
  }
  return issues
}

/**
 * 把契约 JSON（或已归一化的布局）变成带派生 id / 默认值的 KeyboardLayout。
 * 结构不合法时抛错（fail fast，测试会先跑 validateKeyboardLayout）。
 */
export function normalizeKeyboardLayout(raw: unknown): KeyboardLayout {
  const issues = validateKeyboardLayout(raw)
  if (issues.length > 0) {
    const head = issues.slice(0, 4).map((issue) => `${issue.path || '<root>'}: ${issue.message}`)
    throw new Error('keyboard-layout.json 结构不合法：' + head.join('；'))
  }
  const source = raw as RawKeyboardLayout
  const usedIds = new Set<string>()
  const layers: KeyboardLayer[] = (source.layers ?? []).map((layer, layerIndex) => {
    const layerId = layer.id as string
    const rows: KeyboardLayoutKey[][] = (layer.rows ?? []).map((row, rowIndex) =>
      row.map((key, keyIndex) => {
        const fallbackId = `${layerId}.r${rowIndex}.k${keyIndex}`
        const id = key.id && key.id.trim() ? key.id : fallbackId
        if (usedIds.has(id)) throw new Error(`键盘键 id 重复：${id}`)
        usedIds.add(id)
        const kind = (key.kind ?? (key.mode === 'text' ? 'phrase' : 'symbol')) as KeyboardKeyKind
        const mode = (key.mode ?? (kind === 'phrase' ? 'text' : 'math')) as KeyboardKeyMode
        return {
          id,
          label: key.label as string,
          insert: key.insert as string,
          mode,
          kind,
          variants: Array.isArray(key.variants) ? [...key.variants] : [],
          ...(key.latex !== undefined ? { latex: key.latex } : {}),
          ...(key.hint !== undefined ? { hint: key.hint } : {}),
        }
      }),
    )
    return {
      id: layerId,
      label: layer.label as string,
      ...(layer.note !== undefined ? { note: layer.note } : {}),
      rows,
    }
  })
  const actions: KeyboardAction[] = (source.actions ?? []).map((action) => ({
    id: action.id as KeyboardActionId,
    label: action.label as string,
    ...(action.hint !== undefined ? { hint: action.hint } : {}),
  }))
  return {
    schemaVersion: typeof source.schemaVersion === 'string' ? source.schemaVersion : '1.0',
    ...(typeof source.description === 'string' ? { description: source.description } : {}),
    rowsMax: typeof source.rowsMax === 'number' ? source.rowsMax : 10,
    actions,
    layers,
  }
}

/** 契约 JSON 原文（只读；测试可对原文做结构断言） */
export const keyboardLayoutJson = rawKeyboardLayout as unknown as RawKeyboardLayout

/** 默认布局：直接读 contracts/keyboard-layout.json 的只读副本 */
export const keyboardLayout: KeyboardLayout = normalizeKeyboardLayout(keyboardLayoutJson)

/** 拍平所有键（测试 / 检索用） */
export function flattenKeyboardKeys(layout: KeyboardLayout = keyboardLayout): KeyboardLayoutKey[] {
  const out: KeyboardLayoutKey[] = []
  for (const layer of layout.layers) for (const row of layer.rows) out.push(...row)
  return out
}

/** 按 label 找键（测试用来证明「只用键盘数据」就能打出证明句） */
export function findKeyboardKey(
  layout: KeyboardLayout,
  label: string,
  layerId?: string,
): KeyboardLayoutKey | undefined {
  const layers = layerId ? layout.layers.filter((layer) => layer.id === layerId) : layout.layers
  for (const layer of layers) {
    for (const row of layer.rows) {
      const key = row.find((item) => item.label === label)
      if (key) return key
    }
  }
  return undefined
}

/** 长按变体的可读文案（键帽上展示，例如 \le → ≤） */
const VARIANT_LABELS: Record<string, string> = {
  '\\le': '≤',
  '\\leq': '≤',
  '\\ll': '≪',
  '\\ge': '≥',
  '\\geq': '≥',
  '\\gg': '≫',
  '\\ne': '≠',
  '\\neq': '≠',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\Leftrightarrow': '⇔',
  '\\leftrightarrow': '↔',
  '\\sqrt[#1]{#0}': 'ⁿ√x',
  'a_{n+1}': 'aₙ₊₁',
  'u_n': 'uₙ',
  'S_n': 'Sₙ',
  'x_n': 'xₙ',
  '\\left\\lfloor #0\\right\\rfloor': '⌊x⌋',
  '[#0]': '[x]',
  '\\lim_{n\\to\\infty}': 'lim n→∞',
  '\\lim_{x\\to x_0}': 'lim x→x₀',
  '\\sum_{n=1}^{\\infty}': '∑ n=1→∞',
}

export function variantLabel(variant: string): string {
  const exact = VARIANT_LABELS[variant]
  if (exact) return exact
  // 未收录时做一个「去掉 LaTeX 装饰」的兜底，保证键帽上不是一整串源码
  return variant
    .replace(/#(\d+)/g, '▢')
    .replace(/\\left|\\right/g, '')
    .replace(/\\([a-zA-Z]+)/g, (match, name: string) => (VARIANT_LABELS['\\' + name] ?? name))
    .replace(/[{}]/g, '')
    .trim()
}

// ---------------------------------------------------------------------------
// MathText 编辑器状态：文本 + 选区 + 占位符
// ---------------------------------------------------------------------------

/**
 * 编辑器状态（纯数据，受控组件的内部镜像）。
 * caret/selectionEnd 是 UTF-16 偏移（与 textarea.selectionStart 一致）。
 * anchors 是模板 #1… 留下的占位符位置（升序、绝对偏移），#0 直接作为 caret 不留在 anchors。
 */
export interface EditorState {
  text: string
  caret: number
  selectionEnd: number
  anchors: number[]
}

/** 新编辑器状态（默认光标在末尾） */
export function createEditorState(text = ''): EditorState {
  const value = String(text ?? '')
  return { text: value, caret: value.length, selectionEnd: value.length, anchors: [] }
}

/** 容错：把外部传入的部分状态收敛成合法状态（不改文本内容） */
export function normalizeEditorState(state: Partial<EditorState> | null | undefined): EditorState {
  const text = typeof state?.text === 'string' ? state.text : ''
  const caret = clamp(typeof state?.caret === 'number' ? state.caret : text.length, 0, text.length)
  const selectionEnd = clamp(typeof state?.selectionEnd === 'number' ? state.selectionEnd : caret, 0, text.length)
  const anchors = uniqueSortedPositions(
    Array.isArray(state?.anchors)
      ? state.anchors.filter((anchor): anchor is number => typeof anchor === 'number' && Number.isFinite(anchor))
      : [],
  ).filter((anchor) => anchor >= 0 && anchor <= text.length)
  return { text, caret, selectionEnd, anchors }
}

/** 光标是否在 $…$ 内（\\$ 是转义的字面美元符，不算定界符） */
export function isInsideMath(text: string, position: number): boolean {
  const source = String(text ?? '')
  const end = clamp(position, 0, source.length)
  let inMath = false
  let index = 0
  while (index < end) {
    const ch = source[index]
    if (ch === '\\') {
      index += 2
      continue
    }
    if (ch === '$') inMath = !inMath
    index += 1
  }
  return inMath
}

export interface ExtractedInsert {
  /** 去掉 #n 占位标记后真正落进 MathText 的文本 */
  clean: string
  /** 占位编号 → 在 clean 中的偏移（同号只记第一次出现） */
  offsets: Map<number, number>
}

/** 从 insert 文本里抽出 #0 / #1 … 占位标记（标记本身不进入 MathText） */
export function extractInsertPlaceholders(insert: string): ExtractedInsert {
  const source = String(insert ?? '')
  const offsets = new Map<number, number>()
  let clean = ''
  let index = 0
  while (index < source.length) {
    const ch = source[index]
    if (ch === '#' && index + 1 < source.length) {
      let end = index + 1
      while (end < source.length && source[end] >= '0' && source[end] <= '9') end += 1
      if (end > index + 1) {
        const number = Number(source.slice(index + 1, end))
        if (!offsets.has(number)) offsets.set(number, clean.length)
        index = end
        continue
      }
    }
    clean += ch
    index += 1
  }
  return { clean, offsets }
}

/**
 * 一次编辑（替换 [from,to) 为 insertedLength 长的文本）后，占位符的新位置。
 * - from 之前的占位不动；
 * - 落在被替换区间里的占位丢弃；
 * - 恰好在选区末尾的占位落到插入内容之后（占位在选区后面，内容替换不应吞掉它）；
 * - 纯插入且恰好插在占位处 = 学生把内容填进了这个占位，占位被消费；
 * - to 之后的占位整体平移。
 */
function adjustAnchorsForEdit(anchors: number[], from: number, to: number, insertedLength: number): number[] {
  const out: number[] = []
  if (to === from) {
    for (const anchor of anchors) {
      if (anchor < from) out.push(anchor)
      else if (anchor > from) out.push(anchor + insertedLength)
      // anchor === from：填进了占位，消费
    }
    return uniqueSortedPositions(out)
  }
  for (const anchor of anchors) {
    if (anchor < from) out.push(anchor)
    else if (anchor === from) out.push(from)
    else if (anchor > to) out.push(anchor + insertedLength - (to - from))
    else if (anchor === to) out.push(from + insertedLength)
    // from < anchor < to：被替换掉的占位，丢弃
  }
  return uniqueSortedPositions(out)
}

export interface InsertSpec {
  /** 插入文本（可含 #0/#1… 占位标记） */
  insert: string
  /** math：不在 $…$ 内时自动补；text：原样插 */
  mode?: KeyboardKeyMode
  /** 内部用：强制不补 $…$（删选区等场景） */
  noAutoWrap?: boolean
}

/**
 * 插入文本（编辑器与单测的核心）。
 * 返回新状态：文本、光标（#0 位置，没有 #0 时在插入内容末尾）、剩余占位符。
 */
export function keyboardInsert(state: EditorState, spec: InsertSpec | string): EditorState {
  const current = normalizeEditorState(state)
  const normalized: InsertSpec = typeof spec === 'string' ? { insert: spec } : spec
  const insert = String(normalized.insert ?? '')
  const mode: KeyboardKeyMode = normalized.mode === 'text' ? 'text' : 'math'
  const from = Math.min(current.caret, current.selectionEnd)
  const to = Math.max(current.caret, current.selectionEnd)
  const before = current.text.slice(0, from)
  const after = current.text.slice(to)
  const wrap = !normalized.noAutoWrap && mode === 'math' && !isInsideMath(before, before.length)
  const prefix = wrap ? '$' : ''
  const suffix = wrap ? '$' : ''
  const { clean, offsets } = extractInsertPlaceholders(insert)
  const insertedText = prefix + clean + suffix
  // 空插入（删选区/清空）时不要提前返回：from !== to 时仍要把选区删掉
  if (!insertedText && from === to) return current
  const text = before + insertedText + after
  const caretOffset = offsets.get(0)
  // 没有 #0 时：自动补的 $…$ 要把光标留在 $ 内（否则下一次 math 键会再包一层 $…$）
  const caret =
    caretOffset !== undefined
      ? from + prefix.length + caretOffset
      : wrap
        ? from + prefix.length + clean.length
        : from + insertedText.length
  const templateAnchors: number[] = []
  for (const [number, offset] of offsets) {
    if (number !== 0) templateAnchors.push(from + prefix.length + offset)
  }
  const anchors = uniqueSortedPositions([
    ...adjustAnchorsForEdit(current.anchors, from, to, insertedText.length),
    ...templateAnchors,
  ]).filter((anchor) => anchor <= text.length)
  return { text, caret, selectionEnd: caret, anchors }
}

/** 点击布局里的键（可选长按变体） */
export function insertKey(
  state: EditorState,
  key: KeyboardLayoutKey,
  options: { variantIndex?: number } = {},
): EditorState {
  let insert = key.insert
  if (options.variantIndex !== undefined) {
    const variant = key.variants[options.variantIndex]
    if (typeof variant !== 'string') {
      throw new Error(`键盘键 ${key.id} 没有第 ${options.variantIndex} 个变体`)
    }
    insert = variant
  }
  return keyboardInsert(state, { insert, mode: key.mode })
}

function previousCodePointStart(text: string, index: number): number {
  if (index <= 0) return 0
  const previous = text.charCodeAt(index - 1)
  if (previous >= 0xdc00 && previous <= 0xdfff && index >= 2) {
    const beforePrevious = text.charCodeAt(index - 2)
    if (beforePrevious >= 0xd800 && beforePrevious <= 0xdbff) return index - 2
  }
  return index - 1
}

function nextCodePointEnd(text: string, index: number): number {
  if (index >= text.length) return text.length
  const code = text.charCodeAt(index)
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2
  }
  return index + 1
}

/** ⌫：有选区删选区，否则删光标前一个字符（不拆 emoji 代理对） */
export function backspace(state: EditorState): EditorState {
  const current = normalizeEditorState(state)
  const from = Math.min(current.caret, current.selectionEnd)
  const to = Math.max(current.caret, current.selectionEnd)
  if (to > from) {
    return keyboardInsert(current, { insert: '', mode: 'text', noAutoWrap: true })
  }
  if (from <= 0) return current
  const start = previousCodePointStart(current.text, from)
  const text = current.text.slice(0, start) + current.text.slice(from)
  const anchors = adjustAnchorsForEdit(current.anchors, start, from, 0)
  return { text, caret: start, selectionEnd: start, anchors }
}

/** ← / →：有选区先收拢到一端，否则按码点移动 */
export function moveCaret(state: EditorState, direction: 'left' | 'right'): EditorState {
  const current = normalizeEditorState(state)
  const from = Math.min(current.caret, current.selectionEnd)
  const to = Math.max(current.caret, current.selectionEnd)
  let caret = direction === 'left' ? from : to
  if (from === to) {
    caret = direction === 'left' ? previousCodePointStart(current.text, caret) : nextCodePointEnd(current.text, caret)
  }
  return { ...current, caret, selectionEnd: caret }
}

/** 下一个占位的位置：光标之后的第一个占位，没有则回到第一个（循环） */
export function findNextPlaceholder(state: EditorState): number | null {
  const current = normalizeEditorState(state)
  if (current.anchors.length === 0) return null
  const next = current.anchors.find((anchor) => anchor > current.caret)
  return next ?? current.anchors[0]
}

/** ⇥：跳到下一个占位（03 §4.1） */
export function nextPlaceholder(state: EditorState): EditorState {
  const current = normalizeEditorState(state)
  const target = findNextPlaceholder(current)
  if (target === null) return current
  return { ...current, caret: target, selectionEnd: target }
}

/** 当前光标是否正停在一个占位上（返回下标，否则 -1） */
export function activePlaceholderIndex(state: EditorState): number {
  const current = normalizeEditorState(state)
  return current.anchors.indexOf(current.caret)
}

/** 编辑器动作键（system/ink/done 由父级处理，这里保持状态不变） */
export function applyEditorAction(state: EditorState, action: KeyboardActionId | string): EditorState {
  switch (action) {
    case 'left':
      return moveCaret(state, 'left')
    case 'right':
      return moveCaret(state, 'right')
    case 'next':
      return nextPlaceholder(state)
    case 'backspace':
      return backspace(state)
    default:
      return normalizeEditorState(state)
  }
}

/**
 * 系统键盘/父级改动文本时，用「公共前缀 + 公共后缀」定位改动区间，同步占位符位置。
 * 中文输入法一次替换一整段也不会把占位搞乱。
 */
function adjustAnchorsForTextChange(oldText: string, newText: string, anchors: number[]): number[] {
  if (oldText === newText) return uniqueSortedPositions(anchors)
  const maxPrefix = Math.min(oldText.length, newText.length)
  let prefix = 0
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix)
  let suffix = 0
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const removedStart = prefix
  const removedEnd = oldText.length - suffix
  const insertedLength = newText.length - prefix - suffix
  const delta = newText.length - oldText.length
  const out: number[] = []
  if (removedStart === removedEnd) {
    // 纯插入：插在占位处 = 填进占位
    for (const anchor of anchors) {
      if (anchor < removedStart) out.push(anchor)
      else if (anchor > removedStart) out.push(anchor + delta)
    }
  } else {
    for (const anchor of anchors) {
      if (anchor < removedStart) out.push(anchor)
      else if (anchor === removedStart) out.push(removedStart)
      else if (anchor > removedEnd) out.push(anchor + delta)
      else if (anchor === removedEnd) out.push(removedStart + insertedLength)
    }
  }
  return uniqueSortedPositions(out).filter((anchor) => anchor >= 0 && anchor <= newText.length)
}

/** 外部（系统键盘 / 父级）改动文本后收敛状态 */
export function reconcileText(
  state: EditorState,
  nextText: string,
  caret: number,
  selectionEnd: number = caret,
): EditorState {
  const current = normalizeEditorState(state)
  const text = String(nextText ?? '')
  const anchors = adjustAnchorsForTextChange(current.text, text, current.anchors)
  return {
    text,
    caret: clamp(caret, 0, text.length),
    selectionEnd: clamp(selectionEnd, 0, text.length),
    anchors,
  }
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  /** 要高亮的占位（绝对偏移），一般传当前光标 */
  activeAnchor?: number
  /** $…$ 外的占位字形 */
  glyph?: string
  /** 高亮字形 */
  activeGlyph?: string
}

/**
 * 生成带占位 ▢ 的预览文本（03 §4.3：占位在预览里显示为 ▢，光标所在占位高亮）。
 * $…$ 内用 KaTeX 的 \square（▣ 用 \boxed{\square} 表示高亮），$ 外用 ▢/▣。
 */
export function buildPreviewText(text: string, anchors: number[] = [], options: PreviewOptions = {}): string {
  const source = String(text ?? '')
  const positions = uniqueSortedPositions(anchors).filter((anchor) => anchor >= 0 && anchor <= source.length)
  const glyph = options.glyph ?? '▢'
  const activeGlyph = options.activeGlyph ?? '▣'
  let out = ''
  let previous = 0
  for (const position of positions) {
    out += source.slice(previous, position)
    const active = options.activeAnchor === position
    if (isInsideMath(source, position)) out += active ? '\\boxed{\\square}' : '\\square '
    else out += active ? activeGlyph : glyph
    previous = position
  }
  out += source.slice(previous)
  return out
}
