// SimpleTex 的 LaTeX 输出 → MathText（中文 + $行内 LaTeX$），03 §3.4。
//   \text{任取}\varepsilon>0      → 任取 $\varepsilon>0$
//   纯中文                        → 原样（不加 $）
//   \begin{array}{l} a \\ b \end{array} → 拆成多行
//   \mathrm{lim} / \operatorname{lim} → \lim
//   全角标点保留在 $ 外
// 这是纯文本变换，不做任何数学判断。

const CJK = /[㐀-鿿豈-﫿]/u;
const FULLWIDTH_PUNCT = /[，。；：？！、（）【】《》“”‘’…—·]/u;

type Piece = { text: boolean; s: string };

function normalizeCommands(latex: string): string {
  return latex
    .replace(/\\(?:mathrm|operatorname)\s*\{\s*(lim|sup|inf|max|min|ln|log|exp|sin|cos|tan|arctan)\s*\}/g, '\\$1')
    .replace(/\\\\\s*\[[^\]]*\]/g, '\\\\')
    .trim();
}

// 把一行 LaTeX 拆成 文字/数学 片段：\text{…}、CJK 字符、全角标点属于文字，其余属于数学。
function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  const push = (text: boolean, s: string) => {
    const last = out[out.length - 1];
    if (last && last.text === text) last.s += s;
    else out.push({ text, s });
  };

  let i = 0;
  while (i < line.length) {
    const textCmd = /^\\(?:text|textrm|mbox)\s*\{/.exec(line.slice(i));
    if (textCmd) {
      let depth = 1;
      let j = i + textCmd[0].length;
      let inner = '';
      while (j < line.length && depth > 0) {
        const c = line[j] as string;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) break;
        }
        inner += c;
        j++;
      }
      push(true, inner);
      i = j + 1;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(i) as number);
    push(CJK.test(ch) || FULLWIDTH_PUNCT.test(ch), ch);
    i += ch.length;
  }
  return out;
}

function joinPieces(list: Piece[]): string {
  const parts: { math: boolean; s: string }[] = [];
  for (const piece of list) {
    if (piece.text) {
      const s = piece.s.trim();
      if (s !== '') parts.push({ math: false, s });
    } else {
      const s = piece.s.trim();
      if (s !== '') parts.push({ math: true, s });
    }
  }
  let out = '';
  parts.forEach((part, index) => {
    const prev = parts[index - 1];
    const body = part.math ? `$${part.s}$` : part.s;
    if (prev) {
      // 数学与"文字"相邻时补一个空格；全角标点前后不补
      const prevEnd = prev.s.slice(-1);
      const curStart = part.s.slice(0, 1);
      const punct = (c: string) => FULLWIDTH_PUNCT.test(c);
      if (prev.math !== part.math && !(prev.math ? punct(curStart) : punct(prevEnd))) out += ' ';
    }
    out += body;
  });
  return out;
}

function splitArrayLines(latex: string): string[] {
  const match = /\\begin\{(?:array|aligned|gathered|align\*?|split)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{(?:array|aligned|gathered|align\*?|split)\}/.exec(latex);
  if (!match) return [latex];
  const before = latex.slice(0, match.index);
  const after = latex.slice(match.index + match[0].length);
  const rows = (match[1] ?? '')
    .split(/\\\\/)
    .map((row) => row.replace(/&/g, ' ').trim())
    .filter((row) => row !== '');
  if (rows.length === 0) return [latex];
  const lines = rows.map((row) => row);
  if (before.trim() !== '') lines[0] = `${before.trim()} ${lines[0]}`;
  if (after.trim() !== '') lines[lines.length - 1] = `${lines[lines.length - 1]} ${after.trim()}`;
  return lines;
}

// 返回一行或多行 MathText；空输入返回 []。
export function latexToMathTextLines(latex: string): string[] {
  const normalized = normalizeCommands(latex);
  if (normalized === '') return [];
  return splitArrayLines(normalized)
    .map((line) => joinPieces(pieces(line)))
    .filter((line) => line !== '');
}

export function latexToMathText(latex: string): string {
  return latexToMathTextLines(latex).join('\n');
}
