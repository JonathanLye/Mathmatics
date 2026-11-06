/**
 * 学习路径与练习区的 mock 题库：30 道题、5 章 10 个单元，含解题思路与参考证明，
 * 用来在没有服务端时演示路径、练习区筛选、难度档与「查看思路 / 完整解答」。
 * 题面与解答是自编的数学分析习题，不来自任何教辅。
 */
import type { DifficultyBand } from '@/types/path'

export interface BankProblem {
  id: string
  /** 所属单元的下标（UNITS）。 */
  unit: number
  title: string
  stem: string
  /** 题目包 difficulty 1–5。 */
  difficulty: 1 | 2 | 3 | 4 | 5
  tags: string[]
  keyCount: number
  autoImported?: boolean
  /** 启用的层数；导入题只有写证明与总结两层。 */
  layers?: number
  solution: { approach: string; keyIdeas: string[]; pitfalls: string[]; referenceProof: string }
}

export interface BankUnit {
  id: string
  chapterNo: number
  unitNo: number
  chapter: string
  title: string
  summary: string
  concepts: { id: string; title: string }[]
}

export const MOCK_COURSE = { id: 'math-analysis', title: '数学分析' }

const unit = (n: number, chapterNo: number, unitNo: number, chapter: string, title: string, summary: string, concepts: [string, string][]): BankUnit => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  chapterNo,
  unitNo,
  chapter,
  title,
  summary,
  concepts: concepts.map(([id, t]) => ({ id, title: t })),
})

export const UNITS: BankUnit[] = [
  unit(1, 1, 1, '第一章 实数与函数', '确界与实数完备性', '会用上确界、下确界的定义写证明，理解“最小上界”意味着什么。', [['sup-inf', '上确界与下确界']]),
  unit(2, 1, 2, '第一章 实数与函数', '函数的基本性质', '单调、有界、奇偶与周期：从定义出发逐条验证。', [['monotone', '单调性']]),
  unit(3, 2, 1, '第二章 数列极限', 'ε-N 定义', '用 ε-N 语言证明极限：先放大，再倒推 N。', [['seq-limit', '数列极限的定义']]),
  unit(4, 2, 2, '第二章 数列极限', '收敛判别与单调有界', '夹逼准则、单调有界定理，以及子列的用法。', [['squeeze', '夹逼准则'], ['mono-bounded', '单调有界定理']]),
  unit(5, 3, 1, '第三章 函数极限', 'ε-δ 定义', '把 ε-N 的套路搬到函数极限：找只依赖 ε 的 δ。', [['func-limit', '函数极限的定义']]),
  unit(6, 3, 2, '第三章 函数极限', '极限的性质与运算', '保号性、局部有界、四则运算与复合。', [['limit-props', '极限的基本性质']]),
  unit(7, 4, 1, '第四章 连续函数', '连续性与介值定理', '用连续的定义与闭区间上的性质证明存在性。', [['continuity', '连续的定义'], ['ivt', '介值定理']]),
  unit(8, 12, 1, '第十二章 数项级数', '正项级数判别', '比较、比值、根值与积分判别法。', [['series-conv', '级数收敛']]),
  unit(9, 12, 2, '第十二章 数项级数', '交错级数与绝对收敛', '莱布尼茨判别法，条件收敛与绝对收敛的区别。', [['series-conv', '级数收敛']]),
]

interface Draft {
  id: string
  unit: number
  title: string
  stem: string
  d: 1 | 2 | 3 | 4 | 5
  tags: string[]
  keys: number
  approach: string
  ideas: string[]
  pitfalls: string[]
  proof: string
  auto?: boolean
}

const D = (x: Draft): BankProblem => ({
  id: x.id,
  unit: x.unit,
  title: x.title,
  stem: x.stem,
  difficulty: x.d,
  tags: x.tags,
  keyCount: x.keys,
  ...(x.auto ? { autoImported: true, layers: 2 } : {}),
  solution: { approach: x.approach, keyIdeas: x.ideas, pitfalls: x.pitfalls, referenceProof: x.proof },
})

export const BANK: BankProblem[] = [
  D({ id: 'sup-1', unit: 0, title: '上确界的刻画', stem: '设非空有界集 $S\\subset\\mathbb R$，$\\beta=\\sup S$。证明：对任意 $\\varepsilon>0$，存在 $x\\in S$ 使 $x>\\beta-\\varepsilon$。', d: 1, tags: ['上确界'], keys: 3,
    approach: '用反证法：假设某个 $\\varepsilon$ 下找不到这样的 $x$，那么 $\\beta-\\varepsilon$ 本身就是 $S$ 的上界，和“最小上界”矛盾。',
    ideas: ['上确界是最小的上界。', '否定“存在”得到“所有 $x\\le\\beta-\\varepsilon$”。', '得到一个比 $\\beta$ 更小的上界。'], pitfalls: ['把上确界误当成最大值：它不一定属于 $S$。'],
    proof: '假设存在 $\\varepsilon_0>0$，使得对所有 $x\\in S$ 都有 $x\\le\\beta-\\varepsilon_0$。则 $\\beta-\\varepsilon_0$ 是 $S$ 的上界，且小于 $\\beta$，与 $\\beta$ 是最小上界矛盾。故结论成立。' }),
  D({ id: 'sup-2', unit: 0, title: '两集合和的上确界', stem: '设 $A,B$ 为非空有上界的数集，$A+B=\\{a+b\\mid a\\in A,b\\in B\\}$。证明 $\\sup(A+B)=\\sup A+\\sup B$。', d: 3, tags: ['上确界', '集合运算'], keys: 4,
    approach: '分两个方向：先说明 $\\sup A+\\sup B$ 是 $A+B$ 的上界，再说明它不能再小——用上确界的 $\\varepsilon$ 刻画。',
    ideas: ['每个 $a+b\\le\\sup A+\\sup B$，所以是上界。', '任取 $\\varepsilon>0$，分别在 $A$、$B$ 中取接近上确界的点。', '两个 $\\varepsilon/2$ 相加得到 $\\varepsilon$。', '上界且不能更小，就是上确界。'], pitfalls: ['只证了“$\\le$”一个方向。', '取点时忘了用 $\\varepsilon/2$，最后凑不出 $\\varepsilon$。'],
    proof: '记 $\\alpha=\\sup A,\\beta=\\sup B$。对任意 $a\\in A,b\\in B$ 有 $a+b\\le\\alpha+\\beta$，故 $\\alpha+\\beta$ 是 $A+B$ 的上界。对任意 $\\varepsilon>0$，取 $a>\\alpha-\\varepsilon/2$，$b>\\beta-\\varepsilon/2$，则 $a+b>\\alpha+\\beta-\\varepsilon$。因此 $\\alpha+\\beta$ 是最小上界，即 $\\sup(A+B)=\\alpha+\\beta$。' }),
  D({ id: 'sup-3', unit: 0, title: '阿基米德性质', stem: '证明：对任意正实数 $a$，存在正整数 $n$ 使 $n>a$。', d: 2, tags: ['确界原理'], keys: 3,
    approach: '反证：若正整数集有上界，由确界原理它有上确界，再用上确界的 $\\varepsilon$ 刻画造出矛盾。',
    ideas: ['假设 $\\mathbb N^+$ 有上界 $a$。', '确界原理给出 $\\sup\\mathbb N^+=\\beta$。', '取 $n>\\beta-1$，则 $n+1>\\beta$ 与上界矛盾。'], pitfalls: ['直接说“显然”：这正是需要证明的性质。'],
    proof: '若不然，$\\mathbb N^+$ 有上界，由确界原理有上确界 $\\beta$。取 $n\\in\\mathbb N^+$ 使 $n>\\beta-1$，则 $n+1>\\beta$，而 $n+1\\in\\mathbb N^+$，与 $\\beta$ 是上界矛盾。' }),

  D({ id: 'fn-1', unit: 1, title: '单调函数的复合', stem: '设 $f,g$ 均在 $\\mathbb R$ 上单调递增，证明 $f\\circ g$ 单调递增。', d: 1, tags: ['单调性', '复合'], keys: 2,
    approach: '任取 $x_1<x_2$，先用 $g$ 递增，再用 $f$ 递增，两步各用一次定义。',
    ideas: ['由 $g$ 递增得 $g(x_1)\\le g(x_2)$。', '再由 $f$ 递增得 $f(g(x_1))\\le f(g(x_2))$。'], pitfalls: ['把“递增”写成严格不等号时，别漏了等号情形。'],
    proof: '任取 $x_1<x_2$。因 $g$ 递增，$g(x_1)\\le g(x_2)$。因 $f$ 递增，$f(g(x_1))\\le f(g(x_2))$。故 $f\\circ g$ 递增。' }),
  D({ id: 'fn-2', unit: 1, title: '有界函数之和', stem: '设 $f,g$ 在区间 $I$ 上有界，证明 $f+g$ 在 $I$ 上有界。', d: 1, tags: ['有界性'], keys: 2,
    approach: '写出 $f,g$ 各自的界，用三角不等式把两个界相加。',
    ideas: ['存在 $M_1,M_2$ 使 $|f|\\le M_1,|g|\\le M_2$。', '$|f+g|\\le|f|+|g|\\le M_1+M_2$。'], pitfalls: ['两个界要取同一个区间上的，别混用不同区间。'],
    proof: '设 $|f(x)|\\le M_1,|g(x)|\\le M_2$ 对一切 $x\\in I$ 成立，则 $|f(x)+g(x)|\\le M_1+M_2$。' }),
  D({ id: 'fn-3', unit: 1, title: '周期函数的和', stem: '设 $f$ 的周期为 $2$，$g$ 的周期为 $3$。证明 $f+g$ 是周期函数，并给出一个周期。', d: 2, tags: ['周期性'], keys: 3,
    approach: '找 $2$ 和 $3$ 的公倍数 $6$，验证平移 $6$ 后两个函数都不变。',
    ideas: ['$f(x+6)=f(x)$，因为 $6$ 是 $2$ 的整数倍。', '$g(x+6)=g(x)$，因为 $6$ 是 $3$ 的整数倍。', '相加即得 $(f+g)(x+6)=(f+g)(x)$。'], pitfalls: ['周期的和不一定是周期：要用公倍数，而不是 $2+3$。'],
    proof: '对任意 $x$，$f(x+6)=f(x+2\\cdot3)=f(x)$，$g(x+6)=g(x+3\\cdot2)=g(x)$，于是 $(f+g)(x+6)=(f+g)(x)$，故 $6$ 是 $f+g$ 的一个周期。' }),

  D({ id: 'seq-1', unit: 2, title: '常数列的极限', stem: '用 $\\varepsilon$-$N$ 定义证明 $\\lim_{n\\to\\infty}\\frac{1}{n}=0$。', d: 1, tags: ['ε-N'], keys: 3,
    approach: '从 $|1/n-0|<\\varepsilon$ 直接解出 $n>1/\\varepsilon$，取 $N$ 为不小于 $1/\\varepsilon$ 的整数。',
    ideas: ['化简 $|a_n-0|=1/n$。', '解不等式 $1/n<\\varepsilon$ 得 $n>1/\\varepsilon$。', '取 $N=\\lceil 1/\\varepsilon\\rceil$。'], pitfalls: ['$N$ 只能依赖 $\\varepsilon$，不能出现 $n$。'],
    proof: '任取 $\\varepsilon>0$，取 $N=\\lceil1/\\varepsilon\\rceil$。当 $n>N$ 时，$|1/n-0|=1/n<1/N\\le\\varepsilon$。故极限为 $0$。' }),
  D({ id: 'seq-2', unit: 2, title: '分式数列的极限', stem: '用 $\\varepsilon$-$N$ 定义证明 $\\lim_{n\\to\\infty}\\frac{2n+1}{n+3}=2$。', d: 2, tags: ['ε-N', '放缩'], keys: 4,
    approach: '先化简 $|a_n-2|$，通分后得到 $\\frac{5}{n+3}$；放大成 $\\frac5n$，再倒推 $N$。',
    ideas: ['通分：$\\frac{2n+1}{n+3}-2=\\frac{-5}{n+3}$。', '放大：$\\frac5{n+3}<\\frac5n$。', '取 $N=\\lceil5/\\varepsilon\\rceil$。', '用不等号链连到 $\\varepsilon$。'], pitfalls: ['放大时方向反了，把式子变小了。'],
    proof: '任取 $\\varepsilon>0$，取 $N=\\lceil5/\\varepsilon\\rceil$。当 $n>N$ 时，$\\left|\\frac{2n+1}{n+3}-2\\right|=\\frac5{n+3}<\\frac5n<\\frac5N\\le\\varepsilon$。' }),
  D({ id: 'seq-3', unit: 2, title: '根式数列的极限', stem: '用 $\\varepsilon$-$N$ 定义证明 $\\lim_{n\\to\\infty}\\sqrt{n+1}-\\sqrt n=0$。', d: 3, tags: ['ε-N', '有理化'], keys: 4,
    approach: '先有理化：$\\sqrt{n+1}-\\sqrt n=\\frac1{\\sqrt{n+1}+\\sqrt n}$，再放大成 $\\frac1{\\sqrt n}$。',
    ideas: ['有理化把差变成商。', '分母放小，分式放大：$\\frac1{\\sqrt{n+1}+\\sqrt n}<\\frac1{\\sqrt n}$。', '解 $1/\\sqrt n<\\varepsilon$ 得 $n>1/\\varepsilon^2$。', '取 $N=\\lceil1/\\varepsilon^2\\rceil$。'], pitfalls: ['直接对差做放缩，找不到只含 $n$ 的上界。'],
    proof: '任取 $\\varepsilon>0$，取 $N=\\lceil1/\\varepsilon^2\\rceil$。当 $n>N$ 时，$0<\\sqrt{n+1}-\\sqrt n=\\frac1{\\sqrt{n+1}+\\sqrt n}<\\frac1{\\sqrt n}<\\frac1{\\sqrt N}\\le\\varepsilon$。' }),
  D({ id: 'seq-4', unit: 2, title: '几何数列的极限', stem: '设 $|q|<1$，用 $\\varepsilon$-$N$ 定义证明 $\\lim_{n\\to\\infty}q^n=0$。', d: 3, tags: ['ε-N', '指数'], keys: 4,
    approach: '$q=0$ 平凡。否则写 $|q|=\\frac1{1+h}$（$h>0$），用伯努利不等式 $(1+h)^n\\ge1+nh$ 放大。',
    ideas: ['把 $|q|<1$ 改写成 $|q|=1/(1+h)$。', '伯努利不等式：$(1+h)^n\\ge nh$。', '$|q|^n\\le\\frac1{nh}$。', '取 $N=\\lceil1/(h\\varepsilon)\\rceil$。'], pitfalls: ['忘了 $q=0$ 的情形。'],
    proof: '$q=0$ 时显然。否则 $|q|=\\frac1{1+h}$，$h>0$。$|q^n|=\\frac1{(1+h)^n}\\le\\frac1{nh}$。任取 $\\varepsilon>0$，取 $N=\\lceil1/(h\\varepsilon)\\rceil$，当 $n>N$ 时 $|q^n|<\\varepsilon$。' }),

  D({ id: 'mono-1', unit: 3, title: '夹逼求极限', stem: '求 $\\lim_{n\\to\\infty}\\frac{\\sin n}{n}$，并证明。', d: 1, tags: ['夹逼'], keys: 2,
    approach: '$|\\sin n|\\le1$，把数列夹在 $-\\frac1n$ 与 $\\frac1n$ 之间，两边极限都是 $0$。',
    ideas: ['$-\\frac1n\\le\\frac{\\sin n}n\\le\\frac1n$。', '两端极限都为 $0$，夹逼准则给出极限为 $0$。'], pitfalls: ['$\\sin n$ 的极限不存在，不能拆成两个极限相乘。'],
    proof: '因为 $|\\sin n|\\le1$，所以 $-\\frac1n\\le\\frac{\\sin n}n\\le\\frac1n$。又 $\\pm\\frac1n\\to0$，由夹逼准则得极限为 $0$。' }),
  D({ id: 'mono-2', unit: 3, title: '单调有界数列', stem: '设 $a_1=1,\\ a_{n+1}=\\sqrt{2+a_n}$。证明 $\\{a_n\\}$ 收敛并求极限。', d: 4, tags: ['单调有界', '递推'], keys: 5,
    approach: '先用归纳法证明 $a_n<2$ 且单调递增，由单调有界定理得收敛；再对递推式两边取极限解方程。',
    ideas: ['归纳：$a_n<2\\Rightarrow a_{n+1}<\\sqrt4=2$。', '归纳：$a_{n+1}-a_n>0$ 由 $a_{n+1}^2-a_n^2=a_n-a_{n-1}$ 得出。', '单调有界定理给出极限 $A$ 存在。', '两边取极限：$A=\\sqrt{2+A}$。', '舍去 $A=-1$，得 $A=2$。'], pitfalls: ['先假设极限存在再解方程：必须先证明收敛。', '解出两个根后忘了舍去负根。'],
    proof: '由 $a_1=1<2$ 及 $a_n<2\\Rightarrow a_{n+1}<2$ 知有上界 $2$。又 $a_2>a_1$，且 $a_{n+1}-a_n$ 与 $a_n-a_{n-1}$ 同号，故递增。由单调有界定理极限 $A$ 存在。令 $n\\to\\infty$ 得 $A^2=2+A$，$A=2$。' }),
  D({ id: 'mono-3', unit: 3, title: '子列判别发散', stem: '证明数列 $a_n=(-1)^n$ 发散。', d: 2, tags: ['子列'], keys: 3,
    approach: '取偶数项和奇数项两个子列，极限不同，而收敛数列的所有子列极限相同。',
    ideas: ['偶子列恒为 $1$。', '奇子列恒为 $-1$。', '收敛数列的子列与原数列极限相同，矛盾。'], pitfalls: ['只算了一个子列就下结论。'],
    proof: '若 $a_n\\to A$，则子列 $a_{2k}=1\\to A$ 且 $a_{2k+1}=-1\\to A$，于是 $1=A=-1$，矛盾。故发散。' }),
  D({ id: 'mono-4', unit: 3, title: 'e 的单调有界', stem: '证明数列 $x_n=\\left(1+\\frac1n\\right)^n$ 单调递增且有上界。', d: 5, tags: ['单调有界', '均值不等式'], keys: 5,
    approach: '用均值不等式分别证明单调性（对 $n+1$ 个数应用）与上界（和 $\\left(1+\\frac1n\\right)^{n+1}$ 比较）。',
    ideas: ['把 $x_n$ 写成 $n+1$ 个数的几何平均，其中一个数是 $1$。', '均值不等式给出 $x_n<x_{n+1}$。', '构造 $y_n=\\left(1+\\frac1n\\right)^{n+1}$ 递减。', '$x_n<y_n\\le y_1=4$。', '单调有界定理。'], pitfalls: ['均值不等式取等条件被忽略：这里各数不全相等，所以是严格不等号。'],
    proof: '对 $n+1$ 个正数 $1,\\ 1+\\frac1n,\\dots,1+\\frac1n$ 应用均值不等式得 $x_n<x_{n+1}$。同理 $y_n=\\left(1+\\frac1n\\right)^{n+1}$ 递减，故 $x_n<y_n\\le y_1=4$。' }),

  D({ id: 'fl-1', unit: 4, title: '线性函数的极限', stem: '用 $\\varepsilon$-$\\delta$ 定义证明 $\\lim_{x\\to2}(3x-1)=5$。', d: 1, tags: ['ε-δ'], keys: 3, auto: true,
    approach: '$|3x-1-5|=3|x-2|$，所以令 $\\delta=\\varepsilon/3$ 即可。',
    ideas: ['化简 $|f(x)-5|=3|x-2|$。', '解 $3|x-2|<\\varepsilon$。', '取 $\\delta=\\varepsilon/3$。'], pitfalls: ['$\\delta$ 不能依赖 $x$。'],
    proof: '任取 $\\varepsilon>0$，取 $\\delta=\\varepsilon/3$。当 $0<|x-2|<\\delta$ 时，$|3x-1-5|=3|x-2|<\\varepsilon$。' }),
  D({ id: 'fl-2', unit: 4, title: '平方函数的极限', stem: '用 $\\varepsilon$-$\\delta$ 定义证明 $\\lim_{x\\to3}x^2=9$。', d: 2, tags: ['ε-δ', '限定范围'], keys: 4, auto: true,
    approach: '$|x^2-9|=|x-3||x+3|$。先限定 $|x-3|<1$，使 $|x+3|<7$，再取 $\\delta=\\min\\{1,\\varepsilon/7\\}$。',
    ideas: ['因式分解出 $|x-3|$。', '限定 $\\delta\\le1$ 控制 $|x+3|<7$。', '取两个条件的较小者。', '串成不等式链。'], pitfalls: ['不限定范围，$|x+3|$ 没有界。'],
    proof: '任取 $\\varepsilon>0$，取 $\\delta=\\min\\{1,\\varepsilon/7\\}$。当 $0<|x-3|<\\delta$ 时，$|x+3|<7$，故 $|x^2-9|=|x-3||x+3|<7\\delta\\le\\varepsilon$。' }),
  D({ id: 'fl-3', unit: 4, title: '倒数函数的极限', stem: '用 $\\varepsilon$-$\\delta$ 定义证明 $\\lim_{x\\to2}\\frac1x=\\frac12$。', d: 3, tags: ['ε-δ'], keys: 4, auto: true,
    approach: '$\\left|\\frac1x-\\frac12\\right|=\\frac{|x-2|}{2|x|}$。限定 $|x-2|<1$ 得 $x>1$，从而 $\\frac1{2|x|}<\\frac12$。',
    ideas: ['通分得到 $\\frac{|x-2|}{2|x|}$。', '限定 $|x-2|<1$ 把 $x$ 拉离 $0$。', '分母下界 $x>1$。', '取 $\\delta=\\min\\{1,2\\varepsilon\\}$。'], pitfalls: ['忘了限定范围，分母可能接近 $0$。'],
    proof: '任取 $\\varepsilon>0$，取 $\\delta=\\min\\{1,2\\varepsilon\\}$。当 $0<|x-2|<\\delta$ 时 $x>1$，$\\left|\\frac1x-\\frac12\\right|=\\frac{|x-2|}{2x}<\\frac{|x-2|}2<\\varepsilon$。' }),

  D({ id: 'lp-1', unit: 5, title: '保号性', stem: '设 $\\lim_{x\\to a}f(x)=A>0$。证明存在 $\\delta>0$，使 $0<|x-a|<\\delta$ 时 $f(x)>A/2$。', d: 2, tags: ['保号性'], keys: 3,
    approach: '把 $\\varepsilon$ 取成 $A/2$ 用极限的定义，再把绝对值不等式拆开。',
    ideas: ['取 $\\varepsilon=A/2$。', '得到 $|f(x)-A|<A/2$。', '拆开得 $f(x)>A/2$。'], pitfalls: ['$\\varepsilon$ 取成 $A$ 只能得到 $f(x)>0$。'],
    proof: '取 $\\varepsilon=A/2$，由极限定义存在 $\\delta>0$，当 $0<|x-a|<\\delta$ 时 $|f(x)-A|<A/2$，即 $f(x)>A/2$。' }),
  D({ id: 'lp-2', unit: 5, title: '局部有界', stem: '设 $\\lim_{x\\to a}f(x)$ 存在，证明 $f$ 在 $a$ 的某个去心邻域内有界。', d: 2, tags: ['局部有界'], keys: 3,
    approach: '取 $\\varepsilon=1$ 用定义，得到 $|f(x)|<|A|+1$。',
    ideas: ['取 $\\varepsilon=1$。', '$|f(x)|\\le|f(x)-A|+|A|$。', '得到界 $|A|+1$。'], pitfalls: ['局部有界不能推出整体有界。'],
    proof: '设极限为 $A$，取 $\\varepsilon=1$，存在 $\\delta>0$ 使 $0<|x-a|<\\delta$ 时 $|f(x)-A|<1$，于是 $|f(x)|<|A|+1$。' }),
  D({ id: 'lp-3', unit: 5, title: '复合函数的极限', stem: '设 $\\lim_{x\\to a}g(x)=b$，$f$ 在 $b$ 连续。证明 $\\lim_{x\\to a}f(g(x))=f(b)$。', d: 4, tags: ['复合', '连续'], keys: 4, auto: true,
    approach: '对 $f(b)$ 处的 $\\varepsilon$ 先找 $f$ 的 $\\eta$，再对 $g$ 用 $\\eta$ 找 $\\delta$，两步串联。',
    ideas: ['由 $f$ 在 $b$ 连续，对 $\\varepsilon$ 取 $\\eta$。', '对 $g$ 的极限用 $\\eta$ 取 $\\delta$。', '得到 $\\delta$。', '串联得 $|f(g(x))-f(b)|<\\varepsilon$。'], pitfalls: ['把 $g(x)=b$ 当成已知：去心邻域里 $g(x)$ 可能等于 $b$，需要 $f$ 在 $b$ 连续才能放行。'],
    proof: '任取 $\\varepsilon>0$。由 $f$ 在 $b$ 连续，存在 $\\eta>0$ 使 $|y-b|<\\eta$ 时 $|f(y)-f(b)|<\\varepsilon$。又存在 $\\delta>0$ 使 $0<|x-a|<\\delta$ 时 $|g(x)-b|<\\eta$。于是 $|f(g(x))-f(b)|<\\varepsilon$。' }),

  D({ id: 'ct-1', unit: 6, title: '连续函数的和', stem: '设 $f,g$ 在 $x_0$ 连续，证明 $f+g$ 在 $x_0$ 连续。', d: 1, tags: ['连续'], keys: 2, auto: true,
    approach: '对 $f,g$ 各取 $\\varepsilon/2$，两个 $\\delta$ 取较小者。',
    ideas: ['分别取 $\\delta_1,\\delta_2$。', '取 $\\delta=\\min\\{\\delta_1,\\delta_2\\}$ 并用三角不等式。'], pitfalls: ['忘了把 $\\varepsilon$ 对半分。'],
    proof: '任取 $\\varepsilon>0$，取 $\\delta_1,\\delta_2$ 使 $|x-x_0|<\\delta_i$ 时 $|f(x)-f(x_0)|<\\varepsilon/2$、$|g(x)-g(x_0)|<\\varepsilon/2$。取 $\\delta=\\min\\{\\delta_1,\\delta_2\\}$，则 $|(f+g)(x)-(f+g)(x_0)|<\\varepsilon$。' }),
  D({ id: 'ct-2', unit: 6, title: '方程根的存在性', stem: '证明方程 $x^3+x-1=0$ 在 $(0,1)$ 内至少有一个根。', d: 2, tags: ['介值定理'], keys: 3,
    approach: '令 $f(x)=x^3+x-1$，在闭区间 $[0,1]$ 上连续，检验端点函数值异号，再用介值定理。',
    ideas: ['$f$ 在 $[0,1]$ 连续。', '$f(0)=-1<0,\\ f(1)=1>0$。', '介值定理给出 $\\xi\\in(0,1)$ 使 $f(\\xi)=0$。'], pitfalls: ['没有说明连续性就直接用介值定理。'],
    proof: '$f(x)=x^3+x-1$ 在 $[0,1]$ 连续，$f(0)=-1<0<1=f(1)$，由介值定理存在 $\\xi\\in(0,1)$ 使 $f(\\xi)=0$。' }),
  D({ id: 'ct-3', unit: 6, title: '不动点存在', stem: '设 $f:[0,1]\\to[0,1]$ 连续。证明存在 $\\xi\\in[0,1]$ 使 $f(\\xi)=\\xi$。', d: 3, tags: ['介值定理', '不动点'], keys: 4,
    approach: '构造辅助函数 $g(x)=f(x)-x$，在端点处变号（或为零），用介值定理。',
    ideas: ['定义 $g(x)=f(x)-x$。', '$g(0)=f(0)\\ge0$，$g(1)=f(1)-1\\le0$。', '若端点已为零直接结束。', '否则介值定理给出零点。'], pitfalls: ['忘了端点恰好是不动点的情形。'],
    proof: '令 $g(x)=f(x)-x$，连续。$g(0)=f(0)\\ge0$，$g(1)=f(1)-1\\le0$。若某端点处为零则取之；否则 $g(0)>0>g(1)$，由介值定理存在 $\\xi\\in(0,1)$ 使 $g(\\xi)=0$。' }),
  D({ id: 'ct-4', unit: 6, title: '连续函数的最值', stem: '设 $f$ 在 $[a,b]$ 连续，证明 $f$ 在 $[a,b]$ 上有界。', d: 4, tags: ['闭区间性质'], keys: 4, auto: true,
    approach: '反证：若无界，取点列 $x_n$ 使 $|f(x_n)|>n$，由致密性取收敛子列，用连续性得到矛盾。',
    ideas: ['假设无界，造点列 $|f(x_n)|>n$。', '致密性定理取收敛子列 $x_{n_k}\\to c$。', '$c\\in[a,b]$，连续性给 $f(x_{n_k})\\to f(c)$。', '但 $|f(x_{n_k})|>n_k\\to\\infty$，矛盾。'], pitfalls: ['混淆开区间与闭区间：开区间上连续函数可以无界。'],
    proof: '若不然，对每个 $n$ 取 $x_n\\in[a,b]$ 使 $|f(x_n)|>n$。有界点列有收敛子列 $x_{n_k}\\to c\\in[a,b]$，由连续性 $f(x_{n_k})\\to f(c)$，与 $|f(x_{n_k})|>n_k\\to\\infty$ 矛盾。' }),

  D({ id: 'pos-1', unit: 7, title: 'p 级数的收敛性', stem: '证明 $\\sum\\frac1{n^2}$ 收敛。', d: 2, tags: ['正项级数', '比较'], keys: 3, auto: true,
    approach: '把 $\\frac1{n^2}$ 放大到可裂项的 $\\frac1{n(n-1)}$，部分和就能算出来，有上界的正项级数收敛。',
    ideas: ['$n\\ge2$ 时 $\\frac1{n^2}<\\frac1{n(n-1)}=\\frac1{n-1}-\\frac1n$。', '部分和被 $2$ 控制。', '正项级数部分和有界即收敛。'], pitfalls: ['只验证一般项趋于 $0$：这是必要条件，不是充分条件。'],
    proof: '对 $n\\ge2$，$\\frac1{n^2}<\\frac1{n-1}-\\frac1n$，故 $S_n<1+\\left(1-\\frac1n\\right)<2$。正项级数部分和有上界，故收敛。' }),
  D({ id: 'pos-2', unit: 7, title: '比值判别法', stem: '判断 $\\sum\\frac{n!}{n^n}$ 的敛散性。', d: 3, tags: ['比值判别'], keys: 4, auto: true,
    approach: '计算相邻项比值的极限，得到 $1/e<1$，用比值判别法判定收敛。',
    ideas: ['$\\frac{a_{n+1}}{a_n}=\\left(1+\\frac1n\\right)^{-n}$。', '极限为 $e^{-1}$。', '$e^{-1}<1$，比值判别法给出收敛。'], pitfalls: ['比值极限等于 $1$ 时该方法失效，这里不是这种情形。'],
    proof: '$\\frac{a_{n+1}}{a_n}=\\frac{(n+1)!\\,n^n}{(n+1)^{n+1}n!}=\\left(\\frac n{n+1}\\right)^n\\to e^{-1}<1$，由比值判别法级数收敛。' }),
  D({ id: 'pos-3', unit: 7, title: '调和级数发散', stem: '证明调和级数 $\\sum\\frac1n$ 发散。', d: 3, tags: ['正项级数', '分组'], keys: 3, auto: true,
    approach: '把部分和按 $2^k$ 分组，每组之和不小于 $\\frac12$，所以部分和趋于无穷。',
    ideas: ['考察 $S_{2^k}$。', '第 $k$ 组共 $2^{k-1}$ 项，每项 $\\ge\\frac1{2^k}$，组和 $\\ge\\frac12$。', '$S_{2^k}\\ge1+\\frac k2\\to\\infty$。'], pitfalls: ['用一般项趋于 $0$ 推断收敛。'],
    proof: '$S_{2^k}=1+\\frac12+\\left(\\frac13+\\frac14\\right)+\\cdots\\ge1+\\frac k2$，无界，故发散。' }),

  D({ id: 'alt-1', unit: 8, title: '莱布尼茨判别法', stem: '证明 $\\sum_{n=1}^{\\infty}\\frac{(-1)^{n-1}}n$ 收敛。', d: 2, tags: ['交错级数'], keys: 3, auto: true,
    approach: '验证两个条件：$u_n=\\frac1n$ 单调递减、趋于 $0$，由莱布尼茨判别法收敛。',
    ideas: ['$u_n$ 单调递减。', '$u_n\\to0$。', '莱布尼茨判别法。'], pitfalls: ['漏掉单调性这个条件。'],
    proof: '$u_n=\\frac1n$ 单调递减且趋于 $0$，由莱布尼茨判别法，交错级数收敛。' }),
  D({ id: 'alt-2', unit: 8, title: '绝对收敛', stem: '证明 $\\sum\\frac{(-1)^n}{n^2}$ 绝对收敛。', d: 1, tags: ['绝对收敛'], keys: 2, auto: true,
    approach: '取绝对值得到 $\\sum\\frac1{n^2}$，它是 $p=2$ 的 $p$ 级数，收敛。',
    ideas: ['绝对值级数是 $p$ 级数。', '$p=2>1$，收敛，所以原级数绝对收敛。'], pitfalls: ['绝对收敛要看的是取绝对值之后的级数。'],
    proof: '$\\sum\\left|\\frac{(-1)^n}{n^2}\\right|=\\sum\\frac1{n^2}$ 收敛，故原级数绝对收敛。' }),
  D({ id: 'alt-3', unit: 8, title: '条件收敛的判定', stem: '判断 $\\sum\\frac{(-1)^{n-1}}{\\sqrt n}$ 是发散、条件收敛还是绝对收敛，并证明。', d: 3, tags: ['交错级数', '条件收敛'], keys: 5, auto: true,
    approach: '先用莱布尼茨判别法证明收敛，再看绝对值级数 $\\sum\\frac1{\\sqrt n}$ 是 $p=\\frac12\\le1$ 的 $p$ 级数，发散，因此条件收敛。',
    ideas: ['$u_n=\\frac1{\\sqrt n}$ 单调递减。', '$u_n\\to0$。', '莱布尼茨判别法给出收敛。', '绝对值级数发散。', '收敛而不绝对收敛，即条件收敛。'], pitfalls: ['把“绝对值级数发散”当成“原级数发散”。'],
    proof: '$u_n=\\frac1{\\sqrt n}$ 递减趋于 $0$，原级数收敛；$\\sum|a_n|=\\sum\\frac1{\\sqrt n}$ 是 $p=\\frac12\\le1$ 的 $p$ 级数，发散。故条件收敛。' }),
]

export function bandOf(difficulty: number): DifficultyBand {
  if (difficulty <= 2) return 'easy'
  if (difficulty === 3) return 'medium'
  return 'hard'
}
