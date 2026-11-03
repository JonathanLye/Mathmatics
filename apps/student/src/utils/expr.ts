/**
 * 受限表达式解析与求值（03 §7.2 图解组件）。
 *
 * 只允许：数字、变量 `n` / `x`、`+ - * / ^`、括号、函数
 * `sqrt abs sin cos exp log min max pow`。
 * 实现方式是手写递归下降，**绝不使用 eval / new Function**：图解参数来自概念库/模型，不能当代码执行。
 * 解析失败抛 ExprError（调用方不显示图解、只显示文字）。
 */

export class ExprError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExprError'
  }
}

type Ast =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '+' | '-'; arg: Ast }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast }
  | { kind: 'call'; name: string; args: Ast[] }

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }
  | { type: 'end' }

interface FuncSpec {
  /** 参数个数范围（含端点）。 */
  arity: [number, number]
  fn: (args: number[]) => number
}

const FUNCS: Record<string, FuncSpec> = {
  sqrt: { arity: [1, 1], fn: ([a]) => Math.sqrt(a) },
  abs: { arity: [1, 1], fn: ([a]) => Math.abs(a) },
  sin: { arity: [1, 1], fn: ([a]) => Math.sin(a) },
  cos: { arity: [1, 1], fn: ([a]) => Math.cos(a) },
  exp: { arity: [1, 1], fn: ([a]) => Math.exp(a) },
  log: { arity: [1, 1], fn: ([a]) => Math.log(a) },
  min: { arity: [1, 8], fn: (args) => Math.min(...args) },
  max: { arity: [1, 8], fn: (args) => Math.max(...args) },
  pow: { arity: [2, 2], fn: ([a, b]) => Math.pow(a, b) },
}

const VARS = new Set(['n', 'x'])
const MAX_SOURCE_LENGTH = 120

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (ch >= '0' && ch <= '9') {
      const start = i
      while (i < source.length && source[i] >= '0' && source[i] <= '9') i += 1
      if (source[i] === '.') {
        i += 1
        while (i < source.length && source[i] >= '0' && source[i] <= '9') i += 1
      }
      const raw = source.slice(start, i)
      const value = Number(raw)
      if (!Number.isFinite(value)) throw new ExprError('数字不合法：' + raw)
      tokens.push({ type: 'num', value })
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      const start = i
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1
      tokens.push({ type: 'ident', value: source.slice(start, i) })
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue }
    if (ch === ',') { tokens.push({ type: 'comma' }); i += 1; continue }
    throw new ExprError('不允许的字符：' + ch)
  }
  tokens.push({ type: 'end' })
  return tokens
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const tok = this.tokens[this.pos]
    this.pos += 1
    return tok
  }

  private expect(type: Token['type']): Token {
    const tok = this.peek()
    if (tok.type !== type) throw new ExprError('语法错误：期望 ' + type)
    return this.next()
  }

  parse(): Ast {
    const ast = this.parseExpression()
    if (this.peek().type !== 'end') throw new ExprError('语法错误：多余的内容')
    return ast
  }

  private parseExpression(): Ast {
    let left = this.parseTerm()
    for (;;) {
      const tok = this.peek()
      if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
        this.next()
        left = { kind: 'binary', op: tok.value, left, right: this.parseTerm() }
      } else {
        return left
      }
    }
  }

  private parseTerm(): Ast {
    let left = this.parseUnary()
    for (;;) {
      const tok = this.peek()
      if (tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
        this.next()
        left = { kind: 'binary', op: tok.value, left, right: this.parseUnary() }
      } else {
        return left
      }
    }
  }

  private parseUnary(): Ast {
    const tok = this.peek()
    if (tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
      this.next()
      return { kind: 'unary', op: tok.value, arg: this.parseUnary() }
    }
    return this.parsePower()
  }

  /** 幂运算右结合：2^3^2 = 2^(3^2)；-n^2 = -(n^2)。 */
  private parsePower(): Ast {
    const base = this.parsePrimary()
    const tok = this.peek()
    if (tok.type === 'op' && tok.value === '^') {
      this.next()
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary() }
    }
    return base
  }

  private parsePrimary(): Ast {
    const tok = this.next()
    if (tok.type === 'num') return { kind: 'num', value: tok.value }
    if (tok.type === 'ident') {
      if (this.peek().type === 'lparen') {
        const spec = FUNCS[tok.value]
        if (!spec) throw new ExprError('不允许的函数：' + tok.value)
        this.next()
        const args: Ast[] = []
        if (this.peek().type !== 'rparen') {
          args.push(this.parseExpression())
          while (this.peek().type === 'comma') {
            this.next()
            args.push(this.parseExpression())
          }
        }
        this.expect('rparen')
        if (args.length < spec.arity[0] || args.length > spec.arity[1]) {
          throw new ExprError('函数参数个数不对：' + tok.value)
        }
        return { kind: 'call', name: tok.value, args }
      }
      if (!VARS.has(tok.value)) throw new ExprError('不允许的变量：' + tok.value)
      return { kind: 'var', name: tok.value }
    }
    if (tok.type === 'lparen') {
      const node = this.parseExpression()
      this.expect('rparen')
      return node
    }
    throw new ExprError('语法错误：缺少运算对象')
  }
}

function evaluate(node: Ast, vars: Record<string, number>): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'var': {
      const value = vars[node.name]
      if (typeof value !== 'number' || Number.isNaN(value)) throw new ExprError('变量没有取值：' + node.name)
      return value
    }
    case 'unary': {
      const value = evaluate(node.arg, vars)
      return node.op === '-' ? -value : value
    }
    case 'binary': {
      const left = evaluate(node.left, vars)
      const right = evaluate(node.right, vars)
      switch (node.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return left / right
        case '^': return Math.pow(left, right)
      }
      break
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, vars))
      return FUNCS[node.name].fn(args)
    }
  }
  throw new ExprError('无法求值')
}

/**
 * 编译受限表达式，返回 (变量取值) => 数值。
 * 解析失败抛 ExprError；求值结果可能是 NaN/Infinity，由调用方判断是否可画。
 */
export function compileExpr(source: string): (vars: Record<string, number>) => number {
  if (typeof source !== 'string' || source.trim() === '') throw new ExprError('表达式为空')
  if (source.length > MAX_SOURCE_LENGTH) throw new ExprError('表达式过长')
  const ast = new Parser(tokenize(source)).parse()
  return (vars: Record<string, number>) => evaluate(ast, vars)
}

/** 一次性求值：evalExpr('(3*n+1)/(n+2)', { n: 2 }) === 1.75。 */
export function evalExpr(source: string, vars: Record<string, number>): number {
  return compileExpr(source)(vars)
}
