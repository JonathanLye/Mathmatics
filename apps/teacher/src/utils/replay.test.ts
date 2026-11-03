import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '../api/types.ts';

import { buildFrames, buildMarkers, eventLabel, frameAt } from './replay.ts';

function event(seq: number, type: string, layer: string | null, payload: Record<string, unknown> = {}): StoredEvent {
  return { id: `e${seq}`, seq, type, source: 'server', tsServer: '2026-11-04T00:00:00.000Z', layer, payload };
}

const EVENTS: StoredEvent[] = [
  event(1, 'attempt.start', 'L1'),
  event(2, 'layer.enter', 'L1', { via: 'start' }),
  event(3, 'line.submit', 'L3', { n: 1, keys: ['K1'], newKeys: ['K1'] }),
  event(4, 'hint.deliver', 'L3', { level: 'H2', revealAfter: 0.5 }),
  event(5, 'integ.visibility', 'L3', { state: 'hidden' }),
  event(6, 'integ.visibility', 'L3', { state: 'visible', awayMs: 30000 }),
  event(7, 'line.submit', 'L3', { n: 2, keys: ['K2'], newKeys: ['K2'] }),
];

describe('事件级回放（04 §5.2）', () => {
  it('累积层/行/关键步骤/提示/批注/离开时长', () => {
    const frames = buildFrames(EVENTS);
    expect(frames).toHaveLength(7);
    const mid = frames[3] as (typeof frames)[number];
    expect(mid.layer).toBe('L3');
    expect(mid.lines).toBe(1);
    expect(mid.keys).toBe(1);
    expect(mid.hints).toBe(1);
    expect(mid.reveal).toBe(0.5);
    expect(mid.away).toBe(false); // seq=4（提示）时还没离开
    expect(frames[4]?.away).toBe(true); // seq=5 hidden
    const last = frames[6] as (typeof frames)[number];
    expect(last.lines).toBe(2);
    expect(last.keys).toBe(2);
    expect(last.away).toBe(false);
    expect(last.awayMs).toBe(30000);
  });

  it('frameAt 返回 seq 时刻之前的最后一帧', () => {
    const frames = buildFrames(EVENTS);
    expect(frameAt(frames, 0)?.seq).toBe(1);
    expect(frameAt(frames, 4)?.seq).toBe(4);
    expect(frameAt(frames, 5)?.seq).toBe(5);
  });

  it('markers 覆盖层/提交/提示/离开；标签可读', () => {
    const frames = buildFrames(EVENTS);
    const markers = buildMarkers(frames);
    expect(markers.map((marker) => marker.tone)).toEqual(['layer', 'line', 'hint', 'away', 'away', 'line']);
    expect(eventLabel('line.submit', 'L3', { n: 2 })).toBe('提交第 2 行');
    expect(eventLabel('integ.visibility', 'L3', { state: 'hidden' })).toBe('离开页面');
    expect(eventLabel('integ.visibility', 'L3', { state: 'visible' })).toBe('回到页面');
  });
});
