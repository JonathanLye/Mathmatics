/**
 * seed.mjs —— 种子数据：36 学生 / 12 题 / 60 条 attempts / 事件
 * 教师端口径（契约 §2.1）：
 *  - 完成率 72%（26/36，10 人未完成，其中 3 人连续 2 周未动）
 *  - 平均提示轮数 4.8（全部 60 条 attempt 的 L1–L4 合计 288 次）
 *  - 独立性三档 38% / 34% / 28%（50 条已完成 attempt：19/17/14）
 *  - 卡点 Top5 32/27/19/13/9（100 条卡点事件）
 */

export const INVITE_CODE = 'MATH-A-2026';
export const FINAL_SAMPLE = [
  '① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。',
  '② 因为 n^{1/2} → +∞，所以 1/√n → 0。',
  '③ 由莱布尼茨判别法，∑(−1)^{n−1}/√n 收敛。',
  '④ 而 ∑1/√n 是 p=1/2 的 p-级数，p≤1 故发散，所以原级数不绝对收敛。因此它是条件收敛。',
];
export const REVIEW_QUESTIONS = [
  '用一句话说清：这道题在证什么？',
  '你的证明分几段？顺序是什么？',
  '哪一步是这题的胜负手？为什么？',
  '写到什么程度算证完？',
  '哪些方法能带走？哪些细节只在本题有用？',
];
export const REVIEW_SAMPLES = [
  '判定一个交错级数是条件收敛。',
  '两段：先证原级数收敛，再证绝对值级数发散。',
  '第一步就想到「条件收敛要证两件事」，否则会漏掉绝对发散。',
  '结论写明条件收敛，两段理由都有依据，判别法条件逐条核对。',
  '带走：交错用莱布尼茨、条件收敛补证绝对发散、p 级数规则。',
];

export const STUCK_CODES = { lp: '莱布尼茨的单调性条件', cond: '条件收敛的定义', ps: 'p 级数适用范围', lz: '极限为 0 的依据', rq: '五问复盘第 3 问' };

const STUDENT_NAMES = ['王砚','李梓','陈默','周然','孙禾','赵一一','钱晓','孙越','李桐','周可','吴悠','郑澈','冯知','陈嘉','褚然','卫然','蒋予','沈禾','韩束','杨澄','朱语','秦简','许宁','何舟','吕行','施远','张弛','孔明','曹青','严言','华予','金禾','魏然','陶然','姜来','戚然'];

function iso(d) { return new Date(d).toISOString(); }
function addMin(base, m) { return new Date(base.getTime() + m * 60000); }
function addDays(base, d) { return new Date(base.getTime() - d * 86400000); }

const PHASE_OF_NODE = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P3', 5: 'P3', 6: 'P3', 7: 'P3', 8: 'P3', 9: 'P4', 10: 'P6' };

function hintSum(used) { return (used.L1 || 0) + (used.L2 || 0) + (used.L3 || 0) + (used.L4 || 0); }

function buildProblems() {
  const commonHints = (l1, l2, l3, l4) => ({ L1: l1, L2: l2, L3: l3, L4: l4 });
  const p = [];
  p.push({
    id: 'p-cond-series',
    title: '第 2 题 · 交错级数与条件收敛',
    chapter: '级数',
    kp: ['莱布尼茨判别法', '条件收敛', 'p级数'],
    difficulty: 'mid',
    type: 'required',
    estimatedMin: 22,
    status: 'published',
    hasScript: true,
    stem: '判断级数 ∑_{n=1}^{∞} (−1)^{n−1}/√n 的收敛性；若收敛，是条件收敛还是绝对收敛？证明你的结论。',
    keySteps: [
      { id: 'k1', text: 'u_n=1/√n 单调递减', question: '你有没有用 n 和 n+1 写一个不等式，证明 u_{n+1}<u_n？', match: [['n+1','n＋1'], ['<','＜','单调','递减']] },
      { id: 'k2', text: 'u_n→0', question: 'lim 1/√n=0 的依据，你写的是结论还是推导？', match: [['lim','极限','→0'], ['0']] },
      { id: 'k3', text: '由莱布尼茨判别法得收敛', question: '你有没有明确写出「由莱布尼茨判别法」这句话？', match: [['莱布尼茨']] },
      { id: 'k4', text: '∑1/√n 发散（p=1/2≤1）', question: '∑1/√n 发散这一点，你引用了哪条现成结论？适用范围写清了吗？', match: [['p=1/2','p=1/2','1/2'], ['p-级数','p级数','p 级数'], ['发散']] },
      { id: 'k5', text: '结论：条件收敛', question: '结论里「条件收敛」四个字出现了吗？两半理由都在吗？', match: [['条件收敛']] },
    ],
    hints: commonHints(
      '这题的关键是莱布尼茨判别法。它有三个条件，你逐条核对了吗？',
      '收敛这一半：交错级数有现成判别法，它的条件你逐条核对了吗？',
      '示范一步：由 lim n^{1/2}=+∞ 得 lim 1/√n=0。下一句你补。',
      '先示范一行：1/√(n+1)<1/√n。剩下两个条件由你补，并用一句话复述理由。'
    ),
    referenceProof: FINAL_SAMPLE.join('\n'),
    variant: { title: '变式题 · 绝对收敛', stem: '判断 ∑_{n=1}^{∞} (−1)^{n−1}/n² 的收敛性，并说明是条件收敛还是绝对收敛。', answerKeywords: ['绝对收敛', 'p=2', '1/n²'] },
  });
  p.push({
    id: 'p-epsilon-n', title: '第 1 题 · 数列极限的 ε-N 证明', chapter: '极限', kp: ['ε-N 定义', '数列极限'],
    difficulty: 'easy', type: 'required', estimatedMin: 15, status: 'published', hasScript: false,
    stem: '用 ε-N 定义证明 lim_{n→∞}(3n+1)/(n+2)=3。',
    keySteps: [
      { id: 'k1', text: '把差式化简为 5/(n+2)', question: '你有没有先把 |a_n−A| 化简成能控制的形式？', match: [['5/(n+2)','5/(n＋2)','化简']] },
      { id: 'k2', text: '由 ε 反解 n 的下界', question: '你是从不等式反解出 n 的吗？', match: [['解','n>','n＞','ε']] },
      { id: 'k3', text: '取合适的 N 并用定义收尾', question: '你取的 N 是正整数吗？定义三句话写全了吗？', match: [['N','正整数','定义']] },
    ],
    hints: commonHints('关键是 ε-N 定义。它的量词顺序是：任意 ε，存在 N。你写全了吗？', '先把差式化简，再看它和 ε 的关系。', '示范一步：|(3n+1)/(n+2)−3| = 5/(n+2)。下一句你补。', '先示范一行：5/(n+2) < ε 等价于 n > 5/ε − 2。剩下由你补。'),
    referenceProof: '对任意 ε>0，取 N=max(1,⌈5/ε⌉)，当 n>N 时 |(3n+1)/(n+2)−3|=5/(n+2)<5/N<ε。',
    variant: { title: '变式题 · 另一个极限', stem: '用定义证明 lim (2n+3)/(n+1)=2。', answerKeywords: ['1/(n+1)','定义'] },
  });
  p.push({
    id: 'p-continuity', title: '第 3 题 · 一致连续', chapter: '连续', kp: ['一致连续', 'δ-ε'],
    difficulty: 'mid', type: 'required', estimatedMin: 20, status: 'published', hasScript: false,
    stem: '证明 f(x)=x² 在 [0,1] 上一致连续。',
    keySteps: [
      { id: 'k1', text: '写出 |x²−y²| 的分解', question: '你有没有把 |x²−y²| 拆成 |x−y||x+y|？', match: [['|x−y|','x-y','分解']] },
      { id: 'k2', text: '利用区间有界放缩 |x+y|≤2', question: '|x+y| 在 [0,1] 上能被什么数控制？', match: [['≤2','2']] },
      { id: 'k3', text: '取 δ=ε/2 并写全定义', question: 'δ 取多少？量词顺序写对了吗？', match: [['δ','ε/2','定义']] },
    ],
    hints: commonHints('一致连续的定义：δ 只能依赖 ε，不能依赖 x。你注意了吗？', '先把 |x²−y²| 分解成 |x−y||x+y|。', '示范一步：|x²−y²|=|x−y||x+y|。下一句你补。', '先示范一行：|x+y|≤2，所以取 δ=ε/2。剩下由你补。'),
    referenceProof: '对任意 ε>0，取 δ=ε/2。当 |x−y|<δ 且 x,y∈[0,1] 时 |x²−y²|=|x−y||x+y|≤2|x−y|<ε。',
    variant: { title: '变式题 · 1/x 不一块连续', stem: '说明 f(x)=1/x 在 (0,1) 上不一致连续。', answerKeywords: ['不一致连续','取','点列'] },
  });

  const rest = [
    ['p-monotone-bounded', '单调有界准则', '极限', ['单调有界', '数列极限'], 'easy', 'practice', 14, '用单调有界准则证明数列 a₁=1，a_{n+1}=√(2+a_n) 收敛。'],
    ['p-improper-integral', '反常积分的收敛性', '积分', ['反常积分', '比较判别法'], 'hard', 'practice', 24, '判断 ∫_1^{+∞} 1/(1+x²) dx 是否收敛，并说明理由。'],
    ['p-p-series', 'p 级数的收敛范围', '级数', ['p级数', '比较判别法'], 'easy', 'practice', 12, '判断 ∑ 1/n^{3/2} 是否收敛，并说明依据。'],
    ['p-power-series', '幂级数收敛半径', '级数', ['收敛半径', '幂级数'], 'mid', 'practice', 18, '求幂级数 ∑ n x^n 的收敛半径与收敛区间。'],
    ['p-uniform-convergence', '函数列的一致收敛', '级数', ['一致收敛', '函数列'], 'hard', 'practice', 26, '讨论 f_n(x)=x^n 在 [0,1] 上是否一致收敛。'],
    ['p-mean-value', '拉格朗日中值定理', '一元微分', ['中值定理', '辅助函数'], 'mid', 'practice', 20, '用拉格朗日中值定理证明：当 x>0 时 ln(1+x)<x。'],
    ['p-integral-mean', '积分中值定理', '积分', ['积分中值', '连续函数'], 'easy', 'practice', 15, '证明存在 ξ∈[0,1]，使 ∫_0^1 f(x) dx = f(ξ)。'],
    ['p-multivariable-limit', '多元函数的极限', '多元', ['多元极限', '路径'], 'mid', 'practice', 18, '判断 f(x,y)=xy/(x²+y²) 在 (0,0) 处的极限是否存在。'],
    ['p-series-absolute', '绝对收敛与条件收敛', '级数', ['绝对收敛', '条件收敛'], 'easy', 'practice', 12, '判断 ∑ (−1)^n/n² 是绝对收敛还是条件收敛。'],
  ];
  for (const [id, title, chapter, kp, difficulty, type, estimatedMin, stem] of rest) {
    const status = ['p-integral-mean', 'p-multivariable-limit', 'p-series-absolute'].includes(id) ? 'review' : 'published';
    p.push({
      id, title: '练习 · ' + title, chapter, kp, difficulty, type, estimatedMin, status, hasScript: false, stem,
      keySteps: [
        { id: 'k1', text: '写出定义/定理的适用条件', question: '你核对过这条定理的适用条件吗？', match: [['条件', '定理', '定义']] },
        { id: 'k2', text: '给出关键一步的依据', question: '这一步的依据是什么？', match: [['因为', '依据', '由']] },
        { id: 'k3', text: '结论写完整', question: '结论写清楚了吗？', match: [['结论', '所以', '收敛', '连续']] },
      ],
      hints: commonHints('关键在定义/定理。它的条件你逐条核对了吗？', '先找方法入口，再补依据。', '示范一步：把关键不等式写出来。下一句你补。', '先示范一行，剩下由你补，并复述理由。'),
      referenceProof: '（内部参考证明占位，仅用于重合度检测，绝不下发）',
      variant: { title: '变式题', stem: '同知识点换一道题：把条件改成另一种情形再判断。', answerKeywords: ['收敛', '定义'] },
    });
  }

  // v2 六层：给每题挂「前置知识点卡」（专业版 + 高中版 + 核对问题），不含解法
  const KNOWLEDGE = {
    'p-cond-series': {
      question: '条件收敛和收敛的区别是什么？',
      professional: '若 ∑a_n 收敛且 ∑|a_n| 发散，则称 ∑a_n 条件收敛。交错级数用莱布尼茨判别法：u_n 单调递减且 u_n→0 时收敛。',
      plain: '原级数能收敛，但把每项都变成正数后就不收敛了。',
      checkQuestion: '条件收敛与收敛的区别是什么？',
      plainRestatement: '这题让你判断：原级数收不收；如果收，是条件收敛还是绝对收敛。',
      keywords: ['收敛', '绝对', '发散', '绝对值', '交错'],
    },
  };
  for (const x of p) {
    const kp = x.kp || [];
    x.knowledge = KNOWLEDGE[x.id] || {
      question: '这道题要先核对哪个定义/定理？',
      professional: '本题知识点：' + kp.join('、') + '。先看每条定理的适用条件，再决定怎么用。',
      plain: '用大白话说：' + (kp[0] || '这个知识点') + ' 是解决这类问题的工具，先弄清楚它在管什么。',
      checkQuestion: '用你自己的话说：' + (kp[0] || '这个定理') + ' 的条件是什么？',
      plainRestatement: '这道题让你：先判断要证什么，再按对应知识点找入口，最后把结论写完整。',
      keywords: kp.concat(['条件', '定义']),
    };
  }
  return p;
}

export function buildSeed(nowDate = new Date()) {
  const now = new Date(nowDate);
  const students = STUDENT_NAMES.map((name, i) => {
    const n = i + 1;
    let activeDaysAgo = (i % 4) * 0.5;
    if (n >= 34) activeDaysAgo = 16 + (n - 34) * 2; // s34–s36：连续 2 周未动
    return {
      id: 's' + String(n).padStart(2, '0'),
      sid: '2026' + String(n).padStart(3, '0'),
      name,
      className: '数学分析 A 班',
      group: n % 2 === 0 ? 'experiment' : 'control',
      lastActive: iso(addDays(now, activeDaysAgo)),
    };
  });

  const problems = buildProblems();

  const labels = [...Array(19).fill('independent'), ...Array(17).fill('semi'), ...Array(14).fill('dependent')];
  const usedFor = (label, i) => {
    if (label === 'independent') return { L1: 0, L2: 0, L3: 0, L4: 0, L0: 2 + (i % 5), xiaobai: i % 3 === 0 ? 1 : 0, refusals: i % 4 === 0 ? 1 : 0 };
    if (label === 'semi') return { L1: 3, L2: 3, L3: 0, L4: 0, L0: 1 + (i % 4), xiaobai: 0, refusals: 0 };
    return { L1: 3, L2: 3, L3: 2, L4: 1, L0: 1 + (i % 3), xiaobai: i % 2, refusals: i % 3 === 0 ? 1 : 0 };
  };

  const attempts = [];
  const events = [];
  let evtSeq = 0;
  const pushEvent = (ts, studentId, attemptId, type, level, text, meta, durationMs) => {
    evtSeq += 1;
    events.push({
      id: 'e' + String(evtSeq).padStart(4, '0'), ts: iso(ts), studentId, attemptId,
      type, level: level || null, text: text || '', meta: meta || {}, durationMs: durationMs == null ? null : durationMs,
    });
  };

  // 1) 26 条完成的必做题 attempt（s01–s26）
  for (let i = 0; i < 26; i++) {
    const student = students[i];
    const label = labels[i];
    const used = usedFor(label, i);
    const started = addDays(now, 1 + (i % 5));
    const finished = addMin(started, 14 + (i % 18));
    const coveragePercent = i % 3 === 0 ? 80 : 100;
    attempts.push({
      id: 'a' + String(i + 1).padStart(3, '0'),
      studentId: student.id,
      problemId: 'p-cond-series',
      startedAt: iso(started), finishedAt: iso(finished),
      phase: 'P6', node: 10, round: 0,
      budgets: { L1: 3, L2: 3, L3: 2, L4: 1, L0: 6, xiaobai: 2 },
      used, unlocked: label === 'independent' ? ['L0'] : label === 'semi' ? ['L0', 'L1', 'L2'] : ['L0', 'L1', 'L2', 'L3', 'L4'],
      independence: label, pasteFlags: label === 'dependent' && i % 3 === 0 ? 1 : 0,
      fails: 0, stepsSubmitted: 4,
      chat: [], draft: [], hintLog: [],
      coverage: { covered: coveragePercent === 100 ? 5 : 4, total: 5, percent: coveragePercent, passed: true, items: [] },
      finalText: FINAL_SAMPLE.join('\n'),
      review: { answers: REVIEW_SAMPLES.slice(), feedback: [], mastery: 62 + (i * 7) % 33 },
      variantResult: { correct: true, feedback: '结论和理由都对。' },
      timeMin: 14 + (i % 18),
      stuckPoints: [],
    });
    pushEvent(started, student.id, 'a' + String(i + 1).padStart(3, '0'), 'login', null, '', {}, 0);
  }

  // 2) 24 条完成的练习 attempt（50 条完成中的其余 24 条）
  const practiceProblems = ['p-epsilon-n', 'p-continuity', 'p-monotone-bounded', 'p-improper-integral', 'p-p-series', 'p-power-series', 'p-uniform-convergence', 'p-mean-value'];
  for (let j = 0; j < 24; j++) {
    const idx = 26 + j;
    const label = labels[idx];
    const used = usedFor(label, idx);
    const student = students[(j + 1) % 26];
    const problemId = practiceProblems[j % practiceProblems.length];
    const started = addDays(now, 0.4 + (j % 6) * 0.9);
    const finished = addMin(started, 12 + (j % 20));
    attempts.push({
      id: 'a' + String(101 + j),
      studentId: student.id,
      problemId,
      startedAt: iso(started), finishedAt: iso(finished),
      phase: 'P6', node: 10, round: 0,
      budgets: { L1: 3, L2: 3, L3: 2, L4: 1, L0: 6, xiaobai: 2 },
      used, unlocked: label === 'independent' ? ['L0'] : label === 'semi' ? ['L0', 'L1', 'L2'] : ['L0', 'L1', 'L2', 'L3', 'L4'],
      independence: label, pasteFlags: label === 'dependent' && j % 4 === 0 ? 1 : 0,
      fails: 0, stepsSubmitted: 3,
      chat: [], draft: [], hintLog: [],
      coverage: { covered: 3, total: 3, percent: 100, passed: true, items: [] },
      finalText: '（练习作答终稿）',
      review: { answers: REVIEW_SAMPLES.slice(), feedback: [], mastery: 65 + (j * 5) % 30 },
      variantResult: { correct: j % 5 !== 0, feedback: '' },
      timeMin: 12 + (j % 20),
      stuckPoints: [],
    });
  }

  // 3) 10 条未完成 attempt（s27–s36）—— s34–s36 为 16–20 天前，对应「连续 2 周未动」
  for (let k = 0; k < 10; k++) {
    const n = 27 + k;
    const student = students[n - 1];
    const daysAgo = n >= 34 ? 16 + (n - 34) * 2 : 0.6 + (k % 5) * 0.7;
    const started = addDays(now, daysAgo);
    const node = [1, 2, 3, 3, 2, 3, 4, 3, 2, 1][k];
    const phase = PHASE_OF_NODE[node];
    const used = { L1: 2, L2: 2, L3: 1, L4: 1, L0: 2, xiaobai: 0, refusals: 0 };
    attempts.push({
      id: 'a' + String(201 + k),
      studentId: student.id,
      problemId: 'p-cond-series',
      startedAt: iso(started), finishedAt: null,
      phase, node, round: 0,
      budgets: { L1: 3, L2: 3, L3: 2, L4: 1, L0: 6, xiaobai: 2 },
      used, unlocked: ['L0', 'L1', 'L2', 'L3', 'L4'],
      independence: null, pasteFlags: 0, fails: 1, stepsSubmitted: 2,
      chat: [], draft: [], hintLog: [],
      coverage: { covered: 0, total: 5, percent: 0, passed: false, items: [] },
      finalText: '', review: null, variantResult: null,
      timeMin: 5 + (k % 8),
      stuckPoints: [],
    });
    pushEvent(started, student.id, 'a' + String(201 + k), 'login', null, '', {}, 0);
  }

  // 4) 卡点事件：100 条，按 32/27/19/13/9 分布（同题同一知识点只计一次）
  const codeList = [];
  const addCodes = (code, n) => { for (let i = 0; i < n; i++) codeList.push(code); };
  addCodes('lp', 32); addCodes('cond', 27); addCodes('ps', 19); addCodes('lz', 13); addCodes('rq', 9);
  // 固定步长置换，打散顺序
  const permuted = [];
  for (let i = 0; i < 100; i++) permuted.push(codeList[(i * 37) % 100]);
  let cursor = 0;
  attempts.forEach((a, idx) => {
    const take = idx < 40 ? 2 : 1;
    a.stuckPoints = permuted.slice(cursor, cursor + take);
    cursor += take;
  });

  // 5) 事件：start / hint / final / review / variant / finish
  attempts.forEach((a) => {
    const t0 = new Date(a.startedAt);
    pushEvent(t0, a.studentId, a.id, 'attempt_start', null, '', { problemId: a.problemId }, 0);
    const totalHints = hintSum(a.used);
    if (totalHints > 0) pushEvent(addMin(t0, 2), a.studentId, a.id, 'hint', 'L2', '', { counts: { L1: a.used.L1, L2: a.used.L2, L3: a.used.L3, L4: a.used.L4 }, total: totalHints }, 8);
    if (a.finishedAt) {
      const t1 = new Date(a.finishedAt);
      pushEvent(addMin(t0, 6), a.studentId, a.id, 'final', null, '', { coverage: a.coverage.percent }, 12);
      pushEvent(addMin(t0, 7), a.studentId, a.id, 'review', null, '', { mastery: a.review ? a.review.mastery : null }, 10);
      pushEvent(t1, a.studentId, a.id, 'variant', null, '', { correct: a.variantResult ? a.variantResult.correct : null }, 9);
      pushEvent(t1, a.studentId, a.id, 'finish', null, '', { independence: a.independence }, 0);
    }
  });

  return {
    meta: {
      version: '2.0.0',
      seededAt: iso(now),
      mode: 'mock',
      inviteCode: INVITE_CODE,
      demoStudent: { id: 's-demo', sid: 'demo', name: '演示同学', className: '数学分析 A 班', group: 'experiment', lastActive: iso(now) },
      classInfo: { id: 'c-math-a', name: '数学分析 A 班', term: '2026 秋', size: 36 },
    },
    students,
    problems,
    attempts,
    events,
  };
}

/** 供 metrics 使用：信息型提示合计 */
export function infoHints(used) { return hintSum(used); }
