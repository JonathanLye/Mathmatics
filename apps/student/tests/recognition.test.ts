/**
 * 识别确认纯逻辑单测（issue #15）。
 * 覆盖：两路文本 diff（一致/插入/删除/多段/完全不同）、空白与 LaTeX 归一化、
 * 主结果 + 服务端 diff 还原交叉路、逐处选左/选右合并、MathText 片段渲染与识别状态提示。
 */
import { describe, expect, it } from 'vitest'
import {
  alternativeDisplayText,
  buildAlternativeText,
  compareRecognition,
  diffRecognitionTexts,
  isInsideMathRange,
  mergeRecognitionResult,
  normalizeRecognitionText,
  recognitionStatusHint,
  toMathFragment,
} from '@ui-math/recognition'

describe('normalizeRecognitionText：空白与 LaTeX 差异归一化', () => {
  it('去掉 $ 定界符与空白', () => {
    expect(normalizeRecognitionText('$\\frac{5}{n+2}$')).toBe('\\frac{5}{n+2}')
    expect(normalizeRecognitionText('取 $N$，当 $n>N$ 时')).toBe('取N，当n>N时')
    expect(normalizeRecognitionText('a  b\tc\n')).toBe('abc')
    expect(normalizeRecognitionText('a\u3000b\u00a0c')).toBe('abc')
  })

  it('转义美元符保留为字面 $', () => {
    expect(normalizeRecognitionText('价格 \\$5')).toBe('价格$5')
  })

  it('常见等价 LaTeX 写法归一（\\left/\\right、\\dfrac、\\le/\\leq…）', () => {
    expect(normalizeRecognitionText('$\\left|x\\right|$')).toBe('|x|')
    expect(normalizeRecognitionText('$\\dfrac{1}{2}$')).toBe(normalizeRecognitionText('$\\frac{1}{2}$'))
    expect(normalizeRecognitionText('$a\\le b$')).toBe(normalizeRecognitionText('$a\\leq b$'))
    expect(normalizeRecognitionText('$a\\to b$')).toBe(normalizeRecognitionText('$a\\rightarrow b$'))
    expect(normalizeRecognitionText('$a\\ne b$')).toBe(normalizeRecognitionText('$a\\neq b$'))
    expect(normalizeRecognitionText('$a\\cdots b$')).toBe(normalizeRecognitionText('$a...b$'))
    // 只做写法归一，不做数学等价：\\frac{a}{b} 与 a/b 仍不同
    expect(normalizeRecognitionText('$\\frac{a}{b}$')).not.toBe(normalizeRecognitionText('a/b'))
  })
})

describe('buildAlternativeText：主结果 + 服务端 diff 还原交叉路', () => {
  it('单段替换', () => {
    expect(buildAlternativeText('abc', [{ start: 1, end: 2, alt: 'X' }])).toBe('aXc')
  })

  it('多段替换按坐标一次完成', () => {
    expect(
      buildAlternativeText('abcd', [
        { start: 1, end: 2, alt: 'X' },
        { start: 2, end: 3, alt: 'Y' },
      ]),
    ).toBe('aXYd')
  })

  it('插入（start === end）与非法/重叠片段', () => {
    expect(buildAlternativeText('ab', [{ start: 1, end: 1, alt: '-' }])).toBe('a-b')
    // 重叠：第一个 (0,3) 覆盖后，第二个 (1,2) 被忽略
    expect(
      buildAlternativeText('abcd', [
        { start: 0, end: 3, alt: 'Q' },
        { start: 1, end: 2, alt: 'X' },
      ]),
    ).toBe('Qd')
    // 越界坐标裁到文本长度，不抛错
    expect(buildAlternativeText('abc', [{ start: 2, end: 99, alt: 'Z' }])).toBe('abZ')
    expect(buildAlternativeText('abc', [])).toBe('abc')
  })
})

describe('diffRecognitionTexts：一致/不一致片段切分', () => {
  it('完全一致：单个 same 片段、无冲突', () => {
    const segments = diffRecognitionTexts('abc', 'abc')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ kind: 'same', primary: 'abc', alternative: 'abc', rawEqual: true })
  })

  it('插入：中间多出一个字符', () => {
    const segments = diffRecognitionTexts('abcd', 'abXcd')
    expect(segments.map((s) => s.kind)).toEqual(['same', 'diff', 'same'])
    expect(segments[0]?.primary).toBe('ab')
    expect(segments[1]).toMatchObject({ kind: 'diff', primary: '', alternative: 'X' })
    expect(segments[2]?.primary).toBe('cd')
    expect(segments[1]?.primaryStart).toBe(2)
    expect(segments[1]?.primaryEnd).toBe(2)
  })

  it('删除：主结果多出一个字符', () => {
    const segments = diffRecognitionTexts('abXcd', 'abcd')
    expect(segments[1]).toMatchObject({ kind: 'diff', primary: 'X', alternative: '' })
    expect(segments[1]?.primaryStart).toBe(2)
    expect(segments[1]?.primaryEnd).toBe(3)
  })

  it('只差空白与 $ 定界符时归一化为一致，不高亮', () => {
    const segments = diffRecognitionTexts('$x + y$', 'x+y')
    expect(segments).toHaveLength(1)
    expect(segments[0]?.kind).toBe('same')
    expect(segments[0]?.rawEqual).toBe(false)
  })

  it('多段冲突：两处分别切出', () => {
    const segments = diffRecognitionTexts('aXbYc', 'aPbQc')
    expect(segments.map((s) => s.kind)).toEqual(['same', 'diff', 'same', 'diff', 'same'])
    const conflicts = segments.filter((s) => s.kind === 'diff')
    expect(conflicts.map((s) => [s.primary, s.alternative])).toEqual([
      ['X', 'P'],
      ['Y', 'Q'],
    ])
  })

  it('完全不同：整段一个冲突', () => {
    const segments = diffRecognitionTexts('abc', 'XYZ')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ kind: 'diff', primary: 'abc', alternative: 'XYZ' })
  })
})

describe('compareRecognition：两路结果组装', () => {
  it('用服务端 diff 构造交叉路并给出冲突位置', () => {
    const primary = '$|a_n-3|=\\frac{5}{n+2}$'
    const comparison = compareRecognition({
      status: 'ok',
      text: primary,
      agree: false,
      diff: [{ start: 6, end: 11, alt: '5/(n+z)' }],
    })
    expect(comparison.primary).toBe(primary)
    expect(comparison.alternative).toBe('$|a_n-5/(n+z)rac{5}{n+2}$')
    expect(comparison.identical).toBe(false)
    expect(comparison.equal).toBe(false)
    expect(comparison.serverAgree).toBe(false)
    expect(comparison.conflicts.length).toBeGreaterThan(0)
    const first = comparison.conflicts[0]
    expect(first?.start).toBeGreaterThanOrEqual(0)
    expect(first?.end).toBeGreaterThanOrEqual(first?.start as number)
    expect(comparison.segments[first?.segmentIndex as number]?.kind).toBe('diff')
  })

  it('没有 diff 时回退到 lines[1] | 只有一路时视为一致', () => {
    const withTwoLines = compareRecognition({ status: 'ok', text: 'ab', lines: [{ text: 'ab' }, { text: 'aXb' }] })
    expect(withTwoLines.alternative).toBe('aXb')
    expect(withTwoLines.conflicts).toHaveLength(1)
    expect(withTwoLines.conflicts[0]?.alternative).toBe('X')

    const oneRoute = compareRecognition({ status: 'ok', text: '$x$', lines: [{ text: '$x$' }] })
    expect(oneRoute.equal).toBe(true)
    expect(oneRoute.conflicts).toEqual([])
    expect(oneRoute.serverAgree).toBeNull()
  })

  it('服务端 agree=false 但归一化后一致时，以归一化结果为准（不误报）', () => {
    const comparison = compareRecognition({ status: 'ok', text: '$\\frac{1}{2}$', agree: false, diff: [{ start: 1, end: 1, alt: '' }] })
    expect(comparison.equal).toBe(true)
    expect(comparison.serverAgree).toBe(false)
  })

  it('空识别结果不抛错', () => {
    const comparison = compareRecognition({ status: 'empty' })
    expect(comparison.primary).toBe('')
    expect(comparison.equal).toBe(true)
    expect(comparison.status).toBe('empty')
  })
})

describe('mergeRecognitionResult：逐处选左/选右', () => {
  const comparison = compareRecognition({
    status: 'ok',
    text: 'aXbYc',
    diff: [
      { start: 1, end: 2, alt: 'P' },
      { start: 3, end: 4, alt: 'Q' },
    ],
  })

  it('默认全选左 = 主结果原文', () => {
    expect(comparison.conflicts).toHaveLength(2)
    expect(mergeRecognitionResult(comparison)).toBe('aXbYc')
    expect(mergeRecognitionResult(comparison, ['primary', 'primary'])).toBe('aXbYc')
  })

  it('全选右 = 交叉路文本', () => {
    expect(mergeRecognitionResult(comparison, ['alternative', 'alternative'])).toBe('aPbQc')
  })

  it('混合选择按冲突下标替换（坐标不串位）', () => {
    expect(mergeRecognitionResult(comparison, ['primary', 'alternative'])).toBe('aXbQc')
    expect(mergeRecognitionResult(comparison, ['alternative', 'primary'])).toBe('aPbYc')
  })
})

describe('渲染辅助：MathText 片段与状态提示', () => {
  it('片段落在 $…$ 内时补定界符', () => {
    const text = '取 $N$，取'
    expect(toMathFragment(text, 3, 4)).toBe('$N$')
    expect(toMathFragment(text, 0, 1)).toBe('取')
    expect(toMathFragment('$x$', 0, 3)).toBe('$x$')
    expect(toMathFragment('abc', 2, 2)).toBe('')
  })

  it('isInsideMathRange 处理边界与转义美元符', () => {
    expect(isInsideMathRange('$N$', 1)).toBe(true)
    expect(isInsideMathRange('$N$', 0)).toBe(false)
    expect(isInsideMathRange('价格 \\$5', 3)).toBe(false)
  })

  it('右路 alt 按冲突所在上下文补 $…$', () => {
    expect(alternativeDisplayText('取 $N$，取', { start: 3, alternative: 'M' })).toBe('$M$')
    expect(alternativeDisplayText('取 $N$，取', { start: 0, alternative: '取' })).toBe('取')
    expect(alternativeDisplayText('取 $N$，取', { start: 3, alternative: '$M$' })).toBe('$M$')
  })

  it('识别状态提示不暗示对错、不替学生改正', () => {
    expect(recognitionStatusHint('low_confidence')).toContain('再写一次')
    expect(recognitionStatusHint('error')).toContain('再写一次')
    expect(recognitionStatusHint('empty')).toContain('没有识别到内容')
    expect(recognitionStatusHint('ok')).toBe('')
    expect(recognitionStatusHint('low_confidence')).not.toContain('错')
  })
})
