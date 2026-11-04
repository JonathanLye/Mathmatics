/**
 * #47 剩余图解模板（03 §7）：受限表达式 + partial-sums / func-band / monotone-steps 纯函数，
 * 以及 3 个 SFC 的 @vue/compiler-sfc 编译检查。
 *
 * 只测纯计算与编译，不启动浏览器；组件交互由 typecheck/build 与（可选）e2e 覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { EXPR_MAX_LENGTH, compileExpr, evalExpr, isFiniteNumber, parseExpr } from '@/components/diagrams/expr'
import {
  clampInt,
  computePartialSums,
  nTicks,
  projectPartialSum,
  readSeries,
} from '@/components/diagrams/partialSums'
import {
  FUNC_BAND_DELTA_STEP,
  computeFuncBand,
  findMaxDelta,
  projectFuncBandPoint,
  readFuncBandSpec,
} from '@/components/diagrams/funcBand'
import { computeMonotoneSteps, projectN as projectMonotoneN } from '@/components/diagrams/monotoneSteps'

const DIAGRAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/diagrams')

// ---------------------------------------------------------------------------
// 受限表达式（03 §7.2）：递归下降、绝不 eval、注入/非法输入返回 null
// ---------------------------------------------------------------------------
describe('受限表达式 expr：语法与优先级', () => {
  it('数字/变量/常量求值', () => {
    expect(evalExpr('1+2*3')).toBe(7)
    expect(evalExpr('(1+2)*3')).toBe(9)
    expect(evalExpr('2*3^2')).toBe(18)
    expect(evalExpr('n^2+1', { n: 3 })).toBe(10)
    expect(evalExpr('x/2', { x: 1.5 })).toBe(0.75)
    expect(evalExpr(' 1 + 2 * 3 ')).toBe(7)
    expect(evalExpr('.5+.5')).toBe(1)
    expect(evalExpr('1.5*2')).toBe(3)
  })

  it('^ 右结合；一元负号优先级符合数学惯例', () => {
    expect(evalExpr('2^3^2')).toBe(512)
    expect(evalExpr('-2^2')).toBe(-4)
    expect(evalExpr('2^-2')).toBe(0.25)
    expect(evalExpr('-(1+2)')).toBe(-3)
  })

  it('允许的九个函数', () => {
    expect(evalExpr('sqrt(9)')).toBe(3)
    expect(evalExpr('abs(-5)')).toBe(5)
    expect(evalExpr('min(2,3)')).toBe(2)
    expect(evalExpr('max(2,3)')).toBe(3)
    expect(evalExpr('pow(2,10)')).toBe(1024)
    expect(evalExpr('sin(0)')).toBe(0)
    expect(evalExpr('cos(0)')).toBe(1)
    expect(evalExpr('log(1)')).toBe(0)
    expect(evalExpr('exp(0)')).toBe(1)
  })

  it('函数/括号嵌套与右结合指数组合', () => {
    expect(evalExpr('sqrt(pow(3,2)+16)')).toBe(5)
    expect(evalExpr('max(1,min(2,3))+abs(-4)')).toBe(6)
    expect(evalExpr('2^(1+2)')).toBe(8)
  })
})

describe('受限表达式 expr：非法输入 / 注入防护', () => {
  it('未知变量、未知函数、未闭合括号、悬空运算符全部 null', () => {
    expect(parseExpr('y+1')).toBeNull()
    expect(parseExpr('foo(1)')).toBeNull()
    expect(parseExpr('1+')).toBeNull()
    expect(parseExpr('(1+2')).toBeNull()
    expect(parseExpr('1+2)')).toBeNull()
    expect(parseExpr('')).toBeNull()
    expect(parseExpr('   ')).toBeNull()
    expect(parseExpr('1 2')).toBeNull()
  })

  it('拒绝 prototype/全局/成员访问等注入（不执行任何数据里的代码）', () => {
    expect(parseExpr('constructor')).toBeNull()
    expect(parseExpr('n.constructor')).toBeNull()
    expect(parseExpr('__proto__')).toBeNull()
    expect(parseExpr('window')).toBeNull()
    expect(parseExpr('globalThis')).toBeNull()
    expect(parseExpr('Function("return 1")')).toBeNull()
    expect(parseExpr('alert(1)')).toBeNull()
    expect(parseExpr('1;2')).toBeNull()
    expect(parseExpr('"1"')).toBeNull()
    expect(parseExpr('eval(1)')).toBeNull()
  })

  it('函数参数个数不对 → null', () => {
    expect(parseExpr('min(1)')).toBeNull()
    expect(parseExpr('abs(1,2)')).toBeNull()
    expect(parseExpr('pow(2)')).toBeNull()
    expect(parseExpr('sqrt()')).toBeNull()
  })

  it('超长源串 / 超深嵌套 → null（防异常数据拖垮页面）', () => {
    expect(parseExpr('1+'.repeat(70) + '1')).toBeNull()
    expect(parseExpr('1'.repeat(EXPR_MAX_LENGTH + 1))).toBeNull()
    expect(parseExpr('('.repeat(60) + '1' + ')'.repeat(60))).toBeNull()
    expect(parseExpr('1+2')).not.toBeNull()
  })
})

describe('受限表达式 expr：数值边界', () => {
  it('除零 → Infinity、0/0 → NaN、sqrt(-1) → NaN、log(0) → -Infinity', () => {
    expect(evalExpr('1/x', { x: 0 })).toBe(Number.POSITIVE_INFINITY)
    expect(isFiniteNumber(evalExpr('1/x', { x: 0 }))).toBe(false)
    const nan = evalExpr('0/x', { x: 0 })
    expect(typeof nan).toBe('number')
    expect(Number.isNaN(nan as number)).toBe(true)
    expect(isFiniteNumber(evalExpr('sqrt(-1)'))).toBe(false)
    expect(evalExpr('log(0)')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('注入变量缺失 → NaN；编译后可复用不同变量', () => {
    const compiled = compileExpr('n+1')
    expect(compiled).not.toBeNull()
    expect(Number.isNaN(compiled?.evaluate() as number)).toBe(true)
    expect(compiled?.evaluate({ n: 1 })).toBe(2)
    expect(compiled?.evaluate({ n: 41 })).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// partial-sums
// ---------------------------------------------------------------------------
describe('图解④：部分和折线（partial-sums）', () => {
  it('级数 a_n = 1/2^n 的部分和 S_n → 1（n=1..nMax 逐项累加）', () => {
    const view = computePartialSums([{ expr: '1/2^n', label: '∑(1/2)^n' }], { nMax: 30 })
    expect(view).not.toBeNull()
    expect(view?.series).toHaveLength(1)
    expect(view?.series[0]?.valid).toBe(true)
    expect(view?.series[0]?.points).toHaveLength(30)
    expect(view?.series[0]?.finalSum).toBeCloseTo(1, 8)
    expect(view?.nMax).toBe(30)
    expect(view?.n).toBe(30)
    expect(view?.yMin).toBeLessThan(0)
    expect(view?.yMax).toBeGreaterThan(1)
  })

  it('滑块 n 上限：只累加到 n，坐标范围仍稳定用 nMax', () => {
    const full = computePartialSums([{ expr: '1/n', label: '调和' }], { nMax: 20 })
    const partial = computePartialSums([{ expr: '1/n', label: '调和' }], { nMax: 20, n: 5 })
    expect(partial?.n).toBe(5)
    expect(partial?.series[0]?.points).toHaveLength(20)
    expect(partial?.series[0]?.finalSum).toBeCloseTo(1 + 0.5 + 1 / 3 + 0.25 + 0.2, 10)
    expect(partial?.yMin).toBe(full?.yMin)
    expect(partial?.yMax).toBe(full?.yMax)
  })

  it('多条级数按 label 区分；非法表达式/非有限项的级数不画', () => {
    const view = computePartialSums(
      [
        { expr: '1/2^n', label: '收敛' },
        { expr: '1/(n-3)', label: '会除零' },
        { expr: 'bad expr', label: '语法错' },
      ],
      { nMax: 10 },
    )
    expect(view).not.toBeNull()
    expect(view?.series.map((series) => series.valid)).toEqual([true, false, false])
    expect(view?.series[1]?.points).toHaveLength(2) // n=1,2 有限；n=3 除零即停
    expect(view?.series[2]?.points).toHaveLength(0)
  })

  it('nMax/n 越界被夹住；刻度从 1 开始；坐标映射在画布内', () => {
    expect(clampInt(2, 5, 400, 30)).toBe(5)
    expect(clampInt(999, 5, 400, 30)).toBe(400)
    const ticks = nTicks(20, 5)
    expect(ticks[0]).toBe(1)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(20)
    const view = computePartialSums([{ expr: '1/n', label: '调和' }], { nMax: 20 })
    expect(view).not.toBeNull()
    const geometry = { width: 320, height: 200, padding: { left: 36, right: 16, top: 30, bottom: 42 } }
    const first = projectPartialSum({ n: 1, value: view?.series[0]?.points[0]?.value ?? 0 }, geometry, view as NonNullable<typeof view>)
    const last = projectPartialSum({ n: 20, value: view?.series[0]?.points[19]?.value ?? 0 }, geometry, view as NonNullable<typeof view>)
    expect(first.x).toBe(36)
    expect(last.x).toBeCloseTo(320 - 16, 6)
    for (const point of view?.series[0]?.points ?? []) {
      const projected = projectPartialSum(point, geometry, view as NonNullable<typeof view>)
      expect(projected.y).toBeGreaterThanOrEqual(30)
      expect(projected.y).toBeLessThanOrEqual(200 - 42)
    }
  })

  it('参数不可用（空/非法 series）→ null；readSeries 只收合法项', () => {
    expect(computePartialSums([])).toBeNull()
    expect(computePartialSums([{ expr: 'bad expr', label: 'x' }])).toBeNull()
    expect(readSeries([{ expr: '1/n' }, { label: '缺 expr' }, null])).toEqual([{ expr: '1/n', label: '1/n' }])
  })
})

// ---------------------------------------------------------------------------
// func-band
// ---------------------------------------------------------------------------
describe('图解⑤：函数带子（func-band，数值扫描 δ）', () => {
  it('f(x)=x²、A=1、x₀=1、ε=0.1：δ 数值近似 ≈ 0.048（步长 1e-3）', () => {
    const compiled = compileExpr('x^2')
    expect(compiled).not.toBeNull()
    const delta = findMaxDelta(compiled as NonNullable<typeof compiled>, 1, 1, 0.1, { step: FUNC_BAND_DELTA_STEP })
    expect(delta).toBeCloseTo(0.048, 10)
    expect(delta).toBeLessThan(Math.sqrt(1.1) - 1)
    expect(delta).toBeGreaterThan(0)
  })

  it('ε 非正/表达式非法 → null；ε 越小可用 δ 越小', () => {
    expect(findMaxDelta(compileExpr('x^2') as NonNullable<ReturnType<typeof compileExpr>>, 1, 1, 0)).toBeNull()
    expect(findMaxDelta(compileExpr('x^2') as NonNullable<ReturnType<typeof compileExpr>>, 1, 1, -0.1)).toBeNull()
    const wide = findMaxDelta(compileExpr('x^2') as NonNullable<ReturnType<typeof compileExpr>>, 1, 1, 0.4)
    const narrow = findMaxDelta(compileExpr('x^2') as NonNullable<ReturnType<typeof compileExpr>>, 1, 1, 0.05)
    expect((wide as number) > (narrow as number)).toBe(true)
  })

  it('computeFuncBand 用 seed 参数：x²/A=1/x₀=1 得到曲线、水平带、δ、数值近似标记', () => {
    const params = {
      expr: 'x^2',
      exprLatex: '$f(x)=x^2$',
      limit: 1,
      at: 1,
      epsilon: { min: 0.05, max: 0.8, init: 0.4, step: 0.01 },
      xRange: [-1, 3],
    }
    const view = computeFuncBand(params, { epsilon: 0.4 })
    expect(view).not.toBeNull()
    expect(view?.valid).toBe(true)
    expect(view?.deltaApprox).toBe(true)
    expect(view?.bandLow).toBeCloseTo(0.6, 10)
    expect(view?.bandHigh).toBeCloseTo(1.4, 10)
    expect(view?.delta).toBeGreaterThan(0)
    expect(view?.points.length).toBeGreaterThan(100)
    expect(view?.xRange).toEqual([-1, 3])
    expect(view?.yTicks.length).toBeGreaterThanOrEqual(2)
    expect(view?.xTicks.length).toBeGreaterThanOrEqual(2)
    for (const tick of view?.xTicks ?? []) {
      expect(tick).toBeGreaterThanOrEqual(-1)
      expect(tick).toBeLessThanOrEqual(3)
    }
    const geometry = { width: 320, height: 220, padding: { left: 40, right: 16, top: 30, bottom: 40 } }
    for (const point of view?.points ?? []) {
      const projected = projectFuncBandPoint(point, geometry, view as NonNullable<typeof view>)
      expect(projected.x).toBeGreaterThanOrEqual(40)
      expect(projected.x).toBeLessThanOrEqual(320 - 16)
      expect(projected.y).toBeGreaterThanOrEqual(30)
      expect(projected.y).toBeLessThanOrEqual(220 - 40)
    }
  })

  it('参数校验：缺 expr/limit/at → null；epsilon 默认值与非法 xRange 兜底', () => {
    expect(readFuncBandSpec(null)).toBeNull()
    expect(readFuncBandSpec({ expr: 'x', limit: 1 })).toBeNull()
    expect(readFuncBandSpec({ expr: 'x', at: 1 })).toBeNull()
    const spec = readFuncBandSpec({ expr: 'x', limit: 1, at: 1 })
    expect(spec).not.toBeNull()
    expect(spec?.epsilon.min).toBeGreaterThan(0)
    expect(spec?.xRange).toEqual([-1, 3])
    const custom = readFuncBandSpec({ expr: 'x', limit: 1, at: 0, xRange: [5, 1] })
    expect(custom?.xRange).toEqual([-2, 2])
    expect(computeFuncBand({ expr: 'bad expr', limit: 1, at: 1 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// monotone-steps
// ---------------------------------------------------------------------------
describe('图解⑥：单调性相邻项（monotone-steps）', () => {
  it('u_n = 1/n：相邻差值为负，展示判定「递减」', () => {
    const view = computeMonotoneSteps('1/n', { nMax: 10 })
    expect(view).not.toBeNull()
    expect(view?.samples).toHaveLength(10)
    expect(view?.samples.every((sample) => sample.diff < 0 && sample.sign === -1)).toBe(true)
    expect(view?.direction).toBe('decreasing')
    expect(view?.directionLabel).toContain('递减')
    expect(view?.current?.n).toBe(1)
    expect(view?.current?.current).toBe(1)
    expect(view?.current?.next).toBe(0.5)
  })

  it('u_n = n：递增；u_n = (-1)^n：差值符号变化 → 不单调；常数 → 差值为 0', () => {
    expect(computeMonotoneSteps('n', { nMax: 8 })?.direction).toBe('increasing')
    expect(computeMonotoneSteps('(-1)^n', { nMax: 8 })?.direction).toBe('mixed')
    const constant = computeMonotoneSteps('1', { nMax: 8 })
    expect(constant?.samples.every((sample) => sample.sign === 0)).toBe(true)
    expect(constant?.direction).toBe('mixed')
  })

  it('滑块 n 夹在 1..样本数；非法表达式 → null；参数兜底', () => {
    const view = computeMonotoneSteps('1/n', { nMax: 10, n: 6 })
    expect(view?.n).toBe(6)
    expect(view?.current?.n).toBe(6)
    const clampedLow = computeMonotoneSteps('1/n', { nMax: 10, n: -5 })
    expect(clampedLow?.n).toBe(1)
    const clampedHigh = computeMonotoneSteps('1/n', { nMax: 10, n: 999 })
    expect(clampedHigh?.n).toBe(10)
    expect(computeMonotoneSteps('bad expr')).toBeNull()
    expect(projectMonotoneN(1, 320, { left: 34, right: 14 }, 20)).toBe(34)
    expect(projectMonotoneN(20, 320, { left: 34, right: 14 }, 20)).toBe(320 - 14)
  })
})

// ---------------------------------------------------------------------------
// 组件 SFC 编译检查（组件由 MicroCourse 按 step.visual.type 接线；build 也会打包，
// 但这里用 @vue/compiler-sfc 单测兜住语法/样式错误，避免只靠 e2e 发现）。
// @vue/compiler-sfc 是 @dcloudio/uni-cli-shared 的传递依赖，pnpm 严格 node_modules 下
// 不能从 apps/student 直接 import；用 createRequire 从 uni-cli-shared 解析（同 mirror.test.ts）。
// ---------------------------------------------------------------------------
interface CompilerSfcLike {
  parse: (source: string, options?: Record<string, unknown>) => { descriptor: Record<string, any>; errors: unknown[] }
  compileScript: (descriptor: Record<string, any>, options?: Record<string, unknown>) => { content: string }
  compileTemplate: (options: Record<string, unknown>) => { code: string; errors: unknown[] }
  compileStyle: (options: Record<string, unknown>) => { errors: unknown[] }
}

let sfc: CompilerSfcLike
const SFC_FILES = ['PartialSumsDiagram.vue', 'FuncBandDiagram.vue', 'MonotoneStepsDiagram.vue']

function resolveCompilerSfcEntry(): string {
  const nodeRequire = createRequire(import.meta.url)
  try {
    return nodeRequire.resolve('@vue/compiler-sfc')
  } catch {
    const uniCliShared = nodeRequire.resolve('@dcloudio/uni-cli-shared/package.json')
    return createRequire(uniCliShared).resolve('@vue/compiler-sfc')
  }
}

function readSfc(file: string): string {
  return fs.readFileSync(path.join(DIAGRAM_DIR, file), 'utf8')
}

beforeAll(async () => {
  const entry = pathToFileURL(resolveCompilerSfcEntry()).href
  const loaded: Record<string, unknown> = await import(entry)
  sfc = (loaded.default ?? loaded) as unknown as CompilerSfcLike
})

describe('新图解组件 SFC 编译检查（@vue/compiler-sfc）', () => {
  it.each(SFC_FILES)('%s 可以被解析且含 script setup / template', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    expect(result.errors).toEqual([])
    expect(result.descriptor.scriptSetup).toBeTruthy()
    expect(result.descriptor.template).toBeTruthy()
  })

  it.each(SFC_FILES)('%s 的 script setup 与 template 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const id = 'diagram-' + file.replace('.vue', '')
    expect(() => sfc.compileScript(result.descriptor, { id })).not.toThrow()
    const template = sfc.compileTemplate({
      source: result.descriptor.template.content,
      filename: file,
      id,
      scoped: true,
    })
    expect(template.errors).toEqual([])
    expect(template.code.length).toBeGreaterThan(0)
  })

  it.each(SFC_FILES)('%s 的 scoped style 可以编译', (file) => {
    const result = sfc.parse(readSfc(file), { filename: file })
    const styles = result.descriptor.styles ?? []
    expect(styles.length).toBeGreaterThan(0)
    for (const style of styles) {
      const compiled = sfc.compileStyle({ source: style.content, filename: file, id: 'data-v-test', scoped: true })
      expect(compiled.errors).toEqual([])
    }
  })
})
