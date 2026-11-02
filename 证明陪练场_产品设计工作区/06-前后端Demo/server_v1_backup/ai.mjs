/**
 * ai.mjs —— Mock AI 引擎（可选 DeepSeek）
 * 负责：10 节点脚本、三段式回复、轻量诊断、提示阶梯、拒绝、小白解释、覆盖/复盘/变式。
 * 只依赖 node 内置模块；不读写数据库（由 server.mjs 落盘）。
 */
import crypto from 'node:crypto';

export const BUDGETS = { L1: 3, L2: 3, L3: 2, L4: 1, L0: 6, xiaobai: 2 };
export const SCRIPT_PROBLEM_ID = 'p-cond-series';
export const TOTAL_NODES = 10;

export const PHASES = [
  { key: 'P1', label: '知识激活' },
  { key: 'P2', label: '学生拆题' },
  { key: 'P3', label: '分步推进' },
  { key: 'P4', label: '终稿核对' },
  { key: 'P5', label: '五问复盘' },
  { key: 'P6', label: '迁移总结' },
];
export const PHASE_LABEL = {
  P1: 'P1 知识激活', P2: 'P2 学生拆题', P3: 'P3 分步推进',
  P4: 'P4 终稿核对', P5: 'P5 五问复盘', P6: 'P6 迁移总结',
};

/* ================= 10 节点脚本（文案改写自 05-演示原型 SCRIPT） ================= */
export const SCRIPT = [
  {
    no: 1, title: '读题 · 说清要证什么', phase: 'P1',
    rounds: [
      {
        label: '用自己的话说：这道题要你证什么？',
        sample: '要证这个级数收敛，还要判断它是条件收敛还是绝对收敛。',
        ai: {
          tag: 'L0 追问 · 不讲课',
          judge: '先别动笔，「条件收敛」是这道题的眼。',
          hint: '定义我不替你写。',
          ask: '「条件收敛」的完整定义是什么？只写这一句。',
        },
        next: '回答「条件收敛」的定义（用自己的话，不用背原文）。',
      },
      {
        label: '回答：条件收敛的定义是什么？',
        sample: '条件收敛就是级数本身收敛，但把每一项换成绝对值以后，新级数发散。',
        ai: {
          tag: 'L1 概念核对',
          judge: '定义抓准了：先收敛，去绝对值后发散。',
          hint: '现在回到题面。',
          ask: '按这个定义，这道题你要分别证明几件事？',
        },
        next: 'P1 通过。下一步：拆题，说清要证几件事。',
      },
    ],
    phaseAfter: 'P2',
  },
  {
    no: 2, title: '拆题 · 要证几件事', phase: 'P2',
    rounds: [
      {
        label: '拆题：这道题你要分别证明几件事？',
        sample: '两件：先证原级数收敛；再证绝对值级数 ∑1/√n 发散。',
        ai: {
          tag: 'L0 追问 · 学生自己拆',
          judge: '「两件」点得准，方向对。',
          hint: '一次只攻一件。',
          ask: '你打算先攻哪一件？',
        },
        next: 'P2 通过。下一步：写第 1 步（先攻收敛这一半）。',
      },
    ],
    phaseAfter: 'P3',
  },
  {
    no: 3, title: '写第 1 步 · 单调性', phase: 'P3',
    rounds: [
      {
        label: '写第 1 步 + 依据（一句话）',
        sample: '先攻收敛。u_n=1/√n 随 n 增大而变小，因为分母越来越大。',
        ai: {
          tag: 'L0 追问 · 只指第一个可疑点',
          judge: '「分母越来越大」方向对，但还不算证明。',
          hint: '把 u_n 和 u_{n+1} 写成具体的不等式。',
          ask: '用 n 和 n+1 写一个不等式，证明 u_{n+1} < u_n。',
        },
        next: '把不等式补进第 1 步（下一步就是补它）。',
      },
    ],
  },
  {
    no: 4, title: '补不等式 · 每步必须写依据', phase: 'P3',
    rounds: [
      {
        label: '把不等式补进第 1 步 + 依据',
        sample: '1/√(n+1) < 1/√n，因为 n+1 > n。这是莱布尼茨判别法的单调条件。',
        ai: {
          tag: 'L0 · 计算核对',
          judge: '不等式成立，依据也写清楚了。',
          hint: '单调性过关；莱布尼茨还要「极限为 0」。',
          ask: 'lim 1/√n 为什么是 0？给出依据，不要只写结果。',
        },
        draftLine: {
          tag: '第 1 步 · 单调性（你写的）',
          text: '① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。',
        },
        next: '写第 2 步：极限为 0 的依据。',
      },
    ],
  },
  {
    no: 5, title: '卡住 · 用提示看 L2', phase: 'P3', type: 'hint',
    label: '卡住了？写下你卡在哪，然后打开提示阶梯。',
    sample: '我卡在 lim 1/√n=0 的依据上，不知道怎么写。',
    recommend: 'L2',
    phaseAfter: 'P3',
  },
  {
    no: 6, title: '写第 3 步并收成结论', phase: 'P3',
    rounds: [
      {
        label: '写第 3 步：把「极限为 0」的依据写出来',
        sample: '因为 lim n^{1/2}=+∞，所以 lim 1/√n = 0。',
        ai: {
          tag: 'L0 肯定 · 给一步就交还',
          judge: '「lim 1/√n=0」补得对，三个条件齐了。',
          hint: '把收敛这一半收成一句结论。',
          ask: '由这三条能得什么结论？用「由莱布尼茨判别法……」开头。',
        },
        draftLine: {
          tag: '第 2 步 · 极限为 0（你写的）',
          text: '② 因为 n^{1/2} → +∞，所以 1/√n → 0。',
        },
        next: '写收敛这一半的结论句。',
      },
      {
        label: '写结论句：收敛这一半得到什么？',
        sample: '由莱布尼茨判别法，这个交错级数收敛。',
        ai: {
          tag: 'L0 · 交还学生',
          judge: '第一件事做完了，写法规范。',
          hint: '接下来第二件：绝对值级数。',
          ask: '∑|a_n| 具体是哪个级数，你对它知道什么？',
        },
        draftLine: {
          tag: '第 3 步 · 收敛结论（你写的）',
          text: '③ 由莱布尼茨判别法，∑(−1)^{n−1}/√n 收敛。',
        },
        next: '处理第二件事：绝对收敛。',
      },
    ],
  },
  {
    no: 7, title: '要答案 · 触发三段式拒绝', phase: 'P3', type: 'refuse',
    label: '现在对 AI 说「直接给我完整证明」，看它怎么拒绝。',
    sample: '你把完整证明发我吧，明天考试我背一下。',
    phaseAfter: 'P3',
  },
  {
    no: 8, title: '绝对收敛 · 小白解释 + 回严格表述', phase: 'P3',
    rounds: [
      {
        label: '第二件事：∑1/√n 是什么级数？你卡在哪？',
        sample: '∑1/√n 是 p 级数，p=1/2。可 p 级数什么时候收敛我忘了，看不懂。',
        ai: {
          tag: 'L2 方向 · 小白解释 ×1',
          judge: '认出是 p-级数了，只是规则忘了。',
          hint: 'p 级数 ∑1/n^p：分母涨得越快越容易收敛。和本题无关的例子：∑1/n²（p=2）收敛。',
          ask: '回到严格表述：这里的 p 是多少？',
        },
        next: '回到严格表述：p 是多少？收敛还是发散？',
      },
      {
        label: '按规则回答：p 是多少？收敛还是发散？',
        sample: 'p=1/2 ≤ 1，所以 ∑1/√n 发散。',
        ai: {
          tag: 'L0 · 收口',
          judge: '「p=1/2≤1」用对了，发散结论站得住。',
          hint: '两件事都齐了，可以写终稿。',
          ask: '两条结论合起来，这个级数该叫什么？',
        },
        draftLine: {
          tag: '第 4 步 · 绝对发散（你写的）',
          text: '④ 而 ∑1/√n 是 p=1/2 的 p-级数，p≤1 故发散，所以原级数不绝对收敛。因此它是条件收敛。',
        },
        next: 'P3 完成。进入 S4 交终稿、核对覆盖。',
      },
    ],
    phaseAfter: 'P4',
  },
  { no: 9, title: '终稿核对 + 五问复盘', phase: 'P4', type: 'final' },
  { no: 10, title: '迁移与总结（变式题）', phase: 'P6', type: 'variant' },
];

export const HINT_TAGS = {
  L0: 'L0 追问', L1: 'L1 概念提示', L2: 'L2 方向提示', L3: 'L3 局部步骤', L4: 'L4 示范微步',
};
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
    analogy: 'p 级数像一场「分母长得多快」的比赛：p 越大，分母长得越快，级数越容易收敛。',
    example: '∑1/n²（p=2）收敛；∑1/n（p=1）发散。',
    formal: 'p 级数 ∑1/n^p：p>1 收敛，0<p≤1 发散。',
    ask: '这里的 p 是多少？按规则它收敛还是发散？说一句再回题目。',
  },
  'ε-N': {
    analogy: 'ε 是对方要求的误差，N 是「从第几项开始都够近」的分界线。',
    example: '要求误差 <0.01 时，你只需要找到一个 N，让后面所有项都够近。',
    formal: '对任意 ε>0，存在 N，当 n>N 时 |a_n−A|<ε。',
    ask: '用你自己的话说：N 是给谁的、依赖谁？',
  },
  '一致连续': {
    analogy: '一把尺子管住整个区间；普通连续是每个点各用各的尺子。',
    example: 'f(x)=x 在 R 上一把尺子就够；f(x)=1/x 在 (0,1) 上不行。',
    formal: '对任意 ε>0，存在 δ>0，对任意 x,y，|x−y|<δ 就有 |f(x)−f(y)|<ε。',
    ask: '复述一遍：δ 能不能依赖 x？',
  },
};

function norm(s) { return String(s == null ? '' : s); }
function compact(s) { return norm(s).replace(/\s+/g, ''); }
function charLen(s) { return [...compact(s)].length; }

/* ================= 诊断（轻量规则） ================= */
export function diagnose(text, opts = {}) {
  const s = norm(text).trim();
  const node = opts.node || 1;
  if (charLen(s) < 6) {
    return { verdict: 'insufficient', firstError: null, type: '资料不足', confidence: 0.3, note: '先写完整一句话，我只看这一步。' };
  }
  const hasReason = /因为|由于|由[^。；\n]{0,12}得|依据|所以|故|从而|因此|可知/.test(s);
  const hasInequality = /[<>≤≥＜＞]|不等式/.test(s);
  if (node <= 4 && !hasInequality) {
    return { verdict: 'suspect', firstError: node, type: '缺不等式', confidence: 0.86, note: '把 u_n 与 u_{n+1} 写成具体的不等式，再谈依据。' };
  }
  if (!hasReason) {
    return { verdict: 'missing_reason', firstError: node, type: '缺依据', confidence: 0.72, note: '补一句「因为 / 由…得」，说明这一步为什么成立。' };
  }
  return { verdict: 'ok', firstError: null, type: '可以', confidence: 0.9, note: '这一步暂时站得住，继续下一步。' };
}

/* ================= 提示解锁 ================= */
export function computeUnlocked(attempt) {
  const u = attempt.used || {};
  const fails = attempt.fails || 0;
  const node = attempt.node || 1;
  const unlocked = ['L0'];
  if ((attempt.stepsSubmitted || 0) >= 1 || node >= 2) unlocked.push('L1');
  // 节点 5 是脚本里的「卡住」节点（原型 preTries=1）：视为已连续失败 2 次，解锁 L2
  if ((u.L1 || 0) > 0 || fails >= 2 || node >= 5) unlocked.push('L2');
  if ((u.L2 || 0) > 0 || fails >= 3) unlocked.push('L3');
  if ((u.L3 || 0) > 0 || fails >= 4) unlocked.push('L4');
  return unlocked;
}

export function hintText(problem, level) {
  if (level === 'L0') return L0_TEXT;
  return (problem && problem.hints && problem.hints[level]) || L0_TEXT;
}

/* ================= 覆盖度 ================= */
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

/* ================= 复盘 ================= */
export function reviewFeedback(answers, attempt, coverage) {
  const list = Array.isArray(answers) ? answers : [];
  const feedback = list.map((a, i) => {
    const ok = compact(a).length >= 6;
    return { index: i + 1, ok, comment: ok ? '有自己的话，可以。' : '太短了，写一句你自己的判断。' };
  });
  const okCount = feedback.filter((f) => f.ok).length;
  const cov = coverage ? coverage.percent : 0;
  const mastery = Math.max(40, Math.min(100, Math.round(55 + cov * 0.3 + okCount * 3)));
  return { feedback, mastery };
}

/* ================= 变式题 ================= */
export function variantResult(problem, answer) {
  const t = compact(answer);
  const v = (problem && problem.variant) || {};
  const kws = v.answerKeywords || ['绝对收敛', 'p=2'];
  const hasConclusion = t.includes('绝对收敛');
  const hasReason = kws.some((k) => k !== '绝对收敛' && t.includes(compact(k)));
  const correct = hasConclusion && hasReason;
  return {
    correct,
    feedback: correct
      ? '结论和理由都对：1/n² 是 p=2>1 的 p 级数，所以绝对收敛。'
      : '再看一眼：先判断 1/n² 是什么级数（p 与 1 比），结论要写清「绝对收敛」。',
  };
}

/* ================= 小白解释 ================= */
export function xiaobaiCard(concept) {
  const c = norm(concept);
  const key = Object.keys(XIAOBAI_CARDS).find((k) => c.includes(k)) || '条件收敛';
  return { concept: key, ...XIAOBAI_CARDS[key] };
}

/* ================= 拒绝话术（连续两次换替代动作） ================= */
export function refusal(attempt) {
  const times = (attempt && attempt.used && attempt.used.refusals) || 0;
  const alternatives = REFUSAL.alternatives.slice();
  if (times >= 2) alternatives.push({ id: 'rest', label: '先休息 2 分钟再回来', desc: '卡住时先离开屏幕，回来只写一步' });
  return { receive: REFUSAL.receive, rule: REFUSAL.rule, alternatives };
}

/* ================= 节点推进（由 server 调用后落盘） ================= */
export function stepInfo(attempt) {
  const def = SCRIPT[attempt.node - 1];
  if (!def || def.type) return null;
  const rounds = def.rounds || [];
  const r = rounds[Math.min(attempt.round, rounds.length - 1)];
  return { def, round: r, isLastRound: attempt.round >= rounds.length - 1, totalRounds: rounds.length };
}

export function advanceAfterStep(attempt) {
  const def = SCRIPT[attempt.node - 1];
  attempt.round = (attempt.round || 0) + 1;
  const rounds = (def && def.rounds) || [];
  if (attempt.round >= rounds.length) {
    attempt.round = 0;
    attempt.node = Math.min(TOTAL_NODES, attempt.node + 1);
    attempt.fails = 0;
    const nextDef = SCRIPT[attempt.node - 1];
    attempt.phase = (def && def.phaseAfter) || (nextDef && nextDef.phase) || attempt.phase;
  }
  return attempt;
}

export function advanceAfterHint(attempt) {
  if (attempt.node === 5) {
    attempt.node = 6;
    attempt.round = 0;
    attempt.fails = 0;
    attempt.phase = 'P3';
  }
  return attempt;
}

export function advanceAfterRefusal(attempt) {
  if (attempt.node === 7) {
    attempt.node = 8;
    attempt.round = 0;
    attempt.phase = 'P3';
  }
  return attempt;
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
        messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        temperature: 0.3,
        max_tokens: 300,
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

export function newId(prefix) {
  return prefix + '-' + crypto.randomUUID().slice(0, 8);
}
