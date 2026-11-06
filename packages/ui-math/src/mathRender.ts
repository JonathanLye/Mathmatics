/**
 * 公式渲染（学生端 MathText 与教师端 MathTextView 共用）。
 * 渲染失败时不用 KaTeX 的红字：ok=false，由调用方显示原文加一句轻提示。
 */
import katex from 'katex'

export const MATH_RENDER_FAILED_HINT = '这段公式没能排版，先看原文'

/** 源码超过这个长度的行内公式放进可横向滚动的容器，避免在手机上撑破布局。 */
export const LONG_INLINE_LATEX = 36

export interface RenderedMath {
  ok: boolean
  html: string
}

export function renderMath(latex: string, options: { display?: boolean } = {}): RenderedMath {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: true,
      displayMode: options.display === true,
      strict: 'ignore',
      output: 'html',
      trust: false,
    })
    return { ok: true, html }
  } catch {
    return { ok: false, html: '' }
  }
}

export function isLongInlineMath(latex: string): boolean {
  return latex.length >= LONG_INLINE_LATEX
}
