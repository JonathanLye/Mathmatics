import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '../api/types.ts';

import { buildEngineFrames, engineStateAt } from './replayEngine.ts';

function seed(): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

function event(seq: number, type: string, payload: Record<string, unknown>): StoredEvent {
  return {
    id: `e${seq}`,
    seq,
    type,
    source: 'server',
    tsServer: '2026-11-04T00:00:00.000Z',
    layer: 'L3',
    payload,
  };
}

const EVENTS: StoredEvent[] = [
  event(1, 'layer.enter', { via: 'start' }),
  event(2, 'line.submit', { n: 1, keys: ['K1'], newKeys: ['K1'] }),
  event(3, 'hint.deliver', { key: 'K1', level: 'H2', cost: 0.5, revealDelta: 0.5, revealAfter: 0.5 }),
  event(4, 't.nudge', { gated: false }), // 非引擎事件：不改变状态
  event(5, 'line.submit', { n: 2, keys: ['K1', 'K2'], newKeys: ['K2'] }),
];

describe('引擎级回放（04 §5.2）', () => {
  it('按 ENGINE_EVENT_TYPES 折叠，观察事件不影响状态', () => {
    const frames = buildEngineFrames(EVENTS, seed());
    expect(frames).toHaveLength(EVENTS.length + 1); // 含 seq=0 初始帧
    const at2 = engineStateAt(frames, 2);
    expect(at2?.lines).toBe(1);
    expect([...(at2?.hint.matched ?? [])]).toEqual(['K1']);
    const at3 = engineStateAt(frames, 3);
    expect(at3?.hint.reveal).toBe(0.5);
    const at4 = engineStateAt(frames, 4);
    expect(at4?.lines).toBe(1); // t.nudge 不驱动状态
    const at5 = engineStateAt(frames, 5);
    expect(at5?.lines).toBe(2);
    expect([...(at5?.hint.matched ?? [])].sort()).toEqual(['K1', 'K2']);
  });

  it('seq=0 返回初始状态；滑动到任意 seq 取最近帧', () => {
    const frames = buildEngineFrames(EVENTS, seed());
    const initial = engineStateAt(frames, 0);
    expect(initial?.lines).toBe(0);
    expect(engineStateAt(frames, 999)?.lines).toBe(2);
  });
});
