/**
 * guard.mjs —— 防泄题闸门（六条规则，服务端红线执行者）
 * check(text, { level, maxLen, referenceProof, keySteps, history }) ->
 *   { ok, blocked, rules: string[], safeText? }
 * 规则码：BANNED_WORD / NUMBERED_STEPS / TOO_LONG / STEP_LEAK / REFERENCE_OVERLAP / CHAINED
 * 只依赖 node 内置模块。
 */

export const LIMITS = { L0: 30, L1: 60, L2: 80, L3: 120, L4: 200, refusal: 100 };

export const SAFE_TEXT = '卡住很正常。先只回答一句：你这一步的依据是哪条定义？';

const BANNED = [/证毕/, /证明如下/, /答案是/, /综上/, /故命题成立/, /所以命题成立/, /所以[^。！？\n]{0,12}成立/];
const NUMBER_LINE = /^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+\s*[.、)）]|[（(]\d+[)）])\s*/m;

function compact(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
function charLen(s) { return [...compact(s)].length; }

function hitsBanned(text) { return BANNED.some((re) => re.test(text)); }
function hitsNumbered(text) {
  if (NUMBER_LINE.test(text)) return true;
  // 「首先…然后…最后」三连（按出现顺序）
  const a = text.indexOf('首先');
  const b = text.indexOf('然后');
  const c = text.indexOf('最后');
  return a >= 0 && b > a && c > b;
}

export function longestCommonSubstring(a, b) {
  const A = compact(a); const B = compact(b);
  if (!A || !B) return 0;
  const prev = new Array(B.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= A.length; i++) {
    let lastDiag = 0;
    for (let j = 1; j <= B.length; j++) {
      const tmp = prev[j];
      if (A[i - 1] === B[j - 1]) {
        prev[j] = lastDiag + 1;
        if (prev[j] > best) best = prev[j];
      } else {
        prev[j] = 0;
      }
      lastDiag = tmp;
    }
  }
  return best;
}

function leakedKeySteps(text, keySteps) {
  const t = compact(text);
  if (!t || !Array.isArray(keySteps)) return 0;
  let count = 0;
  for (const step of keySteps) {
    const raw = typeof step === 'string' ? step : (step && (step.text || step.question)) || '';
    const s = compact(raw);
    if (s.length < 6) continue;
    let hit = false;
    for (let i = 0; i + 6 <= s.length; i++) {
      if (t.includes(s.slice(i, i + 6))) { hit = true; break; }
    }
    if (hit) count++;
  }
  return count;
}

export function check(text, opts = {}) {
  const raw = String(text == null ? '' : text);
  const rules = [];
  const level = opts.level || 'L0';
  const maxLen = Number.isFinite(opts.maxLen) ? opts.maxLen : (LIMITS[level] || LIMITS.L0);

  if (hitsBanned(raw)) rules.push('BANNED_WORD');
  if (hitsNumbered(raw)) rules.push('NUMBERED_STEPS');
  if (charLen(raw) > maxLen) rules.push('TOO_LONG');
  if (leakedKeySteps(raw, opts.keySteps) >= 2) rules.push('STEP_LEAK');
  if (opts.referenceProof && longestCommonSubstring(raw, opts.referenceProof) >= 12) rules.push('REFERENCE_OVERLAP');

  const history = Array.isArray(opts.history) ? opts.history.slice(-3) : [];
  if (history.length) {
    const joined = history.join('\n') + '\n' + raw;
    if (hitsBanned(joined) || hitsNumbered(joined) || leakedKeySteps(joined, opts.keySteps) >= 3) rules.push('CHAINED');
  }

  const uniq = [...new Set(rules)];
  const blocked = uniq.length > 0;
  return blocked ? { ok: false, blocked: true, rules: uniq, safeText: SAFE_TEXT } : { ok: true, blocked: false, rules: [] };
}

/** 单段长度校验（judge≤25 / ask≤40 / hint 按等级），供 server 组装三段式前使用 */
export function checkParts(ai) {
  const rules = [];
  if (ai.judge && charLen(ai.judge) > 25) rules.push('JUDGE_TOO_LONG');
  if (ai.ask) {
    const askLen = charLen(ai.ask);
    const qCount = (String(ai.ask).match(/[？?]/g) || []).length;
    if (askLen > 40 || qCount !== 1) rules.push('ASK_INVALID');
  }
  return { ok: rules.length === 0, rules };
}
