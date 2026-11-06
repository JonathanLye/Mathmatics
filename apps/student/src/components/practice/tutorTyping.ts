/**
 * 助教气泡的打字效果（只在前端逐段显示，内容已经完整到手）。
 * 切点不会落在公式中间：半截 $…$ 会把 LaTeX 源码露出来。公式整段一起出现。
 */

/** 文本的逐段切点（递增，最后一个等于文本长度）。空文本返回 []。 */
export function typingCuts(text: string): number[] {
  const cuts: number[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '$') {
      const close = text.indexOf('$', i + 1)
      i = close === -1 ? text.length : close + 1
    } else {
      i += 1
    }
    cuts.push(i)
  }
  return cuts
}

/** 打完整段的总时长上限（毫秒）：长回答也不让学生干等。 */
export const TYPING_MAX_MS = 900
export const TYPING_STEP_MS = 16

/** 每一拍前进几段。 */
export function typingStride(cutCount: number): number {
  const ticks = Math.max(1, Math.floor(TYPING_MAX_MS / TYPING_STEP_MS))
  return Math.max(1, Math.ceil(cutCount / ticks))
}
