import { describe, expect, it } from 'vitest'
import { compileExpr, evalExpr, ExprError } from '@/utils/expr'

// #26：图解参数来自概念库/模型，只能走受限语法 + 自研解析器（03 §7.2），绝不 eval。
describe('受限表达式解析器（03 §7.2）', () => {
  it('四则运算与优先级', () => {
    expect(evalExpr('1+2*3', {})).toBe(7)
    expect(evalExpr('(1+2)*3', {})).toBe(9)
    expect(evalExpr('6/4', {})).toBe(1.5)
    expect(evalExpr('3+(-5)/(n+2)', { n: 3 })).toBe(2)
  })

  it('幂右结合 / 一元负号 / 负指数', () => {
    expect(evalExpr('2^3^2', {})).toBe(512)
    expect(evalExpr('-n^2', { n: 3 })).toBe(-9)
    expect(evalExpr('2^-1', {})).toBe(0.5)
    expect(evalExpr('-(2+3)', {})).toBe(-5)
  })

  it('变量 n / x 可分别取值', () => {
    expect(evalExpr('n+1', { n: 2 })).toBe(3)
    expect(evalExpr('x*x', { x: 4 })).toBe(16)
    expect(evalExpr('n+x', { n: 1, x: 2 })).toBe(3)
  })

  it('白名单函数', () => {
    expect(evalExpr('sqrt(9)', {})).toBe(3)
    expect(evalExpr('abs(-2)', {})).toBe(2)
    expect(evalExpr('log(1)', {})).toBe(0)
    expect(evalExpr('exp(0)', {})).toBe(1)
    expect(evalExpr('min(3,1,2)', {})).toBe(1)
    expect(evalExpr('max(3,1,2)', {})).toBe(3)
    expect(evalExpr('pow(2,10)', {})).toBe(1024)
    expect(evalExpr('sin(0)+cos(0)', {})).toBe(1)
  })

  it('数列通项 (3n+1)/(n+2)', () => {
    const fn = compileExpr('(3*n+1)/(n+2)')
    expect(fn({ n: 1 })).toBeCloseTo(4 / 3, 10)
    expect(fn({ n: 3 })).toBeCloseTo(10 / 5, 10)
  })

  it('拒绝代码注入与未知标识符', () => {
    for (const bad of ['alert(1)', 'constructor', 'process.exit(1)', 'eval("1")', 'n.toString()', 'foo(1)']) {
      expect(() => compileExpr(bad)).toThrow(ExprError)
    }
  })

  it('拒绝非法字符 / 括号不配对 / 空表达式 / 超长', () => {
    for (const bad of ['1;2', '1+', '(1+2', '1+2)', '', '1..2', '1+2*']) {
      expect(() => compileExpr(bad)).toThrow(ExprError)
    }
    expect(() => compileExpr('1+'.repeat(80) + '1')).toThrow(ExprError)
  })
})
