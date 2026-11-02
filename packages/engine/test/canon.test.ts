import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canon as referenceCanon } from '@proof-gym/contracts/tools/canon.mjs';
import { describe, expect, it } from 'vitest';

import { canon, matchesAny, splitMath } from '../src/canon.ts';

// 回归用例：与 10-开发文档/contracts/tools/check-seeds.mjs 的 CANON_CASES 保持一致（改一处即两处同改）。
const CANON_CASES: [string, string][] = [
  ['$|a_n-3|=\\frac{5}{n+2}$', '|a_n-3|=5/(n+2)'],
  ['|a_n − 3| = 5/(n+2)', '|a_n-3|=5/(n+2)'],
  ['任取 $\\varepsilon>0$，取 $N=\\left\\lceil \\frac{5}{\\varepsilon}\\right\\rceil$', '任取ε>0,取N=⌈5/ε⌉'],
  ['$\\displaystyle\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$', 'lim_(n→∞)(3n+1)/(n+2)=3'],
  ['$\\frac{1}{\\sqrt{n+1}}<\\frac{1}{\\sqrt{n}}$', '1/√(n+1)<1/√n'],
  ['$\\sum_{n=1}^{\\infty}\\frac{(-1)^{n-1}}{\\sqrt n}$', '∑_(n=1)^∞(-1)^(n-1)/√n'],
  ['u_{n+1} ≤ u_n', 'u_(n+1)≤u_n'],
  ['$\\sum|a_n|=\\sum\\frac{1}{n^2}$', '∑|a_n|=∑1/n^2'],
  ['x² 与 $x^{2}$', 'x^2与x^2'],
  ['∀ε>0，∃N，∀n>N，|a_n−A|<ε', '∀ε>0,∃N,∀n>N,|a_n-A|<ε'],
  ['价格 \\$5', '价格$5'],
  ['$5 \\over n+2$', '5/(n+2)'],
  ['$a \\div b$', 'a/b'],
  ['N >= 5/ε', 'N≥5/ε'],
  ['a != b', 'a≠b'],
  ['a -> b', 'a→b'],
];

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');

// 收集全部种子文件里的字符串（题面、关键步骤、提示、概念卡等），作为逐字节比对的语料。
function collectStrings(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

function seedStrings(): string[] {
  const out: string[] = [];
  for (const file of readdirSync(seedDir)) {
    if (!file.endsWith('.json')) continue;
    collectStrings(JSON.parse(readFileSync(path.join(seedDir, file), 'utf8')), out);
  }
  return out;
}

describe('canon()（TypeScript 移植）', () => {
  it.each(CANON_CASES)('回归用例：%j → %j', (input, expected) => {
    expect(canon(input)).toBe(expected);
  });

  it('与参考实现 canon.mjs 逐字节一致（回归用例）', () => {
    for (const [input] of CANON_CASES) expect(canon(input)).toBe(referenceCanon(input));
  });

  it('与参考实现 canon.mjs 逐字节一致（全部种子字符串）', () => {
    const strings = seedStrings();
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) expect(canon(s)).toBe(referenceCanon(s));
  });

  it('不做大小写折叠：N 与 n 必须区分', () => {
    expect(canon('$N$')).not.toBe(canon('$n$'));
  });

  it('splitMath 按未转义的 $ 切分，并支持 \\$', () => {
    expect(splitMath('价格 \\$5')).toEqual([{ math: false, s: '价格 $5' }]);
    expect(splitMath('a $x$ b')).toEqual([
      { math: false, s: 'a ' },
      { math: true, s: 'x' },
      { math: false, s: ' b' },
    ]);
  });

  it('matchesAny 对规范化后的串做正则匹配', () => {
    expect(matchesAny(['^\\|a_n-3\\|=5/\\(n\\+2\\)$'], '$|a_n-3|=\\frac{5}{n+2}$')).toBe(true);
    expect(matchesAny(['^lim'], '$\\frac{1}{n}$')).toBe(false);
  });
});
