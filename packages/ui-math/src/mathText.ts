/**
 * MathText 解析：中文 + \$…\$ 行内 LaTeX → 片段数组。
 * 纯函数、无 DOM 依赖，可被小程序端复用（03 §5）。
 * 规则：
 * - \$ 是转义的字面美元符；
 * - 未闭合的 \$ 按普通文本处理（渲染时回退为原文，绝不吞字）；
 * - 空公式 \$\$ 忽略。
 */
export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string }

export function parseMathText(input: string): MathSegment[] {
  const text = String(input ?? '')
  const out: MathSegment[] = []
  if (!text) return out
  let buf = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && text[i + 1] === '$') {
      buf += '$'
      i += 2
      continue
    }
    if (ch === '$') {
      const end = findClosing(text, i + 1)
      if (end === -1) {
        buf += ch
        i += 1
        continue
      }
      // 空公式 $ 忽略，但不要把前后的文本切断（保持相邻文本合并）
      const value = text.slice(i + 1, end)
      if (value.trim()) {
        if (buf) { out.push({ kind: 'text', value: buf }); buf = '' }
        out.push({ kind: 'math', value })
      }
      i = end + 1
      continue
    }
    buf += ch
    i += 1
  }
  if (buf) out.push({ kind: 'text', value: buf })
  return out
}

function findClosing(text: string, from: number): number {
  let i = from
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') { i += 2; continue }
    if (text[i] === '$') return i
    i += 1
  }
  return -1
}

/** 提取所有行内公式（闸门/搜索/键盘测试用） */
export function extractMath(input: string): string[] {
  return parseMathText(input).filter((s): s is { kind: 'math'; value: string } => s.kind === 'math').map((s) => s.value)
}

/** 纯文本化（去掉公式定界符），供 loading/空态或 mp 回退渲染 */
export function toPlainText(input: string): string {
  return parseMathText(input).map((s) => (s.kind === 'math' ? s.value : s.value)).join('')
}
