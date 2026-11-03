/**
 * 识别确认纯逻辑单测（issue #15）。
 * 覆盖：服务端 diff → 交叉路文本/高亮位置、服务端 agree/status → 横幅与直接确认分支、
 * 逐处选左/选右合并、MathText 片段渲染与识别状态提示。
 * 注意：一致性判定在服务端（canon 在 packages/contracts/tools），前端不做归一化/LCS，
 * 因此这里不再测 normalizeRecognitionText / diffRecognitionTexts，只测「读服务端字段 + 渲染 + 合并」。
 */
import { describe, expect, it } from 'vitest'
import {
  alternativeDisplayText,
  buildAlternativeText,
  buildRecognitionView,
  diffHighlights,
  isInsideMathRange,
  mergeRecognitionResult,
  recognitionStatusHint,
  recognitionSummary,
  toMathFragment,
} from '@ui-math/recognition'

/** 与 mockRecognition 相同的形状：主结果 + 服务端 diff（[9,22) 是 '\frac{5}{n+2}'） */
const PRIMARY = '$|a_n-3|=\\frac{5}{n+2}$'
const PRIMARY_DIFF = [{ start: 9, end: 22, alt: '\\frac{5}{n+z}' }]

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

  it('mock 形状：右路由 diff.alt 还原（坐标与主结果一致）', () => {
    expect(PRIMARY.slice(9, 22)).toBe('\\frac{5}{n+2}')
    expect(buildAlternativeText(PRIMARY, PRIMARY_DIFF)).toBe('$|a_n-3|=\\frac{5}{n+z}$')
  })
})

describe('diffHighlights：高亮位置只来自服务端 diff', () => {
  it('按主结果坐标切出片段与右路文本', () => {
    const highlights = diffHighlights(PRIMARY, PRIMARY_DIFF)
    expect(highlights).toHaveLength(1)
    expect(highlights[0]).toMatchObject({
      index: 0,
      start: 9,
      end: 22,
      primary: '\\frac{5}{n+2}',
      alternative: '\\frac{5}{n+z}',
    })
  })

  it('多段、插入、越界与重叠（坐标保护，不做文本比较）', () => {
    expect(
      diffHighlights('abc', [
        { start: 0, end: 1, alt: 'A' },
        { start: 2, end: 3, alt: 'C' },
      ]).map((item) => [item.start, item.end, item.primary, item.alternative]),
    ).toEqual([
      [0, 1, 'a', 'A'],
      [2, 3, 'c', 'C'],
    ])
    expect(diffHighlights('ab', [{ start: 1, end: 1, alt: '-' }])[0]).toMatchObject({ start: 1, end: 1, primary: '', alternative: '-' })
    expect(diffHighlights('abc', [{ start: 2, end: 99, alt: 'Z' }])[0]).toMatchObject({ start: 2, end: 3, primary: 'c', alternative: 'Z' })
    // 重叠：长的保留，短的丢弃
    expect(diffHighlights('abcd', [{ start: 0, end: 3, alt: 'Q' }, { start: 1, end: 2, alt: 'X' }]).map((item) => [item.start, item.end])).toEqual([
      [0, 3],
    ])
  })

  it('没有 diff 时不产生高亮', () => {
    expect(diffHighlights('abc')).toEqual([])
    expect(diffHighlights('abc', [])).toEqual([])
  })
})

describe('buildRecognitionView：横幅/分支/高亮全部由服务端字段决定', () => {
  it('agree=false + diff：高亮来自 diff，前端不自行比对两路文本', () => {
    const view = buildRecognitionView({ status: 'ok', text: PRIMARY, agree: false, diff: PRIMARY_DIFF })
    expect(view.agree).toBe(false)
    expect(view.simple).toBe(false)
    expect(view.hasDiff).toBe(true)
    expect(view.conflicts).toHaveLength(1)
    expect(view.conflicts[0]?.primary).toBe('\\frac{5}{n+2}')
    expect(view.alternative).toBe('$|a_n-3|=\\frac{5}{n+z}$')
  })

  it('agree=false 但服务端没给 diff：不产生高亮（前端不猜）', () => {
    const view = buildRecognitionView({ status: 'ok', text: PRIMARY, agree: false })
    expect(view.conflicts).toEqual([])
    expect(view.alternative).toBe(PRIMARY)
    expect(recognitionSummary(view)).toContain('请核对后确认')
  })

  it('agree=true + status=ok：进入直接确认分支（单按钮），不消费 diff', () => {
    // 即便 diff 里给了差异，服务端已判一致 → 前端按服务端结论直接显示
    const view = buildRecognitionView({ status: 'ok', text: '$\\varepsilon>0$', agree: true, diff: [{ start: 1, end: 2, alt: 'x' }] })
    expect(view.simple).toBe(true)
    expect(view.conflicts).toEqual([])
    expect(recognitionSummary(view)).toBe('两路识别一致')
  })

  it('agree=null（单路，服务端没做交叉比对）：不显示一致/不一致，也不进直接确认分支', () => {
    const view = buildRecognitionView({ status: 'ok', text: '$x$' })
    expect(view.agree).toBeNull()
    expect(view.simple).toBe(false)
    expect(view.conflicts).toEqual([])
    expect(recognitionSummary(view)).toBe('')
  })

  it('status=low_confidence：横幅说明识别没成功，直接确认分支关闭', () => {
    const view = buildRecognitionView({ status: 'low_confidence', text: '$x$', agree: true })
    expect(view.simple).toBe(false)
    expect(recognitionSummary(view)).toBe('识别没有成功')
  })

  it('空识别结果不抛错', () => {
    const view = buildRecognitionView({ status: 'empty' })
    expect(view.primary).toBe('')
    expect(view.conflicts).toEqual([])
    expect(view.status).toBe('empty')
    expect(view.simple).toBe(false)
  })
})

describe('recognitionSummary：02 §4.6 横幅只读服务端 agree', () => {
  it('两路一致', () => {
    expect(recognitionSummary({ status: 'ok', agree: true, conflicts: [] })).toBe('两路识别一致')
  })

  it('不一致且服务端给了 N 处 diff：给出 N', () => {
    const view = buildRecognitionView({
      status: 'ok',
      text: 'aXbYc',
      agree: false,
      diff: [
        { start: 1, end: 2, alt: 'P' },
        { start: 3, end: 4, alt: 'Q' },
      ],
    })
    expect(recognitionSummary(view)).toBe('两路识别不一致 · 请核对高亮的 2 处')
  })

  it('status 非 ok 时显示识别没有成功', () => {
    expect(recognitionSummary({ status: 'error', agree: null, conflicts: [] })).toBe('识别没有成功')
  })
})

describe('mergeRecognitionResult：逐处选左/选右', () => {
  const view = buildRecognitionView({
    status: 'ok',
    text: 'aXbYc',
    agree: false,
    diff: [
      { start: 1, end: 2, alt: 'P' },
      { start: 3, end: 4, alt: 'Q' },
    ],
  })

  it('默认全选左 = 主结果原文', () => {
    expect(view.conflicts).toHaveLength(2)
    expect(mergeRecognitionResult(view.primary, view.conflicts)).toBe('aXbYc')
    expect(mergeRecognitionResult(view.primary, view.conflicts, ['primary', 'primary'])).toBe('aXbYc')
  })

  it('全选右 = 服务端 diff.alt 还原的交叉路文本', () => {
    expect(mergeRecognitionResult(view.primary, view.conflicts, ['alternative', 'alternative'])).toBe('aPbQc')
  })

  it('混合选择按冲突下标替换（坐标不串位）', () => {
    expect(mergeRecognitionResult(view.primary, view.conflicts, ['primary', 'alternative'])).toBe('aXbQc')
    expect(mergeRecognitionResult(view.primary, view.conflicts, ['alternative', 'primary'])).toBe('aPbYc')
  })

  it('没有冲突时原样返回', () => {
    expect(mergeRecognitionResult('$x$', [])).toBe('$x$')
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
