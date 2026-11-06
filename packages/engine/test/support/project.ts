import type { EngineEvent } from '../../src/index.ts';

// 把引擎事件投影成 v3 原型记录过的事件（只取 v3 实际记录的字段），用来与 golden 比对。
// 引擎有、v3 没有记录的事件（selfcheck.assign、hint.deny）不出现在投影里。
// v3 记录、但在本引擎没有对应事件的，见 V3_CARVED_OUT（ask、transfer_submit、lean_check）。

export type V3Event = { type: string } & Record<string, unknown>;

export const V3_CARVED_OUT = ['ask', 'transfer_submit', 'lean_check'] as const;

const CLS_TO_V3: Record<string, string> = {
  match: 'match',
  demo_needs_reason: 'match',
  error: 'err',
  unknown: 'unknown',
};

const layerNo = (layer: unknown): number => Number(String(layer).slice(1));

export function project(events: readonly EngineEvent[]): V3Event[] {
  const out: V3Event[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const p = e.payload;
    switch (e.type) {
      case 'def.submit':
        out.push({ type: 'def_submit', miss: Object.values(p.components as Record<string, boolean>).filter((v) => !v).length, order: p.orderOk });
        break;
      case 'lesson.open':
        out.push({ type: 'plain_card_open' });
        break;
      case 'lesson.check':
        out.push({ type: 'plain_card_answer', correct: p.correct });
        break;
      case 'frame.template':
        out.push({ type: 'frame_template' });
        break;
      case 'frame.submit':
        out.push({ type: 'frame_submit', miss: (p.missing as string[]).length });
        break;
      case 'line.submit':
        out.push({ type: 'step_submit', n: p.n, cls: CLS_TO_V3[p.cls as string], keys: p.keys, hasJust: p.hasJust });
        break;
      case 'hint.deliver':
        out.push({ type: 'hint', key: p.key, level: p.level, cost: p.cost });
        break;
      case 'hint.rapid_lock':
        out.push({ type: 'rapid_hint' });
        break;
      case 'hint.deny':
        // U15：v3 的"连点锁定"改为温和提示（不加锁）。事件换了名字，投影回 v3 的 rapid_hint，golden 仍可逐步比对。
        if (p.reason === 'rapid_soft') out.push({ type: 'rapid_hint' });
        break;
      case 'budget.exhausted':
        out.push({ type: 'budget_exhausted', key: p.key });
        break;
      case 'help.flag_teacher':
        out.push({ type: 'flag_teacher' });
        break;
      case 'proactive.offer':
        out.push({ type: 'proactive_offer' });
        break;
      case 'gate.block':
        out.push({ type: 'gate_block' });
        break;
      case 'finish.try':
        out.push({ type: 'finish_try', complete: p.complete });
        break;
      case 'selfcheck.submit': {
        // v3 每次提交只记一条 self_check（answered = 已写的题数）；引擎按题各记一条，这里把连续的几条合并。
        let answered = 1;
        while (i + 1 < events.length && events[i + 1].type === 'selfcheck.submit') {
          answered += 1;
          i += 1;
        }
        out.push({ type: 'self_check', answered });
        break;
      }
      case 'summary.submit':
        out.push({ type: 'summary_submit', missingPoint: (p.missing as string[]).length > 0 });
        break;
      case 'attempt.complete':
        out.push({ type: 'problem_done', independence: p.independence });
        break;
      case 'layer.done':
        out.push({ type: 'layer_done', layer: layerNo(p.layer) });
        break;
      case 'layer.skip':
        out.push({ type: 'layer_skip', layer: layerNo(p.layer) });
        break;
      case 'selfcheck.assign':
      case 'hint.request':
        break;
      default:
        throw new Error(`project：未知事件 ${e.type}`);
    }
  }
  return out;
}
