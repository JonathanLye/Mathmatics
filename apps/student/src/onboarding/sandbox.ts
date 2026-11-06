/**
 * 登录前“先试一道”的剧本：一道三行的小证明，走一遍“写一行 → 批注 → 求助 → 改写 → 完成”。
 * 纯前端，不发任何请求，也不带引擎：反馈都是写死的，所以界面上明说“这一行已替你写好”。
 */
export type SandboxPhase = 'write' | 'feedback' | 'ask' | 'fix' | 'finish' | 'done'
export type SandboxTone = 'ok' | 'sea'

export interface SandboxLine {
  statement: string
  justification: string
  tone: SandboxTone
  title: string
  body: string
  xp: number
}

export const SANDBOX_STEM = '用 $\\varepsilon$-$N$ 定义证明 $\\displaystyle\\lim_{n\\to\\infty}\\frac1n=0$。'

const LINE_1: SandboxLine = {
  statement: '任取 $\\varepsilon>0$。要使 $\\left|\\frac1n-0\\right|=\\frac1n<\\varepsilon$，只需 $n>\\frac1\\varepsilon$',
  justification: '化简后解出 $n$ 要满足的条件',
  tone: 'ok',
  title: '衔接上了',
  body: '你把目标变成了关于 $n$ 的条件，这是第一个关键步骤。',
  xp: 10,
}
const LINE_2_DRAFT: SandboxLine = {
  statement: '取 $N=\\frac1\\varepsilon$',
  justification: '由上一行',
  tone: 'sea',
  title: '助教想问',
  body: '$N$ 是项数。$\\frac1\\varepsilon$ 一定是整数吗？',
  xp: 0,
}
const LINE_2_FIXED: SandboxLine = {
  statement: '取 $N=\\left\\lceil\\frac1\\varepsilon\\right\\rceil$',
  justification: '向上取整后是正整数，而且只依赖 $\\varepsilon$',
  tone: 'ok',
  title: '衔接上了',
  body: '$N$ 只依赖 $\\varepsilon$，也确实是一个项数。',
  xp: 10,
}
const LINE_3: SandboxLine = {
  statement: '当 $n>N$ 时，$\\left|\\frac1n-0\\right|=\\frac1n<\\frac1N\\le\\varepsilon$',
  justification: '把前两行串起来，由定义得证',
  tone: 'ok',
  title: '衔接上了',
  body: '关键步骤都齐了，可以点“写完了”。',
  xp: 10,
}

export const SANDBOX_HELP_ANSWER =
  '项数要是正整数。把 $\\frac1\\varepsilon$ 向上取整，记作 $\\lceil\\frac1\\varepsilon\\rceil$，就一定是正整数了。接下来这一行由你来改。'

export interface SandboxState {
  phase: SandboxPhase
  /** 已经写下的行；第 2 行改写时原地替换。 */
  lines: SandboxLine[]
  /** 正在显示反馈的那一行。 */
  shown: SandboxLine | null
  helpAnswered: boolean
}

export function sandboxStart(): SandboxState {
  return { phase: 'write', lines: [], shown: null, helpAnswered: false }
}

/** 现在点“写下一行”会写哪一行。 */
export function sandboxNextLine(state: SandboxState): SandboxLine | null {
  if (state.phase === 'fix') return LINE_2_FIXED
  if (state.phase !== 'write') return null
  return [LINE_1, LINE_2_DRAFT, LINE_3][state.lines.length] ?? null
}

export function sandboxWrite(state: SandboxState): SandboxState {
  const line = sandboxNextLine(state)
  if (!line) return state
  const lines = state.phase === 'fix' ? [state.lines[0] as SandboxLine, line] : [...state.lines, line]
  return { ...state, phase: 'feedback', lines, shown: line }
}

/** 关掉反馈面板之后去哪。 */
export function sandboxDismissFeedback(state: SandboxState): SandboxState {
  if (state.phase !== 'feedback') return state
  // 按语气判断，不比对象：页面把状态放在 ref 里，读出来的是代理。
  if (state.shown?.tone === 'sea') return { ...state, phase: state.helpAnswered ? 'fix' : 'ask', shown: null }
  if (state.lines.length >= 3) return { ...state, phase: 'finish', shown: null }
  return { ...state, phase: 'write', shown: null }
}

/** 学生在求助抽屉里问了一句（三种意图或自由提问都行）。 */
export function sandboxAsk(state: SandboxState): SandboxState {
  return { ...state, helpAnswered: true }
}

/** 关掉求助抽屉：问过了就可以改写第 2 行。 */
export function sandboxCloseHelp(state: SandboxState): SandboxState {
  if (state.phase === 'ask' && state.helpAnswered) return { ...state, phase: 'fix' }
  return state
}

export function sandboxFinish(state: SandboxState): SandboxState {
  return state.phase === 'finish' ? { ...state, phase: 'done' } : state
}

/** 顶部小方说的话：每一步只说下一步做什么。 */
export function sandboxGuide(state: SandboxState): string {
  switch (state.phase) {
    case 'write':
      return state.lines.length === 0 ? '证明是一行一行写的。点下面的“写下一行”试试。' : '接着写。点“写下一行”。'
    case 'ask':
      return '不确定怎么改？点右上角的灯泡问问，它只引导，不替你写。'
    case 'fix':
      return '现在点“写下一行”，把第 2 行改好。'
    case 'finish':
      return '三行都写好了，点“写完了”。'
    default:
      return ''
  }
}
