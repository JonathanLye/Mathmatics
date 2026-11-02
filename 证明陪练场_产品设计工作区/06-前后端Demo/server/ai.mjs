/**
 * ai.mjs —— 六层引导 v2 · Mock AI 引擎（零依赖）
 * 六层：1 前置知识点 / 2 题目解析 / 3 详细步骤 / 4 完整讲解（学生讲、AI 核对）/ 5 同类题 / 6 总结
 * 原则：学生先做，AI 后说；AI 不给完整证明、不给最终答案、不给可抄推导链。
 */
import crypto from 'node:crypto';

export const BUDGETS = { L1: 3, L2: 3, L3: 2, L4: 1, L0: 6, xiaobai: 2 };

export const LAYERS = [
  { n: 1, key: 'knowledge', label: '前置知识点', sub: '专业 + 高中' },
  { n: 2, key: 'parse', label: '题目解析', sub: '你拆，AI 查漏' },
  { n: 3, key: 'steps', label: '详细步骤', sub: '一步一依据' },
  { n: 4, key: 'explain', label: '完整讲解', sub: '你讲，AI 核对' },
  { n: 5, key: 'variant', label: '同类题', sub: '换题再做' },
  { n: 6, key: 'summary', label: '总结', sub: '知识点 / 重难点 / 步骤' },
];
export const LAYER_LABELS = Object.fromEntries(LAYERS.map((x) => [x.n, x.label]));
export const PHASES = [
  { key: 'P1', label: '知识激活' }, { key: 'P2', label: '学生拆题' }, { key: 'P3', label: '分步推进' },
  { key: 'P4', label: '终稿核对' }, { key: 'P5', label: '五问复盘' }, { key: 'P6', label: '迁移总结' },
];
export const PHASE_LABEL = { P1: 'P1 知识激活', P2: 'P2 学生拆题', P3: 'P3 分步推进', P4: 'P4 终稿核对', P5: 'P5 五问复盘', P6: 'P6 迁移总结' };

export const HINT_TAGS = { L0: 'L0 追问', L1: 'L1 概念提示', L2: 'L2 方向提示', L3: 'L3 局部步骤', L4: 'L4 示范微步' };
export const L0_TEXT = '你这一步的依据是哪条定义或定理？只写这一句。';

export const REFUSAL = {
  receive: '理解，你想快点看到完整过程。',
  rule: '但给了你整份证明，你今天会了，考场上换个说法还是卡——我的作用是帮你写会。',
  alternatives: [
    { id: 'definition', label: '看定义原文', desc: '只给定义/定理原文' },
    { id: 'choose', label: '二选一：先看开头，还是先看卡点', desc: '你决定先动哪一部分' },
    { id: 'one-step', label: '只点评我这一步', desc: '只发一步，我只对这一步提问' },
    { id: 'teacher', label: '转给老师', desc: '保存草稿，生成教师工单' },
  ],
};

export const XIAOBAI_CARDS = {
  '条件收敛': {
    analogy: '靠正负抵消才收敛，符号一去掉就撑不住。',
    example: '1−1/2+1/3−1/4+… 会稳住；1+1/2+1/3+… 越加越大。',
    formal: '∑a(n) 收敛且 ∑|a(n)| 发散，就叫条件收敛。',
    ask: '用你自己的话复述一遍，再回到题目。',
  },
  'p级数': {
    analogy: 'p 级数像一场「分母长得多快」的比赛：p 越大，分母长得越快，越容易收敛。',
    example: '∑1/n²（p=2）收敛；∑1/n（p=1）发散。',
    formal: 'p 级数 ∑1/n^p：p>1 收敛，0<p≤1 发散。',
    ask: '这里的 p 是多少？按规则它收敛还是发散？',
  },
  '极限': {
    analogy: '极限就是「越往后越靠近某个数」；这里分母越来越大，商就越靠近 0。',
    example: '1/10、1/100、1/1000… 越来越接近 0。',
    formal: 'lim n^{1/2}=+∞ 时，lim 1/n^{1/2}=0。',
    ask: '用一句话说：分母变大时，这个商在做什么？',
  },
  '一致连续': {
    analogy: '一把尺子管住整个区间；普通连续是每个点各用各的尺子。',
    example: 'f(x)=x 在 R 上一把尺子就够；f(x)=1/x 在 (0,1) 上不行。',
    formal: '对任意 ε>0，存在 δ>0，对任意 x,y，|x−y|<δ 就有 |f(x)−f(y)|<ε。',
    ask: '复述一遍：δ 能不能依赖 x？',
  },
};

const STEP_HINTS = [
  '把 u_n 与 u_{n+1} 写成不等式，再看 n+1>n。',
  '用 n 的幂次说明它趋向哪里。',
  '这一步是把前两条收成现成判别法的结论。',
  '看 ∑1/√n 属于哪一类现成级数。',
  '把两半结论合起来，写清它叫什么。',
];
const STEP_ASKS = [
  '用 n 和 n+1 写不等式，证明它递减？',
  '1/√n 等于 n 的几次方？',
  '哪个判别法管交错级数，条件齐了吗？',
  '它的 p 是多少，和 1 比谁大？',
  '两半都成立时，这个级数叫什么？',
];
const STEP_PASS_JUDGE = [
  '「{q}」把单调性说清了。',
  '「{q}」极限为 0 有了依据。',
  '「{q}」把判别法条件收住了。',
  '「{q}」p 级数适用范围用对了。',
  '「{q}」结论写全了，五步齐了。',
];

function compact(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
function len(s) { return [...compact(s)].length; }
function quote(s, n = 8) { const c = compact(s); return c.length > n ? c.slice(0, n) : c; }
function hit(text, kws) { const t = compact(text); return (kws || []).some((k) => t.includes(compact(k))); }
function countHit(text, kws) { const t = compact(text); return (kws || []).filter((k) => t.includes(compact(k))).length; }

/* ================= 每层指令（契约 §5 文案） ================= */
export function buildGuidance(attempt, problem) {
  const layer = attempt.layer || 1;
  const stepIdx = attempt.stepIndex || 1;
  const keySteps = (problem && problem.keySteps) || [];
  const g = {
    1: {
      title: '第 1 层 · 前置知识点',
      instruction: '先别急着写证明。你记得「条件收敛」和「莱布尼茨判别法」吗？先选一个。',
      placeholder: '用自己的话回答：条件收敛和收敛有什么区别？',
      submitLabel: '提交我的理解',
      hintTip: '卡住可以点下面的提示；也可以直接看知识点卡（专业版 / 高中版）',
    },
    2: {
      title: '第 2 层 · 题目解析（你拆，AI 查漏）',
      instruction: '拆题：这题要证什么、几件事、关键词是什么、可能用到什么知识点。',
      placeholder: '按四栏填写：要证什么 / 几件事 / 关键词与量词 / 可能用到的知识点',
      submitLabel: '提交我的解析',
      hintTip: '填不全没关系，AI 只查漏，不替你想。',
    },
    3: {
      title: '第 3 层 · 详细步骤（一步一依据）',
      instruction: '现在写第 ' + stepIdx + ' 步：' + ((keySteps[stepIdx - 1] && keySteps[stepIdx - 1].text) || '写下一步') + '。写「结论/操作 + 依据」，然后点提交。',
      placeholder: '结论/操作 + 依据（两步分开写也行）',
      submitLabel: '提交这一步',
      hintTip: '卡住点提示；连续两次卡同一处，我会主动问你要不要方向提示。',
    },
    4: {
      title: '第 4 层 · 完整讲解（你讲，AI 核对）',
      instruction: '完整讲解由你完成，AI 只核对缺口，不提供标准讲解。像给同学讲题一样讲一遍。',
      placeholder: '要证什么 → 分几段 → 每段依据 → 结论',
      submitLabel: '提交完整讲解',
      hintTip: '讲不清的地方就是没真懂的地方，AI 只指出缺口。',
    },
    5: {
      title: '第 5 层 · 同类题（换题再做）',
      instruction: '换一道同知识点、不同题面的题，写出你的答案或关键步骤。',
      placeholder: '写出答案 + 关键步骤（1–3 行）',
      submitLabel: '提交变式题',
      hintTip: '只判对错 + 一条追问，不给解法。',
    },
    6: {
      title: '第 6 层 · 总结（知识点 / 重难点 / 步骤）',
      instruction: '用自己的话写三栏：我学到的知识点、最容易错的重难点、下次的解题步骤。',
      placeholder: '三栏分别写，每栏 1–2 句',
      submitLabel: '提交总结',
      hintTip: 'AI 只校正表述、生成总结卡，不替你总结。',
    },
  }[layer];
  return g;
}

export function buildProactive(attempt) {
  if ((attempt.failedAttempts || 0) >= 2 && (attempt.layer || 1) === 3) {
    return { offer: true, level: 'L2', text: '要不要先给一个方向提示？不会给答案。' };
  }
  return null;
}

/* ================= 第 1 层：前置知识点 ================= */
export function knowledgeCard(problem) {
  const k = (problem && problem.knowledge) || {};
  const kp = (problem && problem.kp) || [];
  return {
    problemId: problem && problem.id,
    question: k.question || '这道题要先核对哪个定义/定理？',
    professional: k.professional || ('本题知识点：' + kp.join('、') + '。先看适用条件，再看怎么用。'),
    plain: k.plain || ('用大白话说：' + (kp[0] || '这个知识点') + ' 是解决这类问题的工具。'),
    checkQuestion: k.checkQuestion || ('用你自己的话说：' + (kp[0] || '这个定理') + ' 的条件是什么？'),
  };
}

export function gradeKnowledge(attempt, answer, problem) {
  const card = knowledgeCard(problem);
  const kws = ((problem && problem.knowledge && problem.knowledge.keywords) || []).concat(['收敛', '绝对', '发散']);
  const t = String(answer || '');
  let passed = false;
  if (len(t) >= 8 && countHit(t, kws) >= 2) passed = true;
  else if (len(t) >= 14 && countHit(t, kws) >= 1) passed = true;
  const attempts = (attempt.knowledge.attempts || 0) + 1;
  let feedback;
  let weakPoint = false;
  if (passed) {
    feedback = '定义抓到了：先收敛，再取绝对值看是否发散。进入第 2 层。';
  } else if (attempts >= 2) {
    passed = true;
    weakPoint = true;
    feedback = '两次没答准，先带病前进（薄弱点已记录：条件收敛定义）。进入第 2 层。';
  } else {
    feedback = '还差一点：先说「本身收敛」，再说「取绝对值后发散」。再试一次。';
  }
  return { passed, feedback, weakPoint, attempts, card };
}

/* ================= 第 2 层：题目解析 ================= */
export function gradeParse(input, problem) {
  const goal = String(input.goal || '').trim();
  const parts = String(input.parts || '').trim();
  const keywords = String(input.keywords || '').trim();
  const tools = String(input.tools || '').trim();
  const k = (problem && problem.knowledge) || {};
  const plainRestatement = k.plainRestatement || ('这道题让你：' + (k.question || '先判断要证什么，再按知识点找入口') + '。');

  const checks = [
    {
      field: 'goal', name: '要证什么',
      ok: len(goal) >= 6 && /收敛|条件|绝对|判断|证/.test(goal),
      pass: '目标清楚：判断收敛性并区分条件/绝对。',
      miss: '要证什么？写「判断…是否收敛；若是，条件还是绝对」。',
    },
    {
      field: 'parts', name: '要证几件事',
      ok: len(parts) >= 4 && /两|2|先[^。]{0,8}再|收敛[^。]{0,12}发散|发散[^。]{0,12}收敛/.test(parts),
      pass: '拆成了两件事，方向对。',
      miss: '要证几件事？提示：收敛 + 绝对值发散两件，用「先…再…」写。',
    },
    {
      field: 'keywords', name: '关键词与量词',
      ok: len(keywords) >= 4 && /级数|交错|p|莱布尼茨|√|n|量词|条件收敛/.test(keywords),
      pass: '关键词抓得准。',
      miss: '补关键词：交错级数、条件收敛、p 级数（或 n 的幂次）。',
    },
    {
      field: 'tools', name: '可能用到的知识点',
      ok: len(tools) >= 3 && /判别法|莱布尼茨|p级数|p-级数|单调|极限|定义|不等式/.test(tools),
      pass: '工具找对了。',
      miss: '可能用到：莱布尼茨判别法 / p 级数判别法，把名字写上。',
    },
  ];
  const feedback = checks.map((c) => ({ field: c.field, status: c.ok ? 'pass' : 'missing', message: c.ok ? c.pass : c.miss }));
  const passed = checks.every((c) => c.ok);
  return { feedback, passed, plainRestatement };
}

/* ================= 第 3 层：详细步骤 ================= */
export function expectedStep(problem, stepIndex) {
  const ks = (problem && problem.keySteps) || [];
  return ks[stepIndex - 1] || null;
}

export function gradeStep(attempt, conclusion, evidence, problem) {
  const stepNo = attempt.stepIndex || 1;
  const ks = (problem && problem.keySteps) || [];
  const expected = ks[stepNo - 1];
  const c = String(conclusion || '').trim();
  const e = String(evidence || '').trim();
  const idx = Math.max(0, Math.min(stepNo - 1, 4));
  const q = quote(c || e, 8) || '这一步';
  const hasEvidence = len(e) >= 4 && /因为|由于|由[^。]{0,12}得|依据|所以|故|判别|不等式|定义|定理|>|<|≥|≤/.test(e);
  const basicOk = len(c) >= 4 && len(e) >= 2;
  const match = expected
    ? (expected.match || [[expected.text]]).every((group) => group.some((kw) => compact(c + e).includes(compact(kw))))
    : len(c) >= 6;

  if (!expected) {
    const ai = {
      judge: '五步都写完了，可以交终稿。', hint: '点「写完了」进入第 4 层完整讲解。', ask: '每步依据都写在你自己的证明里了吗？', tag: 'L0 · 步骤完成',
    };
    return { passed: true, done: true, diagnosis: { verdict: 'ok', firstError: null, type: '完成', confidence: 0.9, note: '五步齐了' }, ai, stepNo, feedback: '五步齐了。' };
  }

  let verdict; let type; let feedback;
  if (!basicOk || len(c) < 4) {
    verdict = 'insufficient'; type = '资料不足';
    feedback = '这一步还太短，先写「结论/操作」一句。';
  } else if (match && hasEvidence) {
    verdict = 'ok'; type = '可以';
    feedback = '这一步站得住：结论清楚，依据也写了。';
  } else if (match && !hasEvidence) {
    verdict = 'missing_evidence'; type = '缺依据';
    feedback = '结论方向对，但依据没写清。';
  } else {
    verdict = 'suspect'; type = '需要修改';
    feedback = '这里可能是第一处可疑：还差关键一步/条件。';
  }

  const passed = verdict === 'ok';
  let ai;
  if (passed) {
    const judge = STEP_PASS_JUDGE[idx].replace('{q}', q);
    const NEXT_HINTS = [
      '下一步：说明 u_n 的极限为 0。',
      '下一步：用现成判别法把收敛这一半收成结论。',
      '下一步：看 ∑1/√n 属于哪一类现成级数。',
      '下一步：把两半结论合成最终结论。',
      '五步齐了，点「写完了」交终稿。',
    ];
    const hint = NEXT_HINTS[Math.max(0, Math.min(stepNo - 1, 4))];
    const ask = ks[stepNo] ? STEP_ASKS[Math.min(stepNo, 4)] : '每步依据都写清了吗？准备交终稿？';
    ai = { judge, hint, ask, tag: 'L0 肯定 · 给一步就交还' };
  } else {
    const judge = verdict === 'insufficient' ? ('「' + q + '」还太短，先写结论。')
      : verdict === 'missing_evidence' ? ('「' + q + '」方向对，但没写依据。')
        : ('「' + q + '」还差关键一步，先别跨步。');
    ai = { judge, hint: STEP_HINTS[idx], ask: STEP_ASKS[idx], tag: 'L0 追问 · 只指第一处可疑' };
  }
  const diagnosis = { verdict, firstError: passed ? null : stepNo, type, confidence: passed ? 0.9 : (verdict === 'insufficient' ? 0.4 : 0.8), note: feedback };
  return { passed, done: false, diagnosis, ai, stepNo, feedback };
}

/* ================= 提示 / 小白解释 ================= */
export function hintText(problem, level) {
  if (level === 'L0') return L0_TEXT;
  return (problem && problem.hints && problem.hints[level]) || L0_TEXT;
}

export function plainForHint(attempt, problem) {
  const layer = attempt.layer || 1;
  const stepNo = attempt.stepIndex || 1;
  const ks = (problem && problem.keySteps) || [];
  const target = ks[stepNo - 1] ? ks[stepNo - 1].text : '下一步';
  const map = {
    1: '这一层在核对定义：你只要说清概念，不用写证明。',
    2: '这一层在拆题：说清要证几件事，不用写算式。',
    3: '你正在写第 ' + stepNo + ' 步（' + target + '）：先写结论，再补一句依据；AI 只指第一处可疑。',
    4: '这一层由你把整道题讲一遍；AI 只核对缺口，不给标准讲解。',
    5: '这一层换一道同知识点的题，检验方法会不会迁移。',
    6: '这一层把方法收成自己的话：知识点、重难点、步骤。',
  };
  return map[layer] || map[1];
}

/* ================= 第 4 层：完整讲解核对 ================= */
export function checkExplain(problem, text) {
  const t = String(text || '');
  const checks = [
    { criterion: '目标', ok: /证|判断|要证/.test(t) && /收敛|条件|绝对/.test(t), miss: '补一句「这道题要证什么」。' },
    { criterion: '结构', ok: /先|再|分两段|分三段|第一|第二|然后|最后/.test(t), miss: '补「先…再…」的分段，讲清顺序。' },
    { criterion: '关键步骤', ok: hit(t, ['莱布尼茨', '单调', '极限', 'p级数', 'p-级数', '不等式', '判别']), miss: '关键步骤漏了：单调性 / 极限为 0 / 判别法 / p 级数。' },
    { criterion: '依据', ok: /因为|由于|由|依据|所以|故|判别法|不等式/.test(t), miss: '每一步都要说「为什么」，补「因为…」。' },
    { criterion: '结论', ok: /条件收敛|绝对收敛|结论/.test(t), miss: '结论里要出现「条件收敛 / 绝对收敛」。' },
  ];
  const feedback = checks.map((c) => ({
    criterion: c.criterion,
    status: c.ok ? 'pass' : 'missing',
    message: c.ok ? '讲到「' + c.criterion + '」了。' : c.miss,
  }));
  const passCount = checks.filter((c) => c.ok).length;
  const passed = passCount >= 4;
  return { feedback, passed, passCount, total: 5 };
}

/* ================= 第 5 层：同类题 ================= */
export function variantOf(problem) {
  const v = (problem && problem.variant) || {};
  return { title: v.title || '变式题', stem: v.stem || '同知识点换一道题：把条件改成另一种情形再判断。' };
}

export function gradeVariant(problem, answer) {
  const t = compact(answer);
  const v = (problem && problem.variant) || {};
  const kws = v.answerKeywords || ['绝对收敛', 'p=2'];
  const hasConclusion = t.includes('绝对收敛');
  const hasReason = kws.some((k) => k !== '绝对收敛' && t.includes(compact(k)));
  const correct = hasConclusion && hasReason;
  const feedback = correct
    ? '对了：1/n² 是 p=2>1 的 p 级数，所以绝对收敛。追问：如果换成 n 的一次方，结论会变吗？'
    : '再看一眼：先判断 1/n² 是哪种现成级数（p 与 1 比），结论写清「绝对收敛」。';
  return { correct, feedback };
}

/* ================= 第 6 层：总结 ================= */
export function checkSummary(input, problem) {
  const knowledge = String(input.knowledge || '').trim();
  const difficulty = String(input.difficulty || '').trim();
  const steps = String(input.steps || '').trim();
  const combined = [knowledge, difficulty, steps].join(' ');
  const kws = ['条件收敛', '莱布尼茨', 'p级数', 'p-级数', '绝对收敛', '单调', '判别法'];
  const hitCount = countHit(combined, kws);
  const checks = [
    { field: 'knowledge', ok: len(knowledge) >= 6, miss: '「我学到的知识点」还太短，写一句你自己的话。' },
    { field: 'difficulty', ok: len(difficulty) >= 6, miss: '「最容易错的重难点」还空着，写一个你真实卡过的点。' },
    { field: 'steps', ok: len(steps) >= 6, miss: '「下次的解题步骤」还空着，按顺序写 2–3 步。' },
    { field: 'keywords', ok: hitCount >= 2, miss: '总结里补上关键方法词：条件收敛 / 莱布尼茨判别法 / p 级数。' },
  ];
  const passed = checks.every((c) => c.ok);
  const feedback = checks.map((c) => ({ field: c.field, status: c.ok ? 'pass' : 'missing', message: c.ok ? '这一栏可以。' : c.miss }));
  const items = [];
  if (knowledge) items.push('知识点：' + knowledge.slice(0, 60));
  if (difficulty) items.push('重难点：' + difficulty.slice(0, 60));
  if (steps) items.push('步骤：' + steps.slice(0, 60));
  if (hitCount < 2) items.push('待补关键词：条件收敛 / 莱布尼茨判别法 / p 级数');
  const card = { title: '我的总结卡 · ' + ((problem && problem.kp && problem.kp[0]) || '本知识点'), items };
  return { feedback, passed, card, hitCount };
}

export function masteryFor(attempt, problem) {
  const passedSteps = (attempt.steps || []).filter((x) => x.status === 'passed').length;
  const infoUsed = (attempt.used.L1 || 0) + (attempt.used.L2 || 0) + (attempt.used.L3 || 0) + (attempt.used.L4 || 0);
  const coverage = (attempt.coverage && attempt.coverage.percent) || 0;
  const m = 55 + passedSteps * 5 + Math.round(coverage * 0.15) + (attempt.independence === 'independent' ? 8 : attempt.independence === 'semi' ? 4 : 0) - infoUsed * 2;
  return Math.max(40, Math.min(100, Math.round(m)));
}

/* ================= 覆盖 / 独立性 / 解锁（沿用 v1 口径） ================= */
export function checkCoverage(problem, text) {
  const t = compact(text);
  const steps = (problem && problem.keySteps) || [];
  const items = steps.map((k) => {
    const groups = k.match || [[k.text]];
    const covered = groups.every((group) => group.some((kw) => t.includes(compact(kw))));
    return { id: k.id, question: k.question || k.text, covered };
  });
  const covered = items.filter((x) => x.covered).length;
  const total = items.length || 1;
  const percent = Math.round((covered / total) * 100);
  return { covered, total, percent, passed: percent >= 80, items };
}

export function computeUnlocked(attempt) {
  const u = attempt.used || {};
  const fails = attempt.failedAttempts || 0;
  const layer = attempt.layer || 1;
  const unlocked = ['L0'];
  if ((attempt.steps || []).length >= 1 || layer > 3 || (attempt.stepIndex || 1) > 1) unlocked.push('L1');
  if ((u.L1 || 0) > 0 || fails >= 2) unlocked.push('L2');
  if ((u.L2 || 0) > 0 || fails >= 3) unlocked.push('L3');
  if ((u.L3 || 0) > 0 || fails >= 4) unlocked.push('L4');
  return unlocked;
}

export function computeIndependence(attempt) {
  const u = attempt.used || {};
  if ((u.L3 || 0) > 0 || (u.L4 || 0) > 0 || (attempt.pasteFlags || 0) > 0) return 'dependent';
  if ((u.L1 || 0) > 0 || (u.L2 || 0) > 0) return 'semi';
  return 'independent';
}

/* ================= 拒绝 / 小白解释 ================= */
export function refusal(attempt) {
  const times = (attempt && attempt.used && attempt.used.refusals) || 0;
  const alternatives = REFUSAL.alternatives.slice();
  if (times >= 2) alternatives.push({ id: 'rest', label: '先休息 2 分钟再回来', desc: '卡住时先离开屏幕，回来只写一步' });
  return { receive: REFUSAL.receive, rule: REFUSAL.rule, alternatives };
}
export function xiaobaiCard(concept) {
  const c = String(concept || '');
  const key = Object.keys(XIAOBAI_CARDS).find((k) => c.includes(k)) || '条件收敛';
  return { concept: key, ...XIAOBAI_CARDS[key] };
}

/* ================= 可选真实模型 ================= */
export async function tryDeepSeek({ system, user, timeoutMs = 8000 }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.3, max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return null;
    const jsonText = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonText);
    if (!parsed || !parsed.judge || !parsed.hint || !parsed.ask) return null;
    return { judge: String(parsed.judge), hint: String(parsed.hint), ask: String(parsed.ask), tag: 'L0 · 真实模型', source: 'deepseek' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function safeAi() {
  return {
    judge: '卡住很正常，先做最小的动作。',
    hint: '我不给你新信息。',
    ask: '你这一步的依据是哪条定义？只写一句。',
    tag: 'L0 安全兜底',
  };
}

export function newId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 8); }
