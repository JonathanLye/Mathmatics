import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type Classification, classifyLine, nextKey } from '../src/classify.ts';
import type { ProblemPackage, Secret } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const epsN = JSON.parse(readFileSync(path.join(seedDir, 'epsN.json'), 'utf8')) as ProblemPackage;
const secret: Secret = epsN.secret;

// v3 原型 DEMO_SC 中学生提交的每一行（s + 依据 j），与 golden-v3-raw.json 的 step_submit 一一对应。
const K1: [string, string] = ['|a_n−3| = 5/(n+2)', '通分化简：3n+1−3(n+2)=−5'];
const K2: [string, string] = ['5/(n+2) < 5/n', '分母变小，分数变大'];
const K3: [string, string] = ['取 N=⌈5/ε⌉', 'N 只依赖 ε，先于 n 取定'];
const K4: [string, string] = ['当 n>N 时，|a_n−3| = 5/(n+2) < 5/n < ε', '前三行连成一条链'];
const ERR_N: [string, string] = ['取 N=n+1', '先把 N 定下来'];
const ERR_E2: [string, string] = ['|a_n−3| = 7/(n+2)', '我算的'];
const VAGUE: [string, string] = ['先把 N 取大一点吧', ''];
const UNKNOWN_W: [string, string] = ['不知道下一步', ''];

const match = (...keys: string[]): Classification => ({ type: 'match', keys });
const err = (errorId: string): Classification => {
  const e = secret.errors.find((x) => x.id === errorId);
  if (!e) throw new Error(`no error ${errorId}`);
  return { type: 'err', errorId, question: e.question };
};
const unknown: Classification = { type: 'unknown' };

describe('classifyLine：与 v3 golden 的 cls / keys 一致（17 次提交）', () => {
  const rows: [string, number, [string, string], Classification][] = [
    ['pro', 1, K1, match('K1')],
    ['pro', 2, K2, match('K1', 'K2')],
    ['pro', 3, K3, match('K3')],
    ['pro', 4, K4, match('K1', 'K2', 'K4')],
    ['mid', 1, K1, match('K1')],
    ['mid', 2, ERR_N, err('E1')],
    ['mid', 3, K2, match('K1', 'K2')],
    ['mid', 4, K3, match('K3')],
    ['mid', 5, VAGUE, unknown],
    ['mid', 6, K4, match('K1', 'K2', 'K4')],
    ['weak', 1, ERR_E2, err('E2')],
    ['weak', 2, UNKNOWN_W, unknown],
    ['weak', 3, K1, match('K1')],
    ['weak', 4, VAGUE, unknown],
    ['weak', 5, VAGUE, unknown],
    ['weak', 6, K2, match('K1', 'K2')],
    ['weak', 7, VAGUE, unknown],
  ];
  it.each(rows)('%s 第 %i 次', (_scenario, _n, [s, j], expected) => {
    expect(classifyLine(secret, `${s}　${j}`)).toEqual(expected);
  });
});

// 以下是 seed 模式与 v3 原型正则的已知差异（golden 未覆盖，属于有意保留的 seed 行为，见 PR 说明）。
describe('classifyLine：seed 模式与 v3 正则的差异（不改 seed）', () => {
  it('N=a_n 被 E1 截获（v3 的 \\bn\\b 看不到 _n 之后的 n）', () => {
    expect(classifyLine(secret, 'N=a_n')).toEqual(err('E1'));
  });
  it('N=2n 被 E1 截获（v3 的 \\bn\\b 看不到数字之后的 n）', () => {
    expect(classifyLine(secret, 'N=2n')).toEqual(err('E1'));
  });
  it('全角句号结尾的 >ε 被 E3 截获（v3 只认半角空白结尾）', () => {
    expect(classifyLine(secret, 'x>ε。')).toEqual(err('E3'));
  });
  it('5/n( 不被 K2 认作 5/n（seed 的前瞻排除了左括号；v3 认作 K2）', () => {
    expect(classifyLine(secret, '5/n(n+1)<ε')).toEqual(unknown);
  });
});

describe('nextKey：按路线取第一个未写出的关键步骤', () => {
  it('没有写出任何步骤时取 K1', () => {
    expect(nextKey(secret, new Set())?.id).toBe('K1');
  });
  it('写出 K1 后取 K2，路线闭合后返回 null', () => {
    expect(nextKey(secret, new Set(['K1']))?.id).toBe('K2');
    expect(nextKey(secret, new Set(['K1', 'K2', 'K3', 'K4']))).toBeNull();
  });
});
