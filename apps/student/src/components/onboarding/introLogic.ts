/** 开场动画的翻页与滑动判断（纯函数，页面只负责接线）。 */

export interface IntroStep {
  index: number
  /** 在最后一幕再往后翻：结束。 */
  finish: boolean
}

/** 往前 / 往后一幕。第一幕往前翻留在原地；最后一幕往后翻就是结束。 */
export function introStepFrom(index: number, delta: 1 | -1, total: number): IntroStep {
  const next = index + delta
  if (next >= total) return { index: total - 1, finish: true }
  if (next < 0) return { index: 0, finish: false }
  return { index: next, finish: false }
}

/** 左滑 = 下一幕，右滑 = 上一幕；要滑得够远，而且横向明显多于竖向（竖着滚动不算）。 */
export function shouldSwipe(dx: number, dy: number, threshold = 48): 'next' | 'prev' | null {
  if (Math.abs(dx) < threshold) return null
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'next' : 'prev'
}
