import { describe, expect, it } from 'vitest'
import { extractMath, parseMathText, toPlainText } from '@proof-gym/ui-math/mathText'

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
