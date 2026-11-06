// 两路识别结果的比对（03 §3.1 第 6 步）。
// agree 以 canon 为准；diff 的 start/end 是**主结果 text 的字符下标**，alt 是另一路在该段的文本（前端据此还原右路全文）。
// 对齐按 LaTeX 记号（\cmd 为一个记号）做最长公共子序列，差异落在 {…} 里时扩大到整个 \cmd{…}{…}（与前端 mock 约定一致：
// `\frac{5}{n+2}` 与 `\frac{5}{n+z}` 报整个 \frac）。记号级对齐后，canon 相同的片段（\dfrac 对 \frac、空格差异）不算差异。
import { canon } from '@proof-gym/engine';

export interface DiffSpan {
  start: number;
  end: number;
  alt: string;
}

// canon 串上的 Levenshtein（按码点），确认时记录学生改了多少。
export function editDistance(a: string, b: string): number {
  const x = Array.from(canon(a));
  const y = Array.from(canon(b));
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length] as number;
}

interface Tok {
  s: string;
  start: number;
  end: number;
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(text.slice(i));
      const len = m ? m[0].length : 1;
      out.push({ s: text.slice(i, i + len), start: i, end: i + len });
      i += len;
      continue;
    }
    const cp = String.fromCodePoint(text.codePointAt(i) as number);
    out.push({ s: cp, start: i, end: i + cp.length });
    i += cp.length;
  }
  return out;
}

// LCS：返回 primary 记号下标 → cross 记号下标（未匹配为 -1）
function align(a: Tok[], b: Tok[]): number[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i]!.s === b[j]!.s ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const map = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.s === b[j]!.s) {
      map[i] = j;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return map;
}

// 记号下标 k 所在的最外层 \cmd{..}.. 组的 [起, 止) 记号下标；不在花括号里则返回 [k, k+1)
function enclosingGroup(toks: Tok[], k: number): [number, number] {
  let depth = 0;
  let open = -1;
  for (let i = 0; i < k; i++) {
    if (toks[i]!.s === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (toks[i]!.s === '}') depth = Math.max(0, depth - 1);
  }
  if (depth === 0) return [k, k + 1];
  // open 是最外层未闭合的 {；向前吃掉它前面的 \cmd 与相邻的 {..} 组
  let start = open;
  while (start > 0 && (toks[start - 1]!.s === '}' || /^\\[A-Za-z]+$/.test(toks[start - 1]!.s))) {
    if (toks[start - 1]!.s === '}') {
      let d = 0;
      let p = start - 1;
      for (; p >= 0; p--) {
        if (toks[p]!.s === '}') d++;
        else if (toks[p]!.s === '{') {
          d--;
          if (d === 0) break;
        }
      }
      if (p < 0) break;
      start = p;
    } else {
      start -= 1;
      break;
    }
  }
  // 向后到 open 对应的 } 之后，并吃掉紧跟的 {..} 组
  let end = open;
  let d = 0;
  for (; end < toks.length; end++) {
    if (toks[end]!.s === '{') d++;
    else if (toks[end]!.s === '}') {
      d--;
      if (d === 0) {
        end++;
        if (toks[end]?.s === '{') {
          d = 0;
          continue;
        }
        break;
      }
    }
  }
  return [start, Math.min(Math.max(end, k + 1), toks.length)];
}

export function diffTexts(primary: string, cross: string): DiffSpan[] {
  if (canon(primary) === canon(cross)) return [];
  const a = tokenize(primary);
  const b = tokenize(cross);
  const map = align(a, b);

  // 1) 未匹配记号 → 区间（记号下标）
  const ranges: [number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    if (map[i] !== -1) continue;
    let [s, e] = enclosingGroup(a, i);
    // 区间边界落在匹配记号上时才需要组扩展；不在花括号里的单记号 [i,i+1) 原样
    s = Math.min(s, i);
    e = Math.max(e, i + 1);
    const last = ranges[ranges.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  }
  // 2) primary 少了记号（cross 多出来）：在匹配锚点之间的插入，挂到最近的 primary 记号上
  const matched = map.map((j, i) => ({ i, j })).filter((x) => x.j !== -1);
  const anchors = [{ i: -1, j: -1 }, ...matched, { i: a.length, j: b.length }];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const left = anchors[k]!;
    const right = anchors[k + 1]!;
    const inserted = right.j - left.j - 1;
    const removed = right.i - left.i - 1;
    if (inserted > 0 && removed === 0) {
      const at = Math.min(Math.max(right.i, 0), a.length - 1);
      let [s, e] = enclosingGroup(a, at);
      s = Math.min(s, at);
      e = Math.max(e, at + 1);
      const last = ranges[ranges.length - 1];
      if (last && s <= last[1] && e >= last[0]) {
        last[0] = Math.min(last[0], s);
        last[1] = Math.max(last[1], e);
      } else ranges.push([s, e]);
      ranges.sort((p, q) => p[0] - q[0]);
    }
  }
  // 合并重叠
  const merged: [number, number][] = [];
  for (const r of ranges.sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const spans: DiffSpan[] = [];
  for (const [s, e] of merged) {
    // 对应 cross 的记号区间：起点取 s 之前最近匹配锚点之后；终点取 e 及之后最近的匹配锚点
    let cs = 0;
    for (let i = s - 1; i >= 0; i--) {
      if (map[i] !== -1) {
        cs = (map[i] as number) + 1;
        break;
      }
    }
    if (map[s] !== undefined && map[s] !== -1) cs = map[s] as number;
    let ce = b.length;
    for (let i = e; i < a.length; i++) {
      if (map[i] !== -1) {
        ce = map[i] as number;
        break;
      }
    }
    const start = a[s]!.start;
    const end = a[e - 1]!.end;
    const alt = cs < ce ? cross.slice(b[cs]!.start, b[ce - 1]!.end) : '';
    if (canon(primary.slice(start, end)) === canon(alt)) continue; // 记号写法不同但 canon 相同
    spans.push({ start, end, alt });
  }
  if (spans.length === 0) return [{ start: 0, end: primary.length, alt: cross }];
  return spans;
}
