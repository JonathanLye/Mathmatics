/**
 * MathText 解析：中文 + LaTeX → 片段数组。
 * 纯函数、无 DOM 依赖，可被小程序端复用（03 §5）。只影响展示，不改存储格式，也不碰 canon()。
 *
 * 定界符：$…$、$$…$$、\(…\)、\[…\]；后两组和 $$ 里的是独立成行的公式（display）。
 * 规则：
 * - \$ 是转义的字面美元符；
 * - 未闭合的定界符按普通文本处理（渲染时回退为原文，绝不吞字）；
 * - 空公式 $$ 忽略；
 * - 模型输出常把 LaTeX 裸写在中文里（\varepsilon>0、|a_n-3|、JSON 多转义一层的 \\frac），
 *   这些片段也规范化成公式。只认已知命令和“单字母 + 下标/上标”，路径和 snake_case 不会被误伤。
 */
export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display?: true }

export function parseMathText(input: string): MathSegment[] {
  const text = String(input ?? '')
  const out: MathSegment[] = []
  if (!text) return out
  let buf = ''
  const flush = () => {
    if (buf) pushText(out, buf)
    buf = ''
  }
  const emit = (value: string, display: boolean) => {
    if (!value.trim()) return
    flush()
    out.push(display ? { kind: 'math', value, display: true } : { kind: 'math', value })
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '\\' && next === '$') {
      buf += '$'
      i += 2
      continue
    }
    if (ch === '\\' && (next === '(' || next === '[')) {
      const close = next === '(' ? '\\)' : '\\]'
      const end = text.indexOf(close, i + 2)
      if (end === -1) {
        buf += ch + next
        i += 2
        continue
      }
      emit(text.slice(i + 2, end), next === '[')
      i = end + 2
      continue
    }
    if (ch === '$' && next === '$') {
      const end = findDoubleClosing(text, i + 2)
      // 找不到收尾的 $$：当作空公式丢掉这两个符号，前后文本保持相连。
      if (end === -1) {
        i += 2
        continue
      }
      emit(text.slice(i + 2, end), true)
      i = end + 2
      continue
    }
    if (ch === '$') {
      const end = findClosing(text, i + 1)
      if (end === -1) {
        buf += ch
        i += 1
        continue
      }
      emit(text.slice(i + 1, end), false)
      i = end + 1
      continue
    }
    buf += ch
    i += 1
  }
  flush()
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

function findDoubleClosing(text: string, from: number): number {
  let i = from
  while (i < text.length - 1) {
    if (text[i] === '\\' && text[i + 1] === '$') { i += 2; continue }
    if (text[i] === '$' && text[i + 1] === '$') return i
    i += 1
  }
  return -1
}

/** 相邻文本合并；文本里的裸 LaTeX 在这里拆成公式片段。 */
function pushText(out: MathSegment[], value: string): void {
  for (const seg of normalizeBareLatex(value)) {
    const last = out[out.length - 1]
    if (seg.kind === 'text' && last?.kind === 'text') last.value += seg.value
    else out.push(seg)
  }
}

/** 模型输出里常见的 LaTeX 命令白名单：不在表里的（如 C:\Users）不当公式。 */
const KNOWN_COMMANDS = new Set(
  (
    'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega ' +
    'Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega ' +
    'frac dfrac tfrac sqrt sum prod int oint lim limsup liminf sup inf max min ' +
    'sin cos tan cot sec csc ln log exp arcsin arccos arctan ' +
    'infty partial nabla forall exists nexists in notin ni subset subseteq supset supseteq cup cap setminus emptyset varnothing ' +
    'leq le geq ge neq ne approx equiv sim simeq cong propto ll gg ' +
    'cdot times div pm mp circ ast ' +
    'to rightarrow leftarrow Rightarrow Leftarrow Leftrightarrow leftrightarrow implies iff mapsto uparrow downarrow ' +
    'left right big Big bigg Bigg lceil rceil lfloor rfloor langle rangle vert Vert mid ' +
    'dots ldots cdots vdots ddots quad qquad ' +
    'mathbb mathbf mathrm mathcal mathscr text operatorname ' +
    'overline underline hat bar vec tilde dot ddot widehat widetilde prime'
  ).split(' '),
)

/** 能出现在同一段公式里的字符（ASCII 数学字符和常见的 Unicode 数学符号）；中文和全角标点会截断。 */
const MATH_RUN = /[A-Za-z0-9_^{}()[\]|+\-*/=<>!,.:;'\\ \t∑∏∫√∞≤≥≠≈≡∈∉⊂⊆⊃⊇∪∩→←⇒⇐⇔↔↦∀∃∂∇αβγδεζηθλμνξπρστφχψωΓΔΘΛΞΠΣΦΨΩ·×÷±∘²³⌈⌉⌊⌋]+/g
const COMMAND = /\\{1,2}([A-Za-z]+)/g
/** 单字母（或右括号、绝对值竖线）紧跟 _ 或 ^，再跟字母、数字或 {：a_n、x^2、|x|^2、(a+b)^2。 */
const SUBSUP = /(?:^|[^A-Za-z])[A-Za-z][_^][A-Za-z0-9{]|[)|}][_^][A-Za-z0-9{]/

function hasKnownCommand(token: string): boolean {
  for (const m of token.matchAll(COMMAND)) {
    if (KNOWN_COMMANDS.has(m[1])) return true
  }
  return false
}

function looksLikeMath(token: string): boolean {
  return hasKnownCommand(token) || SUBSUP.test(token)
}

/** 普通单词或孤立标点：出现在公式片段两端时留给文本。 */
function isProseToken(token: string): boolean {
  return /^[A-Za-z]{2,}[,.:;!]*$/.test(token) || /^[,.:;!]+$/.test(token)
}

function isUrlLike(token: string): boolean {
  return /[a-z]+:\/\//i.test(token)
}

function unbalancedClosers(value: string): number {
  let depth = 0
  let extra = 0
  for (const ch of value) {
    if (ch === '(') depth += 1
    else if (ch === ')') {
      if (depth > 0) depth -= 1
      else extra += 1
    }
  }
  return extra
}

/** 把一段不含定界符的文本里的裸 LaTeX 拆成公式片段；没有裸 LaTeX 就原样返回。 */
export function normalizeBareLatex(text: string): MathSegment[] {
  if (!text) return []
  const out: MathSegment[] = []
  let cursor = 0
  const pushPlain = (value: string) => {
    if (!value) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.value += value
    else out.push({ kind: 'text', value })
  }

  for (const match of text.matchAll(MATH_RUN)) {
    const run = match[0]
    const runStart = match.index ?? 0
    const tokens = run.split(/(\s+)/)
    if (!tokens.some((t) => looksLikeMath(t) && !isUrlLike(t))) continue

    // 两端的英文单词和标点留给文本，中间的才算公式。
    let first = 0
    let last = tokens.length - 1
    while (first < last && (!tokens[first].trim() || (isProseToken(tokens[first]) && !looksLikeMath(tokens[first])))) first += 1
    while (last > first && (!tokens[last].trim() || (isProseToken(tokens[last]) && !looksLikeMath(tokens[last])))) last -= 1
    let core = tokens.slice(first, last + 1).join('')
    let coreStart = runStart + tokens.slice(0, first).join('').length

    // 粘在公式尾巴上的句读和多出来的右括号不属于公式（“见 a_n)”“|a_n|,”）。
    core = core.replace(/[,.:;!\s]+$/, '')
    let closers = unbalancedClosers(core)
    while (closers > 0 && core.endsWith(')')) {
      core = core.slice(0, -1)
      closers -= 1
    }
    const leading = core.match(/^[,.:;!\s]+/)?.[0].length ?? 0
    core = core.slice(leading)
    coreStart += leading
    if (!core || !looksLikeMath(core)) continue

    pushPlain(text.slice(cursor, coreStart))
    // JSON 多转义一层的 \\frac 还原成 \frac；真正的换行 \\ 后面不跟字母，不受影响。
    out.push({ kind: 'math', value: core.replace(/\\\\(?=[A-Za-z])/g, '\\') })
    cursor = coreStart + core.length
  }
  pushPlain(text.slice(cursor))
  return out
}

/** 提取所有公式（闸门/搜索/键盘测试用） */
export function extractMath(input: string): string[] {
  return parseMathText(input).filter((s): s is Extract<MathSegment, { kind: 'math' }> => s.kind === 'math').map((s) => s.value)
}

/** 纯文本化（去掉公式定界符），供 loading/空态或 mp 回退渲染 */
export function toPlainText(input: string): string {
  return parseMathText(input).map((s) => s.value).join('')
}
