import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canon } from '../src/canon.ts';
import { gateRule } from '../src/gate.ts';
import { type ConceptsFile, leakExhaustive } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const concepts = JSON.parse(readFileSync(path.join(seedDir, 'concepts.json'), 'utf8')) as ConceptsFile;
const load = (file: string): ProblemPackage => JSON.parse(readFileSync(path.join(seedDir, file), 'utf8')) as ProblemPackage;
const clone = (pkg: ProblemPackage): ProblemPackage => structuredClone(pkg);

// check-seeds.mjs 会扫描的题目包（排除概念库与事件样例）
const PACKAGES = readdirSync(seedDir).filter(
  (f) => f.endsWith('.json') && f !== 'concepts.json' && f !== 'client-events.sample.json',
);

describe('穷举泄题检查（引擎侧复跑，与 check-seeds.mjs 同规则）', () => {
  it.each(PACKAGES)('%s 通过', (file) => {
    expect(leakExhaustive(load(file), concepts)).toEqual([]);
  });

  it('负面对照：H2 文本里夹带本步骤片段，必须被报出', () => {
    const pkg = clone(load('epsN.json'));
    const k1 = pkg.secret.keys.find((k) => k.id === 'K1');
    if (!k1) throw new Error('no K1');
    k1.hints[2].text += '（即 5/(n+2)）';
    const failures = leakExhaustive(pkg, concepts);
    expect(failures.map((f) => f.where)).toContain('K1.H2');
  });

  it('负面对照：路线外步骤的片段出现在自检题里，必须被报出', () => {
    const pkg = clone(load('epsN.json'));
    pkg.secret.routes = [['K1', 'K2', 'K4']];
    pkg.secret.selfcheckBank[0].template += '，比如 ⌈5/ε⌉';
    const failures = leakExhaustive(pkg, concepts);
    expect(failures.map((f) => f.where)).toContain('selfcheck.SC1');
  });

  it('负面对照：片段是题面的一部分，必须被报出', () => {
    const pkg = clone(load('epsN.json'));
    pkg.public.stem = `${pkg.public.stem} 注意 5/ε`;
    const failures = leakExhaustive(pkg, concepts);
    expect(failures.some((f) => f.where === 'K2.leak')).toBe(true);
  });

  it('回归：\\over 写法被识别为泄题（check-seeds 的 gate-probe）', () => {
    const pkg = load('epsN.json');
    expect(canon('$5 \\over n+2$')).toBe('5/(n+2)');
    expect(gateRule(pkg.secret, '$|a_n-3|={5 \\over n+2}$', new Set(), []).ok).toBe(false);
  });

  it('回归：已是 canon 形式的片段，原文以 LaTeX 写出时仍被识别（不被二次 canon 破坏）', () => {
    const pkg = clone(load('epsN.json'));
    pkg.secret.keys[0].leak = ['u_(n+1)'];
    expect(gateRule(pkg.secret, 'u_{n+1}', new Set(), []).ok).toBe(false);
  });
});
