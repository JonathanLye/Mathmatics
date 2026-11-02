// canon()：把 MathText（中文 + $…$ 行内 LaTeX）规范化成一条线性串，供关键步骤匹配与防泄题闸门使用。
// 这是 10-开发文档/contracts/tools/canon.mjs（参考实现）的 TypeScript 移植，两者必须逐字节一致。
// 回归用例与逐字节比对见 test/canon.test.ts。
// 规则见 10-开发文档/03-手写键盘与识别.md §5。不做大小写折叠：N 与 n 必须区分。

type Token = { type: 'cmd'; value: string } | { type: 'sym'; value: string } | { type: 'ch'; value: string };

const CMD: Record<string, string> = {
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
const DROP = new Set([
  'left', 'right', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big', 'bigg', 'Bigg', 'biggl', 'biggr',
  'displaystyle', 'textstyle', 'scriptstyle', 'quad', 'qquad', 'limits', 'nolimits',
]);
const UNWRAP = new Set(['text', 'mathrm', 'operatorname', 'mathbf', 'boldsymbol', 'mathit', 'textrm', 'mbox', 'mathsf']);
const BB: Record<string, string> = { N: 'ℕ', R: 'ℝ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' };
const FRAC = new Set(['frac', 'dfrac', 'tfrac', 'cfrac']);

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (m) {
        out.push({ type: 'cmd', value: m[1] });
        i += m[0].length;
      } else {
        out.push({ type: 'sym', value: s[i + 1] ?? '' });
        i += 2;
      }
    } else {
      out.push({ type: 'ch', value: c });
      i += 1;
    }
  }
  return out;
}

// 整个串被一对最外层括号包住
function wrapped(x: string): boolean {
  if (x[0] !== '(' || x[x.length - 1] !== ')') return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === '(') d++;
    else if (x[i] === ')') {
      d--;
      if (d === 0 && i < x.length - 1) return false;
    }
  }
  return d === 0;
}

// 分母、根号、上下标：只有"单个数 / 单个字母 / 已加括号 / √简单量 / |…| / ⌈…⌉"不加括号
const simple = (x: string): boolean =>
  /^\d+(\.\d+)?$/.test(x) ||
  /^\p{L}$/u.test(x) ||
  x === '∞' ||
  wrapped(x) ||
  /^(\p{L}|\d+)[\^_](\d+|\p{L})$/u.test(x) ||
  /^\|[^|]*\|$/.test(x) ||
  /^⌈[^⌈⌉]*⌉$/.test(x) ||
  (x[0] === '√' && simple(x.slice(1)));

// 分子：顶层（括号外）没有二元 + - 和关系符就不加括号，如 (-1)^(n-1)/√n、2n/(n+1)
function topLevelOp(x: string): boolean {
  let d = 0;
  for (let i = 0; i < x.length; i++) {
    const c = x[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && i > 0 && /[+\-=<>≤≥≠,]/.test(c)) return true;
  }
  return false;
}

const wrapDen = (x: string): string => (x === '' || simple(x) ? x : `(${x})`);
const wrapNum = (x: string): string => (x === '' || !topLevelOp(x) ? x : `(${x})`);

function parse(tokens: Token[]): string {
  let i = 0;

  // 读一个参数：{…} 或单个记号
  function group(): string {
    const t = tokens[i];
    if (!t) return '';
    if (t.type === 'ch' && t.value === '{') {
      i++;
      const s = seq('}');
      i++;
      return s;
    }
    if (t.type === 'ch' && t.value === ' ') {
      i++;
      return group();
    }
    i++;
    return atom(t);
  }

  function atom(t: Token): string {
    if (t.type === 'ch') return t.value;
    if (t.type === 'sym') {
      if (t.value === '{' || t.value === '}') return t.value;
      if (t.value === '|') return '‖';
      return ''; // \, \; \! \  等间距命令
    }
    const c = t.value;
    if (FRAC.has(c)) {
      const a = group();
      const b = group();
      return `${wrapNum(a)}/${wrapDen(b)}`;
    }
    if (c === 'sqrt') {
      let idx = '';
      const next = tokens[i];
      if (next && next.type === 'ch' && next.value === '[') {
        i++;
        const parts: string[] = [];
        while (tokens[i] && !(tokens[i].type === 'ch' && tokens[i].value === ']')) parts.push(atom(tokens[i++]));
        i++;
        idx = parts.join('');
      }
      const a = group();
      return idx ? `root(${idx},${a})` : `√${wrapDen(a)}`;
    }
    if (UNWRAP.has(c)) return group();
    if (c === 'mathbb') {
      const a = group();
      return BB[a] ?? a;
    }
    if (c === 'left' || c === 'right') {
      const n = tokens[i];
      if (n && n.type === 'ch' && n.value === '.') i++;
      return '';
    }
    if (DROP.has(c)) return '';
    if (Object.hasOwn(CMD, c)) return CMD[c];
    return c; // 未知命令：保留命令名，方便人工排查
  }

  function seq(end: string | null): string {
    let out = '';
    while (i < tokens.length) {
      const t = tokens[i];
      if (end && t.type === 'ch' && t.value === end) break;
      if (t.type === 'ch' && (t.value === '^' || t.value === '_')) {
        i++;
        out += t.value + wrapDen(group());
        continue;
      }
      if (t.type === 'ch' && t.value === '{') {
        i++;
        out += seq('}');
        i++;
        continue;
      }
      if (t.type === 'cmd' && t.value === 'over') {
        i++;
        out = `${wrapNum(out)}/${wrapDen(seq(end))}`;
        break;
      }
      i++;
      out += atom(t);
    }
    return out;
  }

  return seq(null);
}

export function latexToLinear(latex: string): string {
  return parse(tokenize(latex));
}

const MAP: [RegExp, string][] = [
  [/<=/g, '≤'], [/>=/g, '≥'], [/!=/g, '≠'], [/->/g, '→'],
  [/[（]/g, '('], [/[）]/g, ')'], [/[［]/g, '['], [/[］]/g, ']'], [/[｛]/g, '{'], [/[｝]/g, '}'],
  [/[＜]/g, '<'], [/[＞]/g, '>'], [/[＝]/g, '='], [/[＋]/g, '+'], [/[−–—﹣－]/g, '-'],
  [/[×·⋅]/g, '*'], [/[÷]/g, '/'], [/[，]/g, ','], [/[；]/g, ';'], [/[：]/g, ':'], [/[。]/g, '.'],
  [/[≦]/g, '≤'], [/[≧]/g, '≥'], [/[ϵ]/g, 'ε'], [/[∣｜]/g, '|'], [/[⩽]/g, '≤'], [/[⩾]/g, '≥'],
];
const PRE: [RegExp, string][] = [[/²/g, '^2'], [/³/g, '^3'], [/ⁿ/g, '^n'], [/₁/g, '_1'], [/ₙ/g, '_n']];

function normText(s: string): string {
  let r = s;
  for (const [re, to] of PRE) r = r.replace(re, to); // 上下标字符必须在 NFKC 之前处理，否则 x² 会变成 x2
  r = r.normalize('NFKC'); // 全角字母数字 → 半角；ℕ→N、…→...
  for (const [re, to] of MAP) r = r.replace(re, to);
  return r;
}

// 按未转义的 $ 切分，奇数段是数学
export function splitMath(text: string): { math: boolean; s: string }[] {
  const parts: { math: boolean; s: string }[] = [];
  let buf = '';
  let math = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '$') {
      buf += '$';
      i++;
      continue;
    }
    if (c === '$') {
      if (text[i + 1] === '$') i++;
      parts.push({ math, s: buf });
      buf = '';
      math = !math;
      continue;
    }
    buf += c;
  }
  parts.push({ math, s: buf });
  return parts;
}

export function canon(mathText: string | null | undefined): string {
  return splitMath(String(mathText ?? ''))
    .map((p) => normText(latexToLinear(p.s))) // $ 外面也可能有学生直接敲的 u_{n+1}、\frac，统一按 LaTeX 线性化
    .join('')
    .replace(/\s+/g, '');
}

export function matchesAny(patterns: string[], mathText: string): boolean {
  const c = canon(mathText);
  return patterns.some((p) => new RegExp(p, 'u').test(c));
}
