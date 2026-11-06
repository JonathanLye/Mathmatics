/**
 * 第 1 层微课 + 第 4–6 层 + 迁移题 + 证明本的 mock 内容（issue #26 / #47）。
 *
 * 内容来源（不自己发明数学内容）：
 * - 微课：contracts/seed/concepts.json 的 seq-limit（5 步，含 seq-band 图解与小核验）。
 * - 自检：seed/epsN.json 的 selfcheckBank（挑 4 道，题面里的行号按 l3 mock 的 2 行替换；维度用于自适应）。
 * - 迁移题：seed/epsN-T1.json 的 public（完整题目包：题面 + 六层只启用 L3）。
 * - 总结五问：01-产品总规格.md L6 原文。
 * - 证明本：已完成作答（独立度/教师标记/完成时间用于「稍后重做」分档与冷却）。
 * 真实接口接入后这些内容都由服务端下发（#24），前端只渲染。
 */
import type { LayerStatus, LessonView, NotebookView, ProblemView, SelfcheckItem, TransferView } from '@/types/attempt'

/**
 * 第 1 层微课（concept: seq-limit）：直观 → 对应 → 失真 → 边界 → 回到定义。
 * 每步一道小核验；answer 不参与前端判定展示（前端只显示学生选了哪个、服务端说对/错）。
 * s1 的 seq-band 与 s2 的 abs-triangle 是 #47 图解接线（abs-triangle 为 mock 扩展 type）。
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
      visual: {
        type: 'abs-triangle',
        title: '距离与绝对值',
        params: { a: 3, b: -1 },
      },
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

/**
 * AIGC 标识 mock（Refs #37 / task-90；只用于 UI/测试，不是真实生成内容）。
 *
 * - 真实口径：LessonView.generated 由 B 侧决定是否下发；当前 P0 不启用生成，因此默认 null；
 * - 本 mock 只在测试/演示 URL 带 ?aigc=1 时由 api/client.ts 的 fetchLesson 返回（见 mocks/README.md）；
 * - 文本故意写成占位说明，避免被误当成真实 AI 数学内容；标识渲染由 AiGeneratedTag 统一负责。
 */
export const MOCK_AIGC_GENERATED_TEXT =
  '（mock）这是一条 AI 生成的补充讲解占位文本，仅用于验证「AI 生成 · 仅作学习提示」标识的渲染；不代表真实生成内容。'

/** 带 generated 的微课副本（mock=true 时由 fetchLesson 在 ?aigc=1 下返回）。 */
export const mockGeneratedLesson: LessonView = { ...mockLesson, generated: MOCK_AIGC_GENERATED_TEXT }

/** 取微课 mock：generated=false 时与线上默认一致（无 AI 生成内容）；true 时带占位 generated。 */
export function createMockLesson(options: { generated?: boolean } = {}): LessonView {
  return options.generated ? { ...mockLesson, generated: MOCK_AIGC_GENERATED_TEXT } : { ...mockLesson }
}

/**
 * 第 4 层自检题（seed selfcheckBank 挑 4 道；维度/次数为 #47 自适应接线所需的 mock 扩展字段）。
 * 行号按 mock 的 2 行证明替换；true/false 判定由 mock reducer（submitSelfcheck）写入 records。
 */
export const mockSelfcheckItems: SelfcheckItem[] = [
  { itemId: 'SC1', dimension: 'basis', attempts: 0, question: '第 2 行是由哪几行、用什么推出的？', status: 'open' },
  { itemId: 'SC2', dimension: 'role', attempts: 0, question: '你的证明里，$N$ 起什么作用？它依赖哪些量？', status: 'open' },
  { itemId: 'SC3', dimension: 'logic', attempts: 0, question: '如果把 "$n>N$" 换成 "$n\\ge1$"，你的证明哪一行会断？', status: 'open' },
  {
    itemId: 'SC5',
    dimension: 'condition',
    attempts: 0,
    question: '第 2 行把 $\\frac{5}{n+2}$ 放大成 $\\frac{5}{n}$ 时，用到了 $n$ 的什么性质？',
    status: 'open',
  },
]

/** 迁移题题目包（seed/epsN-T1.json 的 public 部分；kind=transfer，六层只启用 L3）。 */
export const mockTransferProblem: ProblemView = {
  problemId: 'epsN-T1',
  version: 1,
  title: '函数极限 · ε-δ（迁移）',
  stem: '用 $\\varepsilon$-$\\delta$ 定义证明 $\\displaystyle\\lim_{x\\to 1}(2x+1)=3$。',
  chapter: '第三章 函数极限',
  source: 'v3 原型自编',
  keyCount: 3,
  askChips: ['δ 和 ε 是什么关系？', '这一行在做什么？'],
}

/** 迁移题子作答的六层状态：只有 L3 启用（seed epsN-T1.layers）。 */
export function mockTransferLayers(): LayerStatus[] {
  const titles: Record<string, string> = {
    L1: '记忆核验',
    L2: '证明骨架',
    L3: '构造与推导',
    L4: '自检',
    L5: '迁移题',
    L6: '总结',
  }
  return (['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((layer) => ({
    layer,
    title: titles[layer],
    status: layer === 'L3' ? ('active' as const) : ('disabled' as const),
    enabled: layer === 'L3',
    skippable: false,
  }))
}

/** 迁移题（seed/epsN-T1.json 的 public.stem；开始迁移时由服务端返回）。 */
export const mockTransferStem = mockTransferProblem.stem

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

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()

/**
 * 证明本（mock：已完成作业列表 + 回到该题 + 「稍后重做」）。
 * 独立度/教师标记/完成时间用于 #47 redo.ts 的分档、排序与冷却（近日完成的题先不推）。
 */
export const mockNotebook: NotebookView = {
  cards: [
    {
      attemptId: '11111111-1111-4111-8111-111111111111',
      problemId: 'epsN',
      problemVersion: 1,
      kind: 'main',
      title: '数列极限 · ε-N',
      chapter: '第二章 数列极限',
      reviewPublished: true,
      teacherNote: '这道题的关键是 $N$ 只依赖 $\\varepsilon$，放大时注意方向。',
      canRedo: true,
      lines: [
        { n: 1, statement: '任取 $\\varepsilon>0$。' },
        { n: 2, statement: '$|a_n-3|=\\left|\\frac{3n+1}{n+2}-3\\right|=\\frac{5}{n+2}<\\frac{5}{n}$。', justification: '通分后放大分母' },
        { n: 3, statement: '取 $N=\\left\\lceil\\frac{5}{\\varepsilon}\\right\\rceil$，当 $n>N$ 时 $|a_n-3|<\\varepsilon$。', justification: '由上一步倒推 $N$' },
      ],
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
      independence: 0.42,
      revealUsed: 1.5,
      keysTotal: 4,
      redoRecommended: false,
      assignmentId: 'assignment-epsN',
      completedAt: daysAgo(10),
      mock: 'completed',
    },
    {
      attemptId: '99999999-9999-4999-8999-999999999999',
      problemId: 'series',
      problemVersion: 1,
      kind: 'main',
      title: '交错级数 · 收敛性',
      chapter: '第十二章 数项级数',
      proof: ['先判断：条件收敛。', '由莱布尼茨判别法，$\\sum(-1)^{n-1}\\frac{1}{n}$ 收敛。'],
      summary: ['证了交错调和级数条件收敛。'],
      definition: '$\\sum a_n$ 条件收敛 $\\iff$ 原级数收敛而 $\\sum|a_n|$ 发散。',
      weakPoints: [],
      independence: 0.92,
      revealUsed: 0,
      keysTotal: 3,
      redoRecommended: true,
      assignmentId: 'assignment-series',
      completedAt: daysAgo(5),
      mock: 'completed',
    },
    {
      attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      problemId: 'epsN-T1',
      problemVersion: 1,
      kind: 'transfer',
      title: '函数极限 · ε-δ（迁移）',
      chapter: '第三章 函数极限',
      proof: ['任取 ε>0，取 δ=ε/2。', '当 0<|x-1|<δ 时，$|(2x+1)-3|=2|x-1|<2\\delta=\\varepsilon$。'],
      summary: ['证了函数极限 $\\lim_{x\\to1}(2x+1)=3$。'],
      definition: '$\\lim_{x\\to x_0}f(x)=A$ 的 ε-δ 定义。',
      weakPoints: [],
      independence: 0.62,
      revealUsed: 0,
      keysTotal: 3,
      redoRecommended: false,
      assignmentId: 'assignment-epsN-T1',
      completedAt: daysAgo(12),
      mock: 'completed',
    },
    {
      attemptId: '77777777-7777-4777-8777-777777777777',
      problemId: 'monotone',
      problemVersion: 1,
      kind: 'main',
      title: '单调有界 · 收敛',
      chapter: '第二章 数列极限',
      proof: ['先证单调递增。', '再证有上界，由单调有界定理得收敛。'],
      summary: ['证了单调有界数列收敛。'],
      weakPoints: ['上界的取法还没想清楚'],
      independence: 0.38,
      revealUsed: 1,
      keysTotal: 2,
      redoRecommended: false,
      completedAt: daysAgo(1),
      mock: 'completed',
    },
  ],
  toRedo: [],
}
