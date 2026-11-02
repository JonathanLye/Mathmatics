import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { type AttemptState, createAttempt, replay } from '../src/index.ts';
import type { ConceptsFile } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

import { project, V3_CARVED_OUT, type V3Event } from './support/project.ts';
import { SCENARIOS } from './support/scenarios.ts';
import { BASE, Runner } from './support/runner.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const pkg = JSON.parse(readFileSync(path.join(seedDir, 'epsN.json'), 'utf8')) as ProblemPackage;
const concepts = JSON.parse(readFileSync(path.join(seedDir, 'concepts.json'), 'utf8')) as ConceptsFile;
const ctx = { pkg, concepts };

interface GoldenStep {
  step: number;
  do: string;
  layer: number;
  status: Record<string, string>;
  reveal: number;
  matched: string[];
  hintLv: Record<string, number>;
  keyCost: Record<string, number>;
  exhausted: boolean;
  flagged: boolean;
  events: V3Event[];
}
interface Golden {
  scenario: string;
  independence: number;
  final: { reveal: number; matched: string[]; status: Record<string, string> };
  steps: GoldenStep[];
}

const golden = (name: string): Golden =>
  JSON.parse(readFileSync(path.join(here, 'fixtures', `v3-${name}.json`), 'utf8')) as Golden;

function snapshot(s: AttemptState) {
  return {
    layer: s.layer,
    status: { ...s.status },
    reveal: s.hint.reveal,
    matched: [...s.hint.matched].sort(),
    hintLv: { ...s.hint.hintLv },
    keyCost: { ...s.hint.keyCost },
    exhausted: s.hint.exhausted,
    flagged: s.flagged,
  };
}

const goldenSnapshot = (g: GoldenStep) => ({
  layer: g.layer,
  status: g.status,
  reveal: g.reveal,
  matched: [...g.matched].sort(),
  hintLv: g.hintLv,
  keyCost: g.keyCost,
  exhausted: g.exhausted,
  flagged: g.flagged,
});

// 事件 payload 与 events.schema.json 的 p_* 定义逐条校验。
const schemaPath = path.join(here, '..', '..', 'contracts', 'events.schema.json');
const eventSchema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $id: string; $defs: Record<string, unknown> };
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => Ajv2020;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(eventSchema);
const payloadValidator = (type: string) => {
  const validate = ajv.getSchema(`${eventSchema.$id}#/$defs/p_${type.replace('.', '_')}`);
  if (!validate) throw new Error(`events.schema.json 中没有 ${type} 的 payload 定义`);
  return validate;
};

describe.each(['pro', 'mid', 'weak'] as const)('场景 %s：与 v3 golden 一致', (name) => {
  const g = golden(name);
  const run = () => {
    const r = new Runner(ctx);
    const steps = SCENARIOS[name].map((step) => {
      r.beginStep();
      step(r);
      return r.endStep();
    });
    return { r, steps };
  };

  it('每一步的事件（v3 字段）与快照与 golden 一致（ask、transfer_submit、lean_check 按名排除）', () => {
    const { steps } = run();
    expect(steps.length).toBe(g.steps.length);
    steps.forEach((s, i) => {
      const want = g.steps[i];
      const where = `第 ${want.step} 步「${want.do}」`;
      expect(project(s.events), where).toEqual(want.events.filter((e) => !V3_CARVED_OUT.includes(e.type as never)));
      expect(snapshot(s.state), `${where} 快照`).toEqual(goldenSnapshot(want));
    });
  });

  it('终态：独立度、透露量、已写出的关键步骤与 golden 一致', () => {
    const { r } = run();
    const reveal = r.state.hint.reveal;
    const independence = Math.max(0, 1 - reveal / pkg.secret.keys.length);
    expect(independence).toBe(g.independence);
    expect(reveal).toBe(g.final.reveal);
    expect([...r.state.hint.matched].sort()).toEqual([...g.final.matched].sort());
  });

  it('每个提示请求上 selectHint 的状态 = 该请求事件 apply 的结果（无不一致）', () => {
    const { r } = run();
    expect(r.mismatches).toEqual([]);
  });

  it('replay(全部事件) 与实时终态一致', () => {
    const { r } = run();
    expect(replay(createAttempt(ctx, BASE), r.events)).toEqual(r.state);
  });

  it('全部事件的 payload 通过 events.schema.json 校验', () => {
    const { r } = run();
    for (const event of r.events) {
      const validate = payloadValidator(event.type);
      expect(validate(event.payload), `${event.type} ${JSON.stringify(event.payload)}：${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });
});
