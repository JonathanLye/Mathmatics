import type { StoredEvent } from '../api/types.ts';

// 04 §5.2 的事件级回放：不依赖 secret 也能重建“当时看到的过程”。
// 引擎 AttemptState 级重放需要 /teacher/problems 或服务端回放接口（契约缺口，见 PR #115 后续）。
export type ReplayTone = 'layer' | 'line' | 'hint' | 'note' | 'away' | 'other';

export interface ReplayFrame {
  seq: number;
  type: string;
  at: string;
  label: string;
  tone: ReplayTone;
  layer: string;
  lines: number;
  keys: number;
  hints: number;
  notes: number;
  reveal: number;
  away: boolean;
  awayMs: number;
}

const TONES: Record<string, ReplayTone> = {
  'layer.enter': 'layer',
  'line.submit': 'line',
  'hint.deliver': 'hint',
  annotation: 'note',
  'integ.visibility': 'away',
};

function toneOf(type: string): ReplayTone {
  return TONES[type] ?? 'other';
}

export function eventLabel(type: string, layer: string | null | undefined, payload: Record<string, unknown>): string {
  switch (type) {
    case 'layer.enter':
      return `进入 ${layer ?? '下一层'}`;
    case 'line.submit':
      return `提交第 ${String(payload.n ?? '?')} 行`;
    case 'hint.deliver':
      return `提示 ${String(payload.level ?? '')}`;
    case 'annotation':
      return `批注 ${String(payload.kind ?? '')}`;
    case 'integ.visibility':
      return payload.state === 'hidden' ? '离开页面' : '回到页面';
    case 'attempt.start':
      return '开始作答';
    case 'layer.skip':
      return `跳过 ${layer ?? '本层'}`;
    case 'layer.done':
      return `完成 ${layer ?? '本层'}`;
    case 'finish.try':
      return '尝试提交完成';
    case 'selfcheck.submit':
      return '提交自检';
    case 'summary.submit':
      return '提交总结';
    default:
      return type;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function buildFrames(events: readonly StoredEvent[]): ReplayFrame[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const keys = new Set<string>();
  let layer = 'L1';
  let lines = 0;
  let hints = 0;
  let notes = 0;
  let reveal = 0;
  let away = false;
  let awayMs = 0;

  return sorted.map((event) => {
    const payload = event.payload ?? {};
    const type = event.type;
    if (typeof event.layer === 'string' && event.layer !== '') layer = event.layer;
    if (type === 'line.submit') {
      lines += 1;
      for (const key of [...stringArray(payload.keys), ...stringArray(payload.newKeys)]) keys.add(key);
    }
    if (type === 'hint.deliver') {
      hints += 1;
      reveal = Math.max(reveal, Number(payload.revealAfter ?? 0));
    }
    if (type === 'annotation') notes += 1;
    if (type === 'integ.visibility') {
      if (payload.state === 'hidden') away = true;
      else {
        away = false;
        awayMs += Number(payload.awayMs ?? 0);
      }
    }
    return {
      seq: event.seq,
      type,
      at: event.tsServer,
      label: eventLabel(type, event.layer, payload),
      tone: toneOf(type),
      layer,
      lines,
      keys: keys.size,
      hints,
      notes,
      reveal,
      away,
      awayMs,
    };
  });
}

export interface ReplayMarker {
  seq: number;
  label: string;
  tone: ReplayTone;
}

export function buildMarkers(frames: readonly ReplayFrame[]): ReplayMarker[] {
  return frames.filter((frame) => frame.tone !== 'other').map((frame) => ({ seq: frame.seq, label: frame.label, tone: frame.tone }));
}

export function frameAt(frames: readonly ReplayFrame[], seq: number): ReplayFrame | null {
  let current: ReplayFrame | null = null;
  for (const frame of frames) {
    if (frame.seq > seq) break;
    current = frame;
  }
  return current ?? frames[0] ?? null;
}
