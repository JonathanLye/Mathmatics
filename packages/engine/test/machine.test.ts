import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pickSelfcheck } from '../src/index.ts';
import type { ConceptsFile } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

import { DEF_OK, FRAME_TEXT, K1, K2, K3 } from './support/scenarios.ts';
import { Runner } from './support/runner.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const load = <T>(file: string): T => JSON.parse(readFileSync(path.join(seedDir, file), 'utf8')) as T;
const concepts = load<ConceptsFile>('concepts.json');
const clone = (pkg: ProblemPackage): ProblemPackage => structuredClone(pkg);
const epsN = load<ProblemPackage>('epsN.json');

// 进入第 3 层（定义、骨架都通过）
function atLayerThree(r: Runner): void {
  r.def(DEF_OK);
  r.frame(FRAME_TEXT);
}

describe('状态机：路径（golden 没有覆盖的部分）', () => {
  it('层不对的命令不产生事件：第 1 层提交一行', () => {
    const r = new Runner({ pkg: epsN, concepts });
    r.line(...K1);
    expect(r.events).toEqual([]);
    expect(r.state.layer).toBe(1);
  });

  it('第 3 层不可跳过：跳过命令不产生事件', () => {
    const r = new Runner({ pkg: epsN, concepts });
    atLayerThree(r);
    r.skip();
    expect(r.events.some((e) => e.type === 'layer.skip')).toBe(false);
    expect(r.state.layer).toBe(3);
  });

  it('连续卡住（≥2 次无进展，且超过 stuckMs）：主动询问是否要提示', () => {
    // 题目包的 stuckMs 调到 5 秒，让测试不必真的等三分钟
    const pkg = clone(epsN);
    pkg.public.budget.stuckMs = 5000;
    const r = new Runner({ pkg, concepts });
    atLayerThree(r);
    r.line('写一行', '');
    r.wait(10);
    r.line('又一行', '');
    const offers = r.events.filter((e) => e.type === 'proactive.offer');
    expect(offers).toHaveLength(1);
    expect(offers[0].payload).toMatchObject({ noProgress: 2 });
    expect(offers[0].payload.stuckMs as number).toBeGreaterThan(5000);
  });

  it('闸门拦截提示：未允许的泄题片段出现在 H2 里，不下发、不计透露量，记录 gate.block', () => {
    const pkg = clone(epsN);
    const k1 = pkg.secret.keys.find((k) => k.id === 'K1');
    if (!k1) throw new Error('no K1');
    k1.hints[2].text += '（即 5/(n+2)）';
    const r = new Runner({ pkg, concepts });
    atLayerThree(r);
    r.hint(); // H0
    r.hint(); // H1
    r.line('写一行', '');
    r.hint(); // H2：被拦
    const types = r.events.map((e) => e.type);
    expect(types).toContain('gate.block');
    expect(types.filter((t) => t === 'hint.deliver')).toHaveLength(2);
    expect(r.state.hint.reveal).toBe(0);
    expect(r.state.hint.hintLv.K1).toBe(2);
  });

  it('H4 给过之后，学生只写依据很短的同一步：标为示范行（demo_needs_reason），不计入已写出', () => {
    const r = new Runner({ pkg: epsN, concepts });
    atLayerThree(r);
    r.hint(); // H0
    r.hint(); // H1
    r.line('写一行', '');
    r.hint(); // H2（0.5）
    r.line('再写一行', '');
    r.hint(); // H3（补 0.5，累计 1）
    r.line('又一行', '');
    r.hint(); // H4（透露 0 增量）
    expect(r.state.viaHint).toEqual(['K1']);
    r.line(K1[0], ''); // 步骤相同，依据为空
    const last = r.events.filter((e) => e.type === 'line.submit').at(-1);
    expect(last?.payload).toMatchObject({ cls: 'demo_needs_reason', keys: ['K1'], newKeys: [] });
    expect(r.state.hint.matched.has('K1')).toBe(false);
  });

  it('同一步骤写了够长的依据，就按正常的 match 计入', () => {
    const r = new Runner({ pkg: epsN, concepts });
    atLayerThree(r);
    r.hint();
    r.hint();
    r.line('写一行', '');
    r.hint();
    r.line('再写一行', '');
    r.hint();
    r.line('又一行', '');
    r.hint();
    r.line(...K1); // 依据：通分化简（超过 5 个字）
    const last = r.events.filter((e) => e.type === 'line.submit').at(-1);
    expect(last?.payload).toMatchObject({ cls: 'match', newKeys: ['K1'] });
  });

  it('自检题的抽取：依据、作用、逻辑地位或条件各一题（题库顺序，确定性）', () => {
    expect(pickSelfcheck(epsN.secret)).toEqual(['SC1', 'SC2', 'SC3']);
  });

  it('事件里不出现学生原文（只有行号、归类与关键步骤 ID）', () => {
    const r = new Runner({ pkg: epsN, concepts });
    atLayerThree(r);
    r.line('独一无二的学生原文ABC', '依据原文XYZ');
    r.hint();
    const dump = JSON.stringify(r.events);
    expect(dump).not.toContain('独一无二');
    expect(dump).not.toContain('依据原文');
  });

  it('没有写出 K4 时点“写完了”不通过（finish.try complete=false），停留在第 3 层', () => {
    const r = new Runner({ pkg: epsN, concepts });
    atLayerThree(r);
    r.line(...K2);
    r.line(...K3);
    r.finish();
    expect(r.events.filter((e) => e.type === 'finish.try').at(-1)?.payload).toEqual({ complete: false });
    expect(r.state.layer).toBe(3);
  });
});
