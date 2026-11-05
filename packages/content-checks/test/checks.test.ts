import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { checkCategories, checkPackage } from '../src/index.ts';

function seed(): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

describe('共享 S8 检查（#42）', () => {
  it('seed 通过四项检查', () => {
    const result = checkCategories(seed());
    expect(result.ok).toBe(true);
    expect(result.categories).toEqual({
      schema: true,
      katex: true,
      leakExhaustive: true,
      patternSelfTest: true,
    });
  });

  it('畸形包 schema 先失败，不抛异常', () => {
    expect(() => checkPackage({} as ProblemPackage)).not.toThrow();
    expect(checkPackage({} as ProblemPackage).ok).toBe(false);
  });

  it('结构/规则失败时 patternSelfTest=false，且不进入 leak（避免引擎抛错）', () => {
    const pkg = seed();
    pkg.secret.routes[0] = ['NOPE'];
    const result = checkCategories(pkg);
    expect(result.ok).toBe(false);
    expect(result.categories.patternSelfTest).toBe(false);
    expect(result.categories.leakExhaustive).toBe(false);
  });

  it('KaTeX 失败可定位（bad math）', () => {
    const pkg = seed();
    pkg.public.stem = '用 $\\frac{1}{$ 定义';
    const result = checkCategories(pkg);
    expect(result.categories.katex).toBe(false);
  });
});
