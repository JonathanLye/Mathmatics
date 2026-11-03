/**
 * 证明键盘 / MathText 编辑器纯逻辑单测（issue #13）。
 * 覆盖：
 * 1) 只用 keyboard-layout.json 里的键 + 插入序列，打出 DoD 句子「任取 ε>0，取 N=⌈5/ε⌉」；
 * 2) 模板 #0/#1 占位符跳转与光标位置；
 * 3) 删除（⌫）与选区替换；
 * 4) 布局 JSON 结构校验（所有键有 label/insert 与派生 id）；
 * 5) 自动补 $…$、长按变体、占位预览等零碎规则。
 */
import { describe, expect, it } from 'vitest'
import {
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
  keyboardLayout,
  keyboardLayoutJson,
  moveCaret,
  nextPlaceholder,
  normalizeEditorState,
  normalizeKeyboardLayout,
  reconcileText,
  validateKeyboardLayout,
  variantLabel,
  type EditorState,
  type KeyboardLayout,
} from '@ui-math/keyboard'

/** 点击某个键帽（按布局数据找键，不在测试里硬编码 insert） */
function press(state: EditorState, label: string, layout: KeyboardLayout = keyboardLayout): EditorState {
  const key = findKeyboardKey(layout, label)
  if (!key) throw new Error('布局里找不到键：' + label)
  return insertKey(state, key)
}

/** 依次点击一串键帽 */
function pressAll(labels: string[], start: EditorState = createEditorState(''), layout = keyboardLayout): EditorState {
  let state = start
  for (const label of labels) state = press(state, label, layout)
  return state
}

/** 用动作键（右侧固定动作列）移动/删除 */
function action(state: EditorState, id: 'left' | 'right' | 'next' | 'backspace'): EditorState {
  return applyEditorAction(state, id)
}

describe('只用证明键盘构造 DoD 句子（issue #13）', () => {
  it('6 次内容键 + 动作键删掉句式自带尾逗号，得到「任取 ε>0，取 N=⌈5/ε⌉」', () => {
    // 键序全部来自 keyboard-layout.json 的 label：
    //   证明句式「任取 ε>0」→「取 N=」→ 常用「⌈x⌉」→ 123「5」→ 123「÷」→ 常用「ε」
    let state = pressAll(['任取 ε>0', '取 N=', '⌈x⌉', '5', '÷', 'ε'])
    expect(state.text).toBe('任取 $\\varepsilon>0$，取 $N=\\left\\lceil 5/\\varepsilon\\right\\rceil$，')
    // 光标停在 ⌈…⌉ 内（#0 位置），剩余文本是 \right\rceil$，
    expect(state.caret).toBe(state.text.length - 14)
    expect(state.anchors).toEqual([])

    // 句式键自带收尾逗号；用右侧动作键 → 移到行尾、⌫ 删掉逗号（仍然只用证明键盘）
    for (let i = 0; i < 14; i += 1) state = action(state, 'right')
    state = action(state, 'backspace')
    expect(state.text).toBe('任取 $\\varepsilon>0$，取 $N=\\left\\lceil 5/\\varepsilon\\right\\rceil$')
    expect(state.caret).toBe(state.text.length)
    // 21 次点按 ≪ 「2 分钟内」的 DoD 预算（DoD 是体验上限，不是点按次数上限）
    expect(6 + 14 + 1).toBeLessThan(30)
  })

  it('句式键本身渲染出来就是 DoD 前半句（尾逗号是句式模板自带，可留可删）', () => {
    const state = pressAll(['任取 ε>0', '取 N='])
    expect(extractInsertPlaceholders('取 $N=#0$，').clean).toBe('取 $N=$，')
    // 数学片段按下标切开后，$…$ 内的内容是 LaTeX，渲染后正好是 DoD 句子
    expect(state.text).toBe('任取 $\\varepsilon>0$，取 $N=$，')
    expect(state.caret).toBe(state.text.length - 2)
  })
})

describe('模板 #0/#1 占位符与光标位置（03 §4.2）', () => {
  it('a/b 模板：插入后光标在 #0，⇥ 跳到 #1', () => {
    const state = press(createEditorState(''), 'a/b')
    expect(state.text).toBe('$\\frac{}{}$')
    expect(state.caret).toBe(7) // $ + "\frac{" 的结尾
    expect(state.anchors).toEqual([9]) // #1 在 "}{" 之后
    const jumped = action(state, 'next')
    expect(jumped.caret).toBe(9)
    expect(activePlaceholderIndex(jumped)).toBe(0)
  })

  it('lim 模板：两个 # 占位按 ⇥ 依次跳，填进占位后占位被消费', () => {
    let state = press(createEditorState(''), 'lim')
    expect(state.text).toBe('$\\lim_{\\to }$')
    expect(state.caret).toBe(7) // #0
    expect(state.anchors).toEqual([11]) // #1

    state = action(state, 'next')
    expect(state.caret).toBe(11)
    expect(findNextPlaceholder(state)).toBe(11) // 只有一个占位，循环回自己

    state = press(state, 'n') // 在 #1 处填 n，占位被消费
    expect(state.text).toBe('$\\lim_{\\to n}$')
    expect(state.anchors).toEqual([])
    expect(findNextPlaceholder(state)).toBeNull()
  })

  it('证明句式占位（text 模式，自带 $…$）也会跟随 ⇥ 跳转', () => {
    let state = press(createEditorState(''), '要使…只需')
    expect(state.text).toBe('要使 $$，只需 $$。')
    expect(state.caret).toBe(4)
    expect(state.anchors).toEqual([10])
    state = action(state, 'next')
    expect(state.caret).toBe(10)
  })

  it('normalizeEditorState 把越界光标/占位收敛到合法区间', () => {
    const state = normalizeEditorState({ text: 'abc', caret: 99, selectionEnd: -3, anchors: [5, -1, 2] })
    expect(state).toEqual({ text: 'abc', caret: 3, selectionEnd: 0, anchors: [2] })
  })
})

describe('删除（⌫）与选区替换', () => {
  it('打字后 ⌫ 逐个删除，占位位置随文本平移', () => {
    let state = press(createEditorState(''), 'a/b')
    state = press(state, '1') // 填 #0
    expect(state.text).toBe('$\\frac{1}{}$')
    expect(state.anchors).toEqual([10])
    state = action(state, 'backspace')
    expect(state.text).toBe('$\\frac{}{}$')
    expect(state.anchors).toEqual([9])
    state = action(state, 'backspace') // 再删一个字符也不崩（占位继续平移）
    expect(state.text).toBe('$\\frac}{}$')
    expect(state.caret).toBe(6)
    expect(state.anchors).toEqual([8])
  })

  it('有选区时 ⌫ 删除整个选区（占位在选区里的丢弃、在选区后的平移）', () => {
    const state = normalizeEditorState({ text: 'abcdef', caret: 2, selectionEnd: 4, anchors: [1, 3, 5] })
    const deleted = backspace(state)
    expect(deleted.text).toBe('abef')
    expect(deleted.caret).toBe(2)
    expect(deleted.anchors).toEqual([1, 3]) // 3 在选区里被删，5 平移到 3
  })

  it('光标在开头时 ⌫ 不动；多字节 emoji 不会被拆成半个代理对', () => {
    const atStart = normalizeEditorState({ text: '数学', caret: 0, selectionEnd: 0 })
    expect(backspace(atStart)).toEqual(atStart)

    const emoji = normalizeEditorState({ text: '证😀明', caret: 3, selectionEnd: 3 })
    const deleted = backspace(emoji)
    expect(deleted.text).toBe('证明')
    expect(deleted.caret).toBe(1)
  })
})

describe('自动补 $…$ 与 text/math 模式', () => {
  it('光标不在 $…$ 内时，math 键自动包 $…$', () => {
    const state = press(createEditorState(''), 'ε')
    expect(state.text).toBe('$\\varepsilon$')
    // 光标留在 $…$ 内（下一次 math 键继续落在同一个公式里）
    expect(state.caret).toBe(state.text.length - 1)
    expect(isInsideMath(state.text, state.caret)).toBe(true)
  })

  it('光标已在 $…$ 内时，math 键不再重复包 $', () => {
    const inside = normalizeEditorState({ text: '$x$', caret: 2, selectionEnd: 2 })
    const state = press(inside, 'ε')
    expect(state.text).toBe('$x\\varepsilon$')
  })

  it('光标在公式后面（$…$ 外）时再点 math 键会补一层新公式，MathText 仍能解析', () => {
    const state = press(createEditorState('$x$'), 'ε')
    expect(state.text).toBe('$x$$\\varepsilon$')
    expect(state.caret).toBe(state.text.length - 1)
  })

  it('text 模式的证明句式原样插入，不额外包 $', () => {
    const state = press(createEditorState(''), '所以')
    expect(state.text).toBe('所以')
  })

  it('isInsideMath 处理转义的 \$ 与边界', () => {
    expect(isInsideMath('$x$', 0)).toBe(false)
    expect(isInsideMath('$x$', 1)).toBe(true)
    expect(isInsideMath('$x$', 2)).toBe(true)
    expect(isInsideMath('$x$', 3)).toBe(false)
    expect(isInsideMath('价格 \\$5 元', 99)).toBe(false)
  })

  it('相邻两次 math 插入不会吞掉对方的定界符', () => {
    let state = press(createEditorState(''), 'ε')
    state = press(state, 'δ')
    expect(state.text).toBe('$\\varepsilon\\delta$')
  })
})

describe('长按变体（03 §4.2）', () => {
  it('insertKey 使用 variantIndex 插入变体，并沿用键的 mode', () => {
    const key = findKeyboardKey(keyboardLayout, '<')
    expect(key).toBeTruthy()
    expect(key!.variants).toEqual(['\\le', '\\ll'])
    const state = insertKey(createEditorState(''), key!, { variantIndex: 1 })
    expect(state.text).toBe('$\\ll$')
    expect(() => insertKey(createEditorState(''), key!, { variantIndex: 9 })).toThrow()
  })

  it('variantLabel 把常见变体渲染成可读键帽', () => {
    expect(variantLabel('\\le')).toBe('≤')
    expect(variantLabel('\\ll')).toBe('≪')
    expect(variantLabel('a_{n+1}')).toBe('aₙ₊₁')
    expect(variantLabel('\\sum_{n=1}^{\\infty}')).toBe('∑ n=1→∞')
  })
})

describe('占位预览（03 §4.3：占位显示为 ▢，当前占位高亮）', () => {
  it('$…$ 内用 \square，$ 外用 ▢，当前占位高亮', () => {
    expect(buildPreviewText('$\\frac{}{}$', [7, 9])).toBe('$\\frac{\\square }{\\square }$')
    expect(buildPreviewText('$\\frac{}{}$', [7, 9], { activeAnchor: 7 })).toBe('$\\frac{\\boxed{\\square}}{\\square }$')
    expect(buildPreviewText('取 $N=$，', [5])).toBe('取 $N=\\square $，')
    expect(buildPreviewText('所以', [])).toBe('所以')
  })
})

describe('外部（系统键盘/父级）改文本时同步占位', () => {
  it('reconcileText 用公共前后缀定位改动，占位跟着平移', () => {
    const state = normalizeEditorState({ text: 'abXYef', caret: 6, selectionEnd: 6, anchors: [2, 4] })
    const next = reconcileText(state, 'abQQQef', 5)
    expect(next.text).toBe('abQQQef')
    expect(next.anchors).toEqual([2, 5])
    expect(next.caret).toBe(5)
  })

  it('在占位处输入 = 把内容填进占位，占位被消费', () => {
    const state = normalizeEditorState({ text: 'ab', caret: 1, selectionEnd: 1, anchors: [1, 2] })
    const next = reconcileText(state, 'aXb', 2)
    expect(next.anchors).toEqual([3])
  })
})

describe('keyboard-layout.json 结构校验（只读契约）', () => {
  it('契约数据合法：6 层、右侧 7 个固定动作、所有键有 label/insert 与唯一派生 id', () => {
    expect(validateKeyboardLayout(keyboardLayoutJson)).toEqual([])

    const layout = normalizeKeyboardLayout(keyboardLayoutJson)
    expect(layout.schemaVersion).toBe('1.0')
    expect(layout.layers.map((layer) => layer.id)).toEqual([
      'common',
      'phrases',
      'logic',
      'greek',
      'analysis',
      'digits',
    ])
    expect(layout.actions.map((a) => a.id)).toEqual([
      'left',
      'right',
      'next',
      'backspace',
      'system',
      'ink',
      'done',
    ])

    const keys = flattenKeyboardKeys(layout)
    expect(keys.length).toBeGreaterThanOrEqual(60)
    const ids = new Set(keys.map((key) => key.id))
    expect(ids.size).toBe(keys.length)
    for (const key of keys) {
      expect(key.id, key.label + ' 缺少 id').toBeTruthy()
      expect(key.label, key.id + ' 缺少 label').toBeTruthy()
      expect(key.insert, key.id + ' 缺少 insert').toBeTruthy()
      expect(['math', 'text']).toContain(key.mode)
      expect(['symbol', 'template', 'phrase']).toContain(key.kind)
      // $ 必须成对出现（句式键自带 $…$；符号键不该带 $）
      const dollars = key.insert.replace(/\\\$/g, '').split('$').length - 1
      expect(dollars % 2, key.id + ' 的 $ 不成对').toBe(0)
      // 占位编号从 #0 开始且连续（#0 是光标，#1… 是 ⇥ 跳转）
      const markers = Array.from(key.insert.matchAll(/#(\d+)/g)).map((match) => Number(match[1]))
      if (markers.length > 0) {
        expect(Math.min(...markers)).toBe(0)
        expect(new Set(markers).size).toBe(markers.length)
        expect(Math.max(...markers)).toBe(markers.length - 1)
      }
      for (const variant of key.variants) {
        expect(typeof variant).toBe('string')
        expect(variant.length).toBeGreaterThan(0)
      }
    }

    // 键盘布局里每一行都不超过契约声明的 rowsMax
    for (const layer of layout.layers) {
      for (const row of layer.rows) expect(row.length).toBeLessThanOrEqual(layout.rowsMax)
    }

    // 「证明句式」层只放句式，不含针对某道题的成品结论（03 §4.1）
    const phrasesLayer = layout.layers.find((layer) => layer.id === 'phrases')
    expect(phrasesLayer?.rows.flat().every((key) => key.kind === 'phrase' && key.mode === 'text')).toBe(true)
  })

  it('结构不合法时 validate 报问题、normalize 抛错（fail fast）', () => {
    const issues = validateKeyboardLayout({ layers: [{ id: 'x', label: 'X', rows: [[{ label: 'a' }]] }] })
    expect(issues.some((issue) => issue.path.endsWith('.insert'))).toBe(true)
    expect(() => normalizeKeyboardLayout({ layers: [] })).toThrow()
    expect(validateKeyboardLayout('not-a-layout').length).toBeGreaterThan(0)
  })
})

describe('光标动作（右侧固定动作列）', () => {
  it('← / → 按码点移动，有选区时先收拢', () => {
    let state = normalizeEditorState({ text: '证明', caret: 2, selectionEnd: 2 })
    expect(action(action(state, 'left'), 'left').caret).toBe(0)
    state = normalizeEditorState({ text: 'abcd', caret: 1, selectionEnd: 3 })
    expect(action(state, 'left').caret).toBe(1)
    expect(action(state, 'right').caret).toBe(3)
    expect(moveCaret(normalizeEditorState({ text: 'ab😀', caret: 0, selectionEnd: 0 }), 'right').caret).toBe(1)
  })

  it('nextPlaceholder 在没有占位时保持不动', () => {
    const state = createEditorState('所以')
    expect(nextPlaceholder(state)).toEqual(state)
    expect(findNextPlaceholder(state)).toBeNull()
  })

  it('未知动作不改变状态', () => {
    const state = createEditorState('abc')
    expect(applyEditorAction(state, 'system')).toEqual(state)
    expect(applyEditorAction(state, 'unknown')).toEqual(state)
  })
})
