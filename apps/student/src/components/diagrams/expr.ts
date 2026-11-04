/**
 * 受限表达式（03 §7.2 / concept.schema.json `Expr`）：图解组件唯一允许的表达式语法。
 *
 * - 只允许：数字、变量 n / x、+ - * / ^、括号、函数 sqrt abs sin cos exp log min max pow；
 * - 前端自带递归下降解析器（**绝不 eval / new Function**）；解析失败返回 null，由调用方只显示文字；
 * - 支持注入变量求值：evaluate({ n: 3 }) / evaluate({ x: 1.5 })；
 * - 求值结果保留 JS 语义（除零 → Infinity、0/0 → NaN），由图解层用 isFiniteNumber 过滤，避免画坏点。
 *
 * 安全：标识符只接受 n/x/函数名；不支持成员访问、字符串、逗号运算符、赋值等；
 * 源串长度 ≤ 120（契约 Expr maxLength），嵌套深度 ≤ 48，防止恶意/异常数据拖垮页面。
 */
import type { VisualSpec } from '@/types/attempt'

export const EXPR_MAX_LENGTH = 120
const MAX_DEPTH = 48

export interface ExprNode {
  kind: 'number' | 'variable' | 'unary' | 'binary' | 'call'
  value?: number
  name?: string
  op?: '+' | '-' | '*' | '/' | '^'
  arg?: ExprNode
  left?: ExprNode
  right?: ExprNode
  args?: ExprNode[]
}

export interface CompiledExpr {
  source: string
  evaluate: (variables?: Record<string, number>) => number
}

export type ExprVariables = Record<string, number>

const FUNCTIONS: Record<string, { arity: number; apply: (...args: number[]) => number }> = {
  sqrt: { arity: 1, apply: (value) => Math.sqrt(value) },
  abs: { arity: 1, apply: (value) => Math.abs(value) },
  sin: { arity: 1, apply: (value) => Math.sin(value) },
  cos: { arity: 1, apply: (value) => Math.cos(value) },
  exp: { arity: 1, apply: (value) => Math.exp(value) },
  log: { arity: 1, apply: (value) => Math.log(value) },
  min: { arity: 2, apply: (left, right) => Math.min(left, right) },
  max: { arity: 2, apply: (left, right) => Math.max(left, right) },
  pow: { arity: 2, apply: (left, right) => Math.pow(left, right) },
}

const VARIABLES = new Set(['n', 'x'])
const IDENTIFIER_PATTERN = /^[a-z]+$/
/** 契约 Expr 的字符白名单（小写、数字、运算符/括号/逗号/空白）；不满足直接判非法。 */
const SOURCE_PATTERN = /^[0-9a-z+\-*/^().,\s]+$/

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

class ExprParseError extends Error {}

interface Token {
  type: 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'eof'
  text: string
  value?: number
  position: number
}

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index] as string
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      const start = index
      let seenDot = false
      while (index < source.length) {
        const next = source[index] as string
        if (/[0-9]/.test(next)) {
          index += 1
          continue
        }
        if (next === '.' && !seenDot) {
          seenDot = true
          index += 1
          continue
        }
        break
      }
      const text = source.slice(start, index)
      const value = Number(text)
      if (!Number.isFinite(value) || text === '.' || text.endsWith('.')) return null
      tokens.push({ type: 'number', text, value, position: start })
      continue
    }
    if (/[a-z]/.test(char)) {
      const start = index
      while (index < source.length && /[a-z]/.test(source[index] as string)) index += 1
      tokens.push({ type: 'identifier', text: source.slice(start, index), position: start })
      continue
    }
    if (source.startsWith('+', index) || source.startsWith('-', index) || source.startsWith('*', index) || source.startsWith('/', index) || source.startsWith('^', index)) {
      tokens.push({ type: 'operator', text: char, position: index })
      index += 1
      continue
    }
    if (char === '(') { tokens.push({ type: 'lparen', text: char, position: index }); index += 1; continue }
    if (char === ')') { tokens.push({ type: 'rparen', text: char, position: index }); index += 1; continue }
    if (char === ',') { tokens.push({ type: 'comma', text: char, position: index }); index += 1; continue }
    return null
  }
  tokens.push({ type: 'eof', text: '', position: source.length })
  return tokens
}

class Parser {
  private index = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.index] as Token
  }

  private next(): Token {
    const token = this.peek()
    this.index += 1
    return token
  }

  private expect(type: Token['type']): Token {
    const token = this.peek()
    if (token.type !== type) throw new ExprParseError('expected ' + type)
    return this.next()
  }

  parse(): ExprNode {
    const node = this.parseAddSub(0)
    if (this.peek().type !== 'eof') throw new ExprParseError('unexpected token')
    return node
  }

  private parseAddSub(depth: number): ExprNode {
    this.assertDepth(depth)
    let node = this.parseMulDiv(depth)
    for (;;) {
      const token = this.peek()
      if (token.type !== 'operator' || (token.text !== '+' && token.text !== '-')) return node
      this.next()
      node = { kind: 'binary', op: token.text as '+' | '-', left: node, right: this.parseMulDiv(depth) }
    }
  }

  private parseMulDiv(depth: number): ExprNode {
    this.assertDepth(depth)
    let node = this.parseUnary(depth)
    for (;;) {
      const token = this.peek()
      if (token.type !== 'operator' || (token.text !== '*' && token.text !== '/')) return node
      this.next()
      node = { kind: 'binary', op: token.text as '*' | '/', left: node, right: this.parseUnary(depth) }
    }
  }

  private parseUnary(depth: number): ExprNode {
    this.assertDepth(depth)
    const token = this.peek()
    if (token.type === 'operator' && (token.text === '+' || token.text === '-')) {
      this.next()
      const arg = this.parseUnary(depth + 1)
      return token.text === '-' ? { kind: 'unary', op: '-', arg } : arg
    }
    return this.parsePower(depth)
  }

  private parsePower(depth: number): ExprNode {
    this.assertDepth(depth)
    const base = this.parsePrimary(depth)
    const token = this.peek()
    if (token.type === 'operator' && token.text === '^') {
      this.next()
      // 右结合：2^3^2 = 2^(3^2)；指数允许一元负号：2^-3。
      const exponent = this.parseUnary(depth + 1)
      return { kind: 'binary', op: '^', left: base, right: exponent }
    }
    return base
  }

  private parsePrimary(depth: number): ExprNode {
    this.assertDepth(depth)
    const token = this.peek()
    if (token.type === 'number') {
      this.next()
      return { kind: 'number', value: token.value as number }
    }
    if (token.type === 'lparen') {
      this.next()
      const node = this.parseAddSub(depth + 1)
      this.expect('rparen')
      return node
    }
    if (token.type === 'identifier') {
      this.next()
      const name = token.text
      if (!IDENTIFIER_PATTERN.test(name)) throw new ExprParseError('bad identifier')
      if (this.peek().type === 'lparen') {
        const fn = FUNCTIONS[name]
        if (!fn) throw new ExprParseError('unknown function')
        this.next()
        const args: ExprNode[] = []
        if (this.peek().type !== 'rparen') {
          args.push(this.parseAddSub(depth + 1))
          while (this.peek().type === 'comma') {
            this.next()
            args.push(this.parseAddSub(depth + 1))
          }
        }
        this.expect('rparen')
        if (args.length !== fn.arity) throw new ExprParseError('bad arity')
        return { kind: 'call', name, args }
      }
      if (!VARIABLES.has(name)) throw new ExprParseError('unknown variable')
      return { kind: 'variable', name }
    }
    throw new ExprParseError('unexpected token')
  }

  private assertDepth(depth: number): void {
    if (depth > MAX_DEPTH) throw new ExprParseError('too deep')
  }
}

/** 解析受限表达式为 AST；语法错误/非法字符/过长/过深 → null（调用方只显示文字）。 */
export function parseExpr(source: unknown): ExprNode | null {
  if (typeof source !== 'string') return null
  const trimmed = source.trim()
  if (trimmed.length === 0 || trimmed.length > EXPR_MAX_LENGTH) return null
  if (!SOURCE_PATTERN.test(trimmed)) return null
  const tokens = tokenize(trimmed)
  if (!tokens) return null
  try {
    return new Parser(tokens).parse()
  } catch (error) {
    if (error instanceof ExprParseError) return null
    return null
  }
}

function readVariable(name: string, variables: ExprVariables): number {
  const value = variables[name]
  return typeof value === 'number' ? value : Number.NaN
}

function evaluateNode(node: ExprNode, variables: ExprVariables): number {
  switch (node.kind) {
    case 'number':
      return node.value as number
    case 'variable':
      return readVariable(node.name as string, variables)
    case 'unary':
      return -(evaluateNode(node.arg as ExprNode, variables))
    case 'binary': {
      const left = evaluateNode(node.left as ExprNode, variables)
      const right = evaluateNode(node.right as ExprNode, variables)
      if (node.op === '+') return left + right
      if (node.op === '-') return left - right
      if (node.op === '*') return left * right
      if (node.op === '/') return left / right
      return Math.pow(left, right)
    }
    case 'call': {
      const args = (node.args ?? []).map((argument) => evaluateNode(argument, variables))
      const fn = FUNCTIONS[node.name as string]
      return fn ? fn.apply(...args) : Number.NaN
    }
    default:
      return Number.NaN
  }
}

/** 编译为可复用求值器；解析失败返回 null。 */
export function compileExpr(source: unknown): CompiledExpr | null {
  const node = parseExpr(source)
  if (!node) return null
  return {
    source: String(source).trim(),
    evaluate(variables: ExprVariables = {}) {
      return evaluateNode(node, variables)
    },
  }
}

/** 一次性求值：解析失败 → null；成功返回数值（可能是 NaN/Infinity，由调用方过滤）。 */
export function evalExpr(source: unknown, variables: ExprVariables = {}): number | null {
  const compiled = compileExpr(source)
  return compiled ? compiled.evaluate(variables) : null
}

/** VisualSpec 参数里的 series 数组（partial-sums）；非法项返回空数组。 */
export function readSeriesSpec(raw: unknown): Array<{ expr: string; label: string }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const result: Array<{ expr: string; label: string }> = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return null
    const candidate = item as { expr?: unknown; label?: unknown }
    if (typeof candidate.expr !== 'string') return null
    result.push({
      expr: candidate.expr,
      label: typeof candidate.label === 'string' && candidate.label.length > 0 ? candidate.label : candidate.expr,
    })
  }
  return result
}

/** 从 VisualSpec 取受限表达式参数（组件统一入口；不执行任何数据里的代码）。 */
export function readExprParam(params: unknown, key: 'expr' = 'expr'): string | null {
  if (params === null || typeof params !== 'object') return null
  const value = (params as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** 供组件做参数类型收窄用（仅结构检查，不做业务判定）。 */
export function isVisualSpec(value: unknown): value is VisualSpec {
  return value !== null && typeof value === 'object' && typeof (value as VisualSpec).type === 'string' && typeof (value as VisualSpec).params === 'object'
}
