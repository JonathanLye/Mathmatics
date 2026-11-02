// canon()：把 MathText（中文 + $…$ 行内 LaTeX）规范化成一条线性串，供关键步骤匹配与防泄题闸门使用。
// 这是参考实现：服务端 packages/engine/canon 必须与它逐字节一致（contracts/tools/check-seeds.mjs 里有回归用例）。
// 规则见 10-开发文档/03-手写键盘与识别.md §5。不做大小写折叠：N 与 n 必须区分。

const CMD = {
  varepsilon: 'ε', epsilon: 'ε', delta: 'δ', alpha: 'α', beta: 'β', gamma: 'γ', lambda: 'λ', mu: 'μ',
  xi: 'ξ', eta: 'η', theta: 'θ', pi: 'π', sigma: 'σ', varphi: 'φ', phi: 'φ', omega: 'ω', rho: 'ρ', tau: 'τ',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
  le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥', ne: '≠', neq: '≠', lt: '<', gt: '>',
  to: '→', rightarrow: '→', longrightarrow: '→', mapsto: '→', Rightarrow: '⇒', implies: '⇒', Longrightarrow: '⇒',
  Leftrightarrow: '⇔', iff: '⇔', forall: '∀', exists: '∃', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  infty: '∞', cdot: '*', times: '*', pm: '±', mp: '∓', approx: '≈', equiv: '≡', sim: '~',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lvert: '|', rvert: '|', vert: '|', mid: '|', lVert: '‖', rVert: '‖',
  cdots: '…', ldots: '…', dots: '…', div: '/', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', neg: '¬', land: '∧', lor: '∨',
  lim: 'lim', limsup: 'limsup', liminf: 'liminf', sup: 'sup', inf: 'inf', max: 'max', min: 'min',
  ln: 'ln', log: 'log', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', arctan: 'arctan',
  sum: '∑', prod: '∏', int: '∫', partial: '∂', N: 'ℕ', R: 'ℝ', Z: 'ℤ', Q: 'ℚ',
};
const DROP = new Set(['left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big', 'bigg', 'Bigg', 'biggl', 'biggr',
  'displaystyle', 'textstyle', 'scriptstyle', 'quad', 'qquad', 'limits', 'nolimits']);
const UNWRAP = new Set(['text', 'mathrm', 'operatorname', 'mathbf', 'boldsymbol', 'mathit', 'textrm', 'mbox', 'mathsf']);
const BB = { N: 'ℕ', R: 'ℝ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' };
const FRAC = new Set(['frac', 'dfrac', 'tfrac', 'cfrac']);

function tokenize(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (m) { out.push({ cmd: m[1] }); i += m[0].length; }
      else { out.push({ sym: s[i + 1] ?? '' }); i += 2; }
    } else { out.push({ ch: c }); i += 1; }
  }
  return out;
}

function wrapped(x) {           // 整个串被一对最外层括号包住
  if (x[0] !== '(' || x[x.length - 1] !== ')') return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) { if (x[i] === '(') d++; else if (x[i] === ')') { d--; if (d === 0 && i < x.length - 1) return false; } }
  return d === 0;
}
// 分母、根号、上下标：只有"单个数 / 单个字母 / 已加括号 / √简单量 / |…| / ⌈…⌉"不加括号
const simple = x => /^\d+(\.\d+)?$/.test(x) || /^\p{L}$/u.test(x) || x === '∞' || wrapped(x)
  || /^(\p{L}|\d+)[\^_](\d+|\p{L})$/u.test(x)
  || /^\|[^|]*\|$/.test(x) || /^⌈[^⌈⌉]*⌉$/.test(x) || (x[0] === '√' && simple(x.slice(1)));
// 分子：顶层（括号外）没有二元 + - 和关系符就不加括号，如 (-1)^(n-1)/√n、2n/(n+1)
function topLevelOp(x) {
  let d = 0;
  for (let i = 0; i < x.length; i++) {
    const c = x[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && i > 0 && /[+\-=<>≤≥≠,]/.test(c)) return true;
  }
  return false;
}
const wrapDen = x => (x === '' || simple(x) ? x : `(${x})`);
const wrapNum = x => (x === '' || !topLevelOp(x) ? x : `(${x})`);

function parse(tokens) {
  let i = 0;
  function group() {             // 读一个参数：{…} 或单个记号
    const t = tokens[i];
    if (!t) return '';
    if (t.ch === '{') { i++; const s = seq('}'); i++; return s; }
    if (t.ch === ' ') { i++; return group(); }
    i++;
    return atom(t);
  }
  function atom(t) {
    if (t.ch !== undefined) return t.ch;
    if (t.sym !== undefined) {
      if (t.sym === '{' || t.sym === '}') return t.sym;
      if (t.sym === '|') return '‖';
      return '';                   // \, \; \! \  等间距命令
    }
    const c = t.cmd;
    if (FRAC.has(c)) { const a = group(), b = group(); return `${wrapNum(a)}/${wrapDen(b)}`; }
    if (c === 'sqrt') {
      let idx = '';
      if (tokens[i] && tokens[i].ch === '[') { i++; const parts = []; while (tokens[i] && tokens[i].ch !== ']') parts.push(atom(tokens[i++])); i++; idx = parts.join(''); }
      const a = group();
      return idx ? `root(${idx},${a})` : `√${wrapDen(a)}`;
    }
    if (UNWRAP.has(c)) return group();
    if (c === 'mathbb') { const a = group(); return BB[a] ?? a; }
    if (c === 'left' || c === 'right') { const n = tokens[i]; if (n && n.ch === '.') i++; return ''; }
    if (DROP.has(c)) return '';
    if (Object.hasOwn(CMD, c)) return CMD[c];
    return c;                      // 未知命令：保留命令名，方便人工排查
  }
  function seq(end) {
    let out = '';
    while (i < tokens.length) {
      const t = tokens[i];
      if (end && t.ch === end) break;
      if (t.ch === '^' || t.ch === '_') { i++; out += t.ch + wrapDen(group()); continue; }
      if (t.ch === '{') { i++; out += seq('}'); i++; continue; }
      if (t.cmd === 'over') { i++; out = `${wrapNum(out)}/${wrapDen(seq(end))}`; break; }
      i++;
      out += atom(t);
    }
    return out;
  }
  return seq(null);
}

export function latexToLinear(latex) { return parse(tokenize(latex)); }

const MAP = [
  [/<=/g, '≤'], [/>=/g, '≥'], [/!=/g, '≠'], [/->/g, '→'],
  [/[（]/g, '('], [/[）]/g, ')'], [/[［]/g, '['], [/[］]/g, ']'], [/[｛]/g, '{'], [/[｝]/g, '}'],
  [/[＜]/g, '<'], [/[＞]/g, '>'], [/[＝]/g, '='], [/[＋]/g, '+'], [/[−–—﹣－]/g, '-'],
  [/[×·⋅]/g, '*'], [/[÷]/g, '/'], [/[，]/g, ','], [/[；]/g, ';'], [/[：]/g, ':'], [/[。]/g, '.'],
  [/[≦]/g, '≤'], [/[≧]/g, '≥'], [/[ϵ]/g, 'ε'], [/[∣｜]/g, '|'], [/[⩽]/g, '≤'], [/[⩾]/g, '≥'],
];
const PRE = [[/²/g, '^2'], [/³/g, '^3'], [/ⁿ/g, '^n'], [/₁/g, '_1'], [/ₙ/g, '_n']];
function normText(s) {
  let r = s;
  for (const [re, to] of PRE) r = r.replace(re, to);   // 上下标字符必须在 NFKC 之前处理，否则 x² 会变成 x2
  r = r.normalize('NFKC');                             // 全角字母数字 → 半角；ℕ→N、…→...
  for (const [re, to] of MAP) r = r.replace(re, to);
  return r;
}

export function splitMath(text) {   // 按未转义的 $ 切分，奇数段是数学
  const parts = []; let buf = '', math = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '$') { buf += '$'; i++; continue; }
    if (c === '$') { if (text[i + 1] === '$') i++; parts.push({ math, s: buf }); buf = ''; math = !math; continue; }
    buf += c;
  }
  parts.push({ math, s: buf });
  return parts;
}

export function canon(mathText) {
  return splitMath(String(mathText ?? ''))
    .map(p => normText(latexToLinear(p.s)))   // $ 外面也可能有学生直接敲的 u_{n+1}、\\frac，统一按 LaTeX 线性化
    .join('')
    .replace(/\s+/g, '');
}

export function matchesAny(patterns, mathText) {
  const c = canon(mathText);
  return patterns.some(p => new RegExp(p, 'u').test(c));
}
