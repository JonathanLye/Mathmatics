/**
 * @proof-gym/ui-math 公共组件入口（角色 A）
 * 组件与纯逻辑分两栏：
 * - 纯逻辑（无 DOM）：mathText / keyboard / ink → 可被小程序端与单测直接复用；
 * - Vue 组件：MathText / MathTextEditor / ProofKeyboard / InkCanvas / RecognitionConfirm。
 */
export { parseMathText, extractMath, toPlainText } from './mathText'
export type { MathSegment } from './mathText'
export { default as MathText } from './MathText.vue'
// 后续由 #13 / #14 / #15 提供：
// export { default as MathTextEditor } from './MathTextEditor.vue'
// export { default as ProofKeyboard } from './ProofKeyboard.vue'
// export { default as InkCanvas } from './InkCanvas.vue'
// export { default as RecognitionConfirm } from './RecognitionConfirm.vue'
