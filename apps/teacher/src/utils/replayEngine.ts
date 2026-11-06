import { ENGINE_EVENT_TYPES, createAttempt, replay, type AttemptState, type ProblemPackage } from '@proof-gym/engine';

import type { StoredEvent } from '../api/types.ts';

// 用引擎的 replay 把事件重放成当时的 AttemptState。
// 题目包来自 GET /teacher/problems/{pid}/versions/{v}（教师权限、读审计），Events 来自 /teacher/attempts/{id}/events。
// 只把 ENGINE_EVENT_TYPES 白名单事件喂给 reducer（服务端/客户端观察事件不驱动状态）。
export interface EngineFrame {
  seq: number;
  state: AttemptState;
}

export function buildEngineFrames(events: readonly StoredEvent[], pkg: ProblemPackage): EngineFrame[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const start = sorted.length > 0 ? Date.parse(sorted[0]!.tsServer) : 0;
  const ctx = { pkg, concepts: { concepts: [], glossary: [] } };
  let state = createAttempt(ctx, Number.isFinite(start) ? start : 0);
  const frames: EngineFrame[] = [{ seq: 0, state }];
  for (const event of sorted) {
    if (ENGINE_EVENT_TYPES.has(event.type)) {
      const at = Date.parse(event.tsServer);
      state = replay(state, [{ type: event.type, at: Number.isFinite(at) ? at : 0, payload: event.payload }]);
    }
    frames.push({ seq: event.seq, state });
  }
  return frames;
}

export function engineStateAt(frames: readonly EngineFrame[], seq: number): AttemptState | null {
  let current: AttemptState | null = null;
  for (const frame of frames) {
    if (frame.seq > seq) break;
    current = frame.state;
  }
  return current;
}
