/**
 * 第 1 层微课 + 第 4–6 层 + 证明本的 mock 内容（issue #26）。
 *
 * 内容来源（不自己发明数学内容）：
 * - 微课：contracts/seed/concepts.json 的 seq-limit（5 步，含 seq-band 图解与小核验）。
 * - 自检：seed/epsN.json 的 selfcheckBank（挑 3 道，题面里的行号按 l3 mock 的 2 行替换）。
 * - 迁移题：seed/epsN-T1.json 的 public.stem。
 * - 总结五问：01-产品总规格.md L6 原文。
 * 真实接口接入后这些内容都由服务端下发（#24），前端只渲染。
 */
import type { LessonView, NotebookView, SelfcheckItem, TransferView } from '@/types/attempt'

/**
 * 第 1 层微课（concept: seq-limit）：直观 → 对应 → 失真 → 边界 → 回到定义。
 * 每步一道小核验；answer 不参与前端判定展示（前端只显示学生选了哪个、服务端说对/错）。
 * 前端这里只做「答对才能下一步」的交互，不判断数学对错 —— mock 数据自带 answer 仅用于离线演示。
 */
export const mockLesson: LessonView = {
  conceptId: 'seq-limit',
  title: '数列极限（ε-N）',
  generated: null,
  steps: [
    {
      id: 's1',
      kind: 'intuition',
      text: '先看一个例子：$a_n=1+\\frac{(-1)^n}{n}$。拖动下面的滑块改变带子半宽 $\\varepsilon$，看看从第几项起，点都落在带子里。',
      visual: {
        type: 'seq-band',
        title: 'ε 带',
        params: {
          expr: '1+(-1)^n/n',
          exprLatex: '$a_n=1+\\frac{(-1)^n}{n}$',
          limit: 1,
          epsilon: { min: 0.02, max: 0.6, init: 0.3, step: 0.01 },
          nMax: 60,
          showN: true,
          // #26 微课例子 a_n = 1 + (-1)^n/n 的序列点（预生成；避免在执行期解析 expr，真实接口 #24 再适配）
          points: Array.from({ length: 60 }, (_, index) => {
            const n = index + 1
            return { n, a: 1 + (n % 2 === 0 ? 1 : -1) / n }
          }),
        },
      },
      check: {
        q: '把 $\\varepsilon$ 调小，需要的 $N$ 会怎样？',
        options: ['变大或不变', '变小'],
        answer: 0,
        right: '对。带子越窄，要等得越久，所以 $N$ 跟着 $\\varepsilon$ 变。',
        wrong: '再拖一次滑块，看看图上标出的 $N$ 往哪边走。',
      },
    },
    {
      id: 's2',
      kind: 'map',
      text: '把刚才看到的三件事翻译成符号：带子半宽是 $\\varepsilon$；"从某一项起"是 $\\exists N,\\ \\forall n>N$；"在带子里"是 $|a_n-A|<\\varepsilon$。',
      check: {
        q: '"在带子里"对应哪个式子？',
        options: ['$|a_n-A|<\\varepsilon$', '$a_n<\\varepsilon$', '$|a_n-A|>\\varepsilon$'],
        answer: 0,
        right: '对。带子以 $A$ 为中心，所以量的是 $a_n$ 到 $A$ 的距离。',
        wrong: '带子的中心在哪里？距离要从中心量起。',
      },
    },
    {
      id: 's3',
      kind: 'distortion',
      text: '顺序不能换：先给 $\\varepsilon$，再找 $N$，$N$ 可以随 $\\varepsilon$ 变。写成 "$\\exists N,\\ \\forall\\varepsilon$" 就变成一个 $N$ 对所有带子都管用，这强得多，一般不成立。',
      check: {
        q: '下面哪种写法的量词顺序是对的？',
        options: ['$\\forall\\varepsilon>0,\\ \\exists N$', '$\\exists N,\\ \\forall\\varepsilon>0$'],
        answer: 0,
        right: '对。$N$ 是在拿到 $\\varepsilon$ 之后才定的。',
        wrong: '想一想：带子越窄 $N$ 要越大，那 $N$ 能在 $\\varepsilon$ 之前定死吗？',
      },
    },
    {
      id: 's4',
      kind: 'boundary',
      text: '边界情况：常数列也有极限。"越来越近"不是定义的一部分。',
      check: {
        q: '常数列 $a_n=2$ 以 $2$ 为极限吗？',
        options: ['是', '不是'],
        answer: 0,
        right: '是。任取 $\\varepsilon>0$，取 $N=1$ 就行。',
        wrong: '每一项到 2 的距离是 0，0 比任何正数都小。',
      },
    },
    {
      id: 's5',
      kind: 'return',
      text: '现在回到题目，用你自己的话或符号，把"数列 $\\{a_n\\}$ 以 $A$ 为极限"重新写一遍。',
    },
  ],
}

/** 第 4 层自检题（seed selfcheckBank 挑 3 道；行号按 mock 的 2 行证明替换）。 */
export const mockSelfcheckItems: SelfcheckItem[] = [
  { itemId: 'SC1', question: '第 2 行是由哪几行、用什么推出的？', status: 'open' },
  { itemId: 'SC2', question: '你的证明里，$N$ 起什么作用？它依赖哪些量？', status: 'open' },
  { itemId: 'SC3', question: '如果把 "$n>N$" 换成 "$n\\ge1$"，你的证明哪一行会断？', status: 'open' },
]

/** 第 5 层迁移题（seed/epsN-T1.json 的 public.stem；开始迁移时由服务端返回）。 */
export const mockTransferStem =
  '用 $\\varepsilon$-$\\delta$ 定义证明 $\\displaystyle\\lim_{x\\to 1}(2x+1)=3$。'

export const mockTransferNotStarted: TransferView = {
  childAttemptId: null,
  stem: null,
  status: 'not_started',
}

/** 第 6 层总结五问（01-产品总规格.md L6 原文）。 */
export const mockSummaryQuestions: string[] = [
  '这个证明证了什么？',
  '分几块？块与块之间是什么关系？',
  '哪个选择决定了成败？',
  '写到哪一步才算证完？',
  '哪个做法下次还能用、哪个只适用于本题？',
]

/** 证明本（mock：已完成作业列表 + 回到该题）。 */
export const mockNotebook: NotebookView = {
  cards: [
    {
      attemptId: '11111111-1111-4111-8111-111111111111',
      title: '数列极限 · ε-N',
      proof: [
        '任取 $\\varepsilon>0$。',
        '$|a_n-3|=\\left|\\frac{3n+1}{n+2}-3\\right|=\\frac{5}{n+2}<\\frac{5}{n}$。',
        '取 $N=\\left\\lceil\\frac{5}{\\varepsilon}\\right\\rceil$，当 $n>N$ 时 $|a_n-3|<\\varepsilon$。',
      ],
      summary: [
        '证了 $\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$。',
        '分两块：化简 $|a_n-3|$、放大并取只依赖 $\\varepsilon$ 的 $N$。',
      ],
      definition:
        '$\\lim_{n\\to\\infty}a_n=A\\iff\\forall\\varepsilon>0,\\ \\exists N,\\ \\forall n>N:\\ |a_n-A|<\\varepsilon$',
      weakPoints: ['取 $N$ 时容易写成依赖 $n$ 的式子'],
      completedAt: '2026-11-03T00:30:00.000Z',
      mock: 'completed',
    },
    {
      attemptId: '99999999-9999-4999-8999-999999999999',
      title: '交错级数 · 收敛性',
      proof: ['先判断：条件收敛。', '由莱布尼茨判别法，$\\sum(-1)^{n-1}\\frac{1}{n}$ 收敛。'],
      summary: ['证了交错调和级数条件收敛。'],
      definition: '$\\sum a_n$ 条件收敛 $\\iff$ 原级数收敛而 $\\sum|a_n|$ 发散。',
      weakPoints: [],
      completedAt: '2026-11-02T12:00:00.000Z',
      mock: 'completed',
    },
  ],
  toRedo: [],
}
