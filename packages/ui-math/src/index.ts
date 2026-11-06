/**
 * @proof-gym/ui-math 公共组件入口（角色 A）
 * 组件与纯逻辑分两栏：
 * - 纯逻辑（无 DOM）：mathText / keyboard / ink → 可被小程序端与单测直接复用；
 * - Vue 组件：MathText / MathTextEditor / ProofKeyboard / InkCanvas / RecognitionConfirm。
 */
export { parseMathText, extractMath, normalizeBareLatex, toPlainText } from './mathText'
export { MATH_RENDER_FAILED_HINT, isLongInlineMath, renderMath } from './mathRender'
export type { MathSegment } from './mathText'

// #13：证明键盘纯逻辑（布局归一化/校验、插入、占位符跳转、光标动作、预览）
export {
  KEYBOARD_ACTION_IDS,
  KEYBOARD_KEY_KINDS,
  KEYBOARD_KEY_MODES,
  activePlaceholderIndex,
  applyEditorAction,
  backspace,
  buildPreviewText,
  createEditorState,
  extractInsertPlaceholders,
  findKeyboardKey,
  findNextPlaceholder,
  flattenKeyboardKeys,
  insertKey,
  isInsideMath,
  keyboardInsert,
  keyboardLayout,
  keyboardLayoutJson,
  moveCaret,
  nextPlaceholder,
  normalizeEditorState,
  normalizeKeyboardLayout,
  reconcileText,
  uniqueSortedPositions,
  validateKeyboardLayout,
  variantLabel,
} from './keyboard'
export type {
  EditorState,
  ExtractedInsert,
  InsertSpec,
  KeyboardAction,
  KeyboardActionId,
  KeyboardInsertPayload,
  KeyboardKeyKind,
  KeyboardKeyMode,
  KeyboardLayout,
  KeyboardLayoutIssue,
  KeyboardLayoutKey,
  KeyboardLayer,
  PreviewOptions,
  RawKeyboardLayout,
  RawKeyboardLayoutKey,
} from './keyboard'

// #15：识别确认纯逻辑（服务端 agree/diff → 展示与合并；前端不做一致性判定）
export {
  alternativeDisplayText,
  buildAlternativeText,
  buildRecognitionView,
  diffHighlights,
  isInsideMathRange,
  mergeRecognitionResult,
  recognitionStatusHint,
  recognitionSummary,
  toMathFragment,
} from './recognition'
export type {
  RecognitionDiffSpan,
  RecognitionHighlight,
  RecognitionLike,
  RecognitionRoute,
  RecognitionView,
} from './recognition'

export { default as MathText } from './MathText.vue'
export { default as MathTextEditor } from './MathTextEditor.vue'
export { default as ProofKeyboard } from './ProofKeyboard.vue'
export { default as RecognitionConfirm } from './RecognitionConfirm.vue'
// 后续由 #14 提供：
// export { default as InkCanvas } from './InkCanvas.vue'
