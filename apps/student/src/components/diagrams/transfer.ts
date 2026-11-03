/**
 * 迁移题思路图（issue #47 P1-2「更多图解模板」之三；L5 迁移题，01 §L5）。
 *
 * 以 seed 里的题对为例：epsN（数列 ε-N：a_n = (3n+1)/(n+2)，A = 3，N = ⌈5/ε⌉）
 * → epsN-T1（函数 ε-δ：lim_{x→1}(2x+1) = 3，δ = ε/2）。
 *
 * 数学含义：两题的证明骨架相同——「任取 ε>0 → 取只依赖 ε 的阈值 → 自变量进入阈值范围
 * → 结论 |·−A| < ε」；迁移只换"量化对象"：
 *   n > N（项号超过整数阈值） ↔ 0 < |x − x_0| < δ（x 进入去心邻域）。
 * 图上左右两栏逐行对照，中间箭头标出"同构"关系；阈值数值只依赖 ε。
 *
 * 纯函数：给定 ε 计算两种阈值、给出对照行；TransferOutlineDiagram.vue 负责渲染。
 */

export interface TransferQuantities {
  /** 给定的 ε > 0 */
  epsilon: number
  /** 数列题的 N = ⌈kSeq / ε⌉（seed epsN 的 kSeq = 5） */
  seqN: number
  /** 函数题的 δ = ε / slope（seed epsN-T1 的 slope = 2） */
  funcDelta: number
  /** 函数题的极限点 x0（epsN-T1 是 x→1） */
  funcCenter: number
}

export interface TransferOptions {
  /** 数列题 |a_n − A| 的分子系数 k（epsN: 5） */
  kSeq?: number
  /** 函数题 |f(x) − A| = slope·|x − x0| 的斜率（epsN-T1: 2） */
  slope?: number
  /** 函数题的极限点（epsN-T1: 1） */
  funcCenter?: number
}

export interface TransferRow {
  /** 数列 ε-N 一侧的文字 */
  seq: string
  /** 函数 ε-δ 一侧的文字 */
  func: string
  /** 两边的对应关系/差异提示（不含答案的关键步骤） */
  note: string
}

const DEFAULT_OPTIONS: Required<TransferOptions> = { kSeq: 5, slope: 2, funcCenter: 1 }

function assertPositive(name: string, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name} 必须是正数：${value}`)
}

/** 由 ε 计算迁移两侧的阈值；ε 非正数抛 RangeError（图上不画无效阈值）。 */
export function transferQuantities(epsilon: number, options: TransferOptions = {}): TransferQuantities {
  assertPositive('epsilon', epsilon)
  const { kSeq, slope, funcCenter } = { ...DEFAULT_OPTIONS, ...options }
  assertPositive('kSeq', kSeq)
  assertPositive('slope', slope)
  return {
    epsilon,
    seqN: Math.ceil(kSeq / epsilon),
    funcDelta: epsilon / slope,
    funcCenter,
  }
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

/** 逐行对照：每一步"同构"，最后一列点出唯一需要换的对象。 */
export function transferRows(quantities: TransferQuantities, options: TransferOptions = {}): TransferRow[] {
  const { kSeq, slope, funcCenter } = { ...DEFAULT_OPTIONS, ...options }
  const { seqN, funcDelta } = quantities
  return [
    {
      seq: '任取 ε > 0',
      func: '任取 ε > 0',
      note: '起点相同：ε 是"要多小有多小"的误差要求',
    },
    {
      seq: `∃ N = ⌈${fmt(kSeq)}/ε⌉ = ${fmt(seqN)}`,
      func: `∃ δ = ε/${fmt(slope)} = ${fmt(funcDelta)}`,
      note: '都是只依赖 ε 的阈值：先定 N/δ，再谈 n/x',
    },
    {
      seq: '当 n > N 时',
      func: `当 0 < |x − ${fmt(funcCenter)}| < δ 时`,
      note: '换成"进入阈值范围"：数列用项号、函数用去心邻域',
    },
    {
      seq: '|a_n − A| < ε',
      func: '|f(x) − A| < ε',
      note: '结论形式完全一样：误差被压到 ε 以下',
    },
  ]
}

/** 两条阈值随 ε 的变化曲线（图解画折线用），eps 从 epsMin 到 epsMax 取样。 */
export function thresholdCurve(
  epsilon: number,
  count = 24,
  options: TransferOptions = {},
): Array<{ epsilon: number; seqN: number; funcDelta: number }> {
  assertPositive('epsilon', epsilon)
  const samples: Array<{ epsilon: number; seqN: number; funcDelta: number }> = []
  const start = Math.max(0.02, epsilon / 4)
  const end = Math.max(start + 0.02, epsilon * 2)
  for (let index = 0; index < count; index += 1) {
    const current = start + ((end - start) * index) / Math.max(1, count - 1)
    const quantities = transferQuantities(current, options)
    samples.push({ epsilon: quantities.epsilon, seqN: quantities.seqN, funcDelta: quantities.funcDelta })
  }
  return samples
}
