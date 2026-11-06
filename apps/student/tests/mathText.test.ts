import { describe, expect, it } from 'vitest'
import { extractMath, normalizeBareLatex, parseMathText, toPlainText } from '@proof-gym/ui-math/mathText'
import { isLongInlineMath, MATH_RENDER_FAILED_HINT, renderMath } from '@proof-gym/ui-math/mathRender'

describe('parseMathText（MathText 解析，03 §5）', () => {
  it('纯中文没有公式时只有一个 text 片段', () => {
    expect(parseMathText('把这一步写清楚')).toEqual([{ kind: 'text', value: '把这一步写清楚' }])
  })

  it('行内公式被切成 math 片段，并保留前后文本', () => {
    const segs = parseMathText('任取 $\\varepsilon>0$，取 $N=\\lceil 5/\\varepsilon\\rceil$')
    expect(segs.map((s) => s.kind)).toEqual(['text', 'math', 'text', 'math'])
    expect(segs.filter((s) => s.kind === 'math').map((s) => (s as any).value)).toEqual([
      '\\varepsilon>0',
      'N=\\lceil 5/\\varepsilon\\rceil',
    ])
  })

  it('转义的 \\$ 不当作公式定界符', () => {
    expect(parseMathText('价格是 \\$5')).toEqual([{ kind: 'text', value: '价格是 $5' }])
  })

  it('未闭合的 $ 回退为普通文本，不吞字', () => {
    expect(parseMathText('这里有 $x 没闭合')).toEqual([{ kind: 'text', value: '这里有 $x 没闭合' }])
  })

  it('空公式 a$$b 被忽略（不生成空 math 片段，且不切断文本）', () => {
    expect(parseMathText('a$$b')).toEqual([{ kind: 'text', value: 'ab' }])
  })

  it('extractMath / toPlainText 供闸门与回退渲染复用', () => {
    const text = '因为 $|a_n-3|<\\varepsilon$，所以极限是 3'
    expect(extractMath(text)).toEqual(['|a_n-3|<\\varepsilon'])
    expect(toPlainText(text)).toContain('|a_n-3|<\\varepsilon')
  })

  it('空字符串返回空数组', () => {
    expect(parseMathText('')).toEqual([])
  })
})

describe('parseMathText：所有定界符（WS7）', () => {
  const math = (text: string) => parseMathText(text).filter((s) => s.kind === 'math')

  it('$…$ 行内', () => {
    expect(parseMathText('设 $a_n$ 收敛')).toEqual([
      { kind: 'text', value: '设 ' },
      { kind: 'math', value: 'a_n' },
      { kind: 'text', value: ' 收敛' },
    ])
  })

  it('$$…$$ 块级带 display 标记', () => {
    expect(parseMathText('于是 $$a+b$$ 成立')).toEqual([
      { kind: 'text', value: '于是 ' },
      { kind: 'math', value: 'a+b', display: true },
      { kind: 'text', value: ' 成立' },
    ])
  })

  it('\\(…\\) 行内、\\[…\\] 块级', () => {
    expect(math('取 \\(x^2\\) 再看')).toEqual([{ kind: 'math', value: 'x^2' }])
    expect(math('取 \\[x^2\\] 再看')).toEqual([{ kind: 'math', value: 'x^2', display: true }])
  })

  it('未闭合的 \\( 和 \\[ 不吞后面的字', () => {
    expect(toPlainText('还没关 \\(x 这里')).toContain('这里')
    expect(toPlainText('还没关 \\[x 这里')).toContain('这里')
  })

  it('未闭合的 $$ 不吞后面的字', () => {
    expect(toPlainText('还没关 $$x 这里')).toContain('这里')
  })

  it('转义的 \\$ 夹在公式之间：金额不当定界符，真公式照常切', () => {
    const segs = parseMathText('花了 \\$5，设 $x>0$')
    expect(segs[0]).toEqual({ kind: 'text', value: '花了 $5，设 ' })
    expect(segs[1]).toEqual({ kind: 'math', value: 'x>0' })
  })

  it('中文和公式混排', () => {
    const segs = parseMathText('对任意 $\\varepsilon>0$，存在 $N$，使得当 $n>N$ 时成立。')
    expect(segs.map((s) => s.kind)).toEqual(['text', 'math', 'text', 'math', 'text', 'math', 'text'])
    expect(segs[segs.length - 1]).toEqual({ kind: 'text', value: ' 时成立。' })
  })
})

describe('裸 LaTeX（没有定界符的 \\frac、a_n）', () => {
  const kinds = (text: string) => parseMathText(text).map((s) => s.kind + ':' + s.value)

  it('裸命令包成公式，保留前后中文', () => {
    expect(kinds('取 \\frac{1}{n} 就够了')).toEqual(['text:取 ', 'math:\\frac{1}{n}', 'text: 就够了'])
    expect(kinds('\\varepsilon > 0')).toEqual(['math:\\varepsilon > 0'])
  })

  it('下标、上标、绝对值：老师看板的“卡在 |a_n-3|”', () => {
    expect(kinds('卡在 |a_n-3|')).toEqual(['text:卡在 ', 'math:|a_n-3|'])
    expect(kinds('看 x^2 这一项')).toEqual(['text:看 ', 'math:x^2', 'text: 这一项'])
  })

  it('JSON 双重转义的 \\\\frac 也能认', () => {
    expect(kinds('取 \\\\frac{1}{n}')).toEqual(['text:取 ', 'math:\\frac{1}{n}'])
  })

  it('不认识的反斜杠和普通英文、网址不动', () => {
    expect(kinds('路径 C:\\foo 不是公式')).toEqual(['text:路径 C:\\foo 不是公式'])
    expect(kinds('see https://example.com/a_b/x^2 ok')).toEqual(['text:see https://example.com/a_b/x^2 ok'])
    expect(kinds('snake_case 不算')).toEqual(['text:snake_case 不算'])
  })

  it('纯文本没有 LaTeX 时原样', () => {
    expect(normalizeBareLatex('把这一步写清楚')).toEqual([{ kind: 'text', value: '把这一步写清楚' }])
  })
})

describe('renderMath：失败不抛、不用红色', () => {
  it('合法公式返回 KaTeX 片段', () => {
    const out = renderMath('\\frac{1}{n}')
    expect(out.ok).toBe(true)
    expect(out.html).toContain('katex')
    expect(renderMath('x', { display: true }).html).toContain('katex-display')
  })

  it('坏公式 ok=false，不抛错；页面退回原文 + 轻提示', () => {
    const out = renderMath('\\frac{1}{')
    expect(out.ok).toBe(false)
    expect(out.html).toBe('')
    expect(MATH_RENDER_FAILED_HINT).toContain('先看原文')
  })

  it('长行内公式要走横向滚动', () => {
    expect(isLongInlineMath('x')).toBe(false)
    expect(isLongInlineMath('\\sum_{k=1}^{n}\\frac{1}{k^2+k}=1-\\frac{1}{n+1}')).toBe(true)
  })
})

