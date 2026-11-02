import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gateRule, hintAllow } from '../src/gate.ts';
import type { ProblemPackage, Secret } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const secret: Secret = (JSON.parse(readFileSync(path.join(seedDir, 'epsN.json'), 'utf8')) as ProblemPackage).secret;

const none = new Set<string>();

describe('gateRule：闸门规则层', () => {
  it('原样出现的泄题片段被拦', () => {
    const r = gateRule(secret, '所以 5/(n+2) 很小', none, []);
    expect(r).toEqual({ ok: false, hits: [{ key: 'K1', frag: '5/(n+2)' }] });
  });

  it('非 canon 形式的写法也被拦（空格、全角、LaTeX）', () => {
    expect(gateRule(secret, '$\\frac{5}{ n ＋ 2 }$', none, []).ok).toBe(false);
    expect(gateRule(secret, '$5 \\over n+2$', none, []).ok).toBe(false);
  });

  it('学生已写出的步骤不再拦', () => {
    expect(gateRule(secret, '5/(n+2)', new Set(['K1']), []).ok).toBe(true);
  });

  it('allow 中的步骤不拦', () => {
    expect(gateRule(secret, '5/(n+2)', none, ['K1']).ok).toBe(true);
  });

  it('H2 的允许清单为空：本步骤片段不能出现（比 v3 原型更严）', () => {
    expect(hintAllow('K1', 0.5)).toEqual([]);
    expect(gateRule(secret, '通分后是 5/(n+2)', none, hintAllow('K1', 0.5)).ok).toBe(false);
  });

  it('透露量为 1 的 H3/H4 允许本步骤片段', () => {
    expect(hintAllow('K1', 1)).toEqual(['K1']);
    expect(gateRule(secret, '$|a_n-3|=\\frac{5}{n+2}$', none, hintAllow('K1', 1)).ok).toBe(true);
  });

  it('其它步骤的片段照常拦（允许清单只放行本步骤）', () => {
    const r = gateRule(secret, '5/n 与 5/(n+2)', none, hintAllow('K1', 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits.map((h) => h.key)).toEqual(['K2']);
  });
});
