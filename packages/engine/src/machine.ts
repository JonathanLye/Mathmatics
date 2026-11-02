import { canon, matchesAny } from './canon.ts';
import { classifyLine, nextKey } from './classify.ts';
import { gateRule, hintAllow } from './gate.ts';
import { type HintState, initialHintState, selectHint } from './hint.ts';
import type { ConceptsFile } from './leak.ts';
import type { ProblemPackage, Secret } from './types.ts';

// 作答状态机（09 §6、05 §4）。
// - 命令（学生输入）经 step 产生事件；事件是事实，只带 at（毫秒，由调用方的时钟给出）和 payload。
// - 状态只由 apply 改变。实时运行与 replay 走同一条路径，所以 replay(events) 必须等于实时终态。
// - payload 不含学生原文：只有行号、归类、关键步骤 ID、计数与布尔值。原文只在命令里，不进事件。

export interface Context {
  pkg: ProblemPackage;
  concepts: ConceptsFile;
}

export interface AttemptState {
  start: number;
  layer: number;
  status: Record<number, 'done' | 'skip'>;
  lines: number;
  keyLine: Readonly<Record<string, number>>;
  viaHint: readonly string[];
  def: { attempts: number; passed: boolean; cardOpen: boolean; cardDone: boolean };
  frame: { attempts: number; passed: boolean };
  noProgress: number;
  lastProgressAt: number;
  selfcheck: { items: readonly string[]; answered: readonly string[] };
  summary: { asked: boolean };
  flagged: boolean;
  done: boolean;
  rapidWindowMs: number;
  hint: HintState;
}

export interface EngineEvent {
  type: string;
  at: number;
  payload: Record<string, unknown>;
}

export type Command =
  | { kind: 'def.submit'; lineId: string; text: string }
  | { kind: 'card.open' }
  | { kind: 'card.answer'; choice: number }
  | { kind: 'frame.template' }
  | { kind: 'frame.submit'; lineId: string; text: string }
  | { kind: 'line.submit'; lineId: string; s: string; j: string; provenance: 'ink' | 'keyboard' | 'photo' | 'mixed' | 'paste' }
  | { kind: 'hint.request' }
  | { kind: 'finish.try' }
  | { kind: 'selfcheck.submit'; answers: readonly string[] }
  | { kind: 'transfer.complete' }
  | { kind: 'summary.submit'; answers: readonly string[] }
  | { kind: 'layer.skip'; reason: 'self' | 'pretest' | 'history' | 'teacher_config' }
  | { kind: 'flag.teacher'; flagId: string };

export function createAttempt(ctx: Context, start: number): AttemptState {
  return {
    start,
    layer: 1,
    status: {},
    lines: 0,
    keyLine: {},
    viaHint: [],
    def: { attempts: 0, passed: false, cardOpen: false, cardDone: false },
    frame: { attempts: 0, passed: false },
    noProgress: 0,
    lastProgressAt: start,
    selfcheck: { items: [], answered: [] },
    summary: { asked: false },
    flagged: false,
    done: false,
    rapidWindowMs: (ctx.pkg.public.budget.rapidWindowSec ?? 30) * 1000,
    hint: initialHintState(),
  };
}

// 事件 → 状态。只做状态变化，不做判断；判断都在 decide 里完成后写进事件。
export function apply(state: AttemptState, event: EngineEvent): AttemptState {
  const p = event.payload;
  switch (event.type) {
    case 'def.submit':
      return { ...state, def: { ...state.def, attempts: state.def.attempts + 1, passed: p.pass === true } };
    case 'lesson.open':
      return { ...state, def: { ...state.def, cardOpen: true } };
    case 'lesson.check':
      return p.correct === true
        ? { ...state, def: { ...state.def, cardOpen: false, cardDone: true } }
        : state;
    case 'frame.template':
      return state;
    case 'frame.submit':
      return { ...state, frame: { attempts: state.frame.attempts + 1, passed: p.pass === true } };
    case 'line.submit': {
      const newKeys = p.newKeys as string[];
      const matched = new Set([...state.hint.matched, ...newKeys]);
      const keyLine = { ...state.keyLine };
      for (const k of newKeys) keyLine[k] ??= state.lines + 1;
      const progressed = newKeys.length > 0;
      return {
        ...state,
        lines: state.lines + 1,
        keyLine,
        noProgress: progressed ? 0 : state.noProgress + 1,
        lastProgressAt: progressed ? event.at : state.lastProgressAt,
        hint: { ...state.hint, matched, submitsSinceHint: state.hint.submitsSinceHint + 1 },
      };
    }
    case 'selfcheck.assign':
      return { ...state, selfcheck: { items: (p.items as { id: string }[]).map((x) => x.id), answered: [] } };
    case 'selfcheck.submit':
      return {
        ...state,
        selfcheck: { ...state.selfcheck, answered: [...state.selfcheck.answered, p.itemId as string] },
      };
    case 'finish.try':
      return state;
    case 'hint.deliver': {
      const key = p.key as string;
      const level = p.level as string;
      const cost = p.cost as number;
      const lv = state.hint.hintLv[key] ?? 0;
      return {
        ...state,
        viaHint: level === 'H4' && !state.viaHint.includes(key) ? [...state.viaHint, key] : state.viaHint,
        hint: {
          ...pushHintTime(state, event.at),
          hintLv: { ...state.hint.hintLv, [key]: lv + 1 },
          keyCost: cost > 0 ? { ...state.hint.keyCost, [key]: Math.max(state.hint.keyCost[key] ?? 0, cost) } : state.hint.keyCost,
          reveal: p.revealAfter as number,
          lastHintAt: event.at,
          submitsSinceHint: 0,
        },
      };
    }
    case 'hint.deny':
      // 布局类拒绝（layer）与锁内拒绝（rapid_lock，blocked）在 v3 里没有进入计时，不记入快速窗口。
      if (p.reason === 'layer' || p.reason === 'rapid_lock') return state;
      return { ...state, hint: pushHintTime(state, event.at) };
    case 'hint.rapid_lock':
      return {
        ...state,
        hint: { ...pushHintTime(state, event.at), blockedUntil: Date.parse(p.until as string) },
      };
    case 'budget.exhausted':
      return { ...state, hint: { ...pushHintTime(state, event.at), exhausted: true } };
    case 'gate.block':
      return { ...state, hint: pushHintTime(state, event.at) };
    case 'layer.done':
    case 'layer.skip': {
      const n = Number((p.layer as string).slice(1));
      return {
        ...state,
        status: { ...state.status, [n]: event.type === 'layer.skip' ? 'skip' : 'done' },
        layer: Math.min(6, n + 1),
      };
    }
    case 'help.flag_teacher':
      return { ...state, flagged: true };
    case 'summary.submit':
      return { ...state, summary: { asked: state.summary.asked || p.followupAsked === true } };
    case 'attempt.complete':
      return { ...state, done: true, status: { ...state.status, 6: 'done' } };
    case 'proactive.offer':
      return state;
    default:
      throw new Error(`apply：未知事件 ${event.type}`);
  }
}

// 与 selectHint 的入队规则一致：通过"锁"检查的请求都记入快速窗口，窗口外的时间戳丢弃。
function pushHintTime(state: AttemptState, at: number): HintState {
  const times = [...state.hint.hintTimes.filter((t) => at - t < state.rapidWindowMs), at];
  return { ...state.hint, hintTimes: times };
}

export function replay(initial: AttemptState, events: readonly EngineEvent[]): AttemptState {
  return events.reduce(apply, initial);
}

export interface StepResult {
  state: AttemptState;
  events: EngineEvent[];
}

// 执行一条命令，返回新事件与新状态。命令不合法（层不对、条件不满足）时不产生事件。
export function step(ctx: Context, state: AttemptState, cmd: Command, at: number): StepResult {
  const events: EngineEvent[] = [];
  let current = state;
  const emit = (type: string, payload: Record<string, unknown>) => {
    const event = { type, at, payload };
    events.push(event);
    current = apply(current, event);
  };
  decide(ctx, cmd, at, () => current, emit);
  return { state: current, events };
}

type Emit = (type: string, payload: Record<string, unknown>) => void;

function decide(ctx: Context, cmd: Command, at: number, cur: () => AttemptState, emit: Emit): void {
  const secret = ctx.pkg.secret;
  const st = cur();
  switch (cmd.kind) {
    case 'def.submit': {
      if (st.layer !== 1 || !secret.def) return;
      const c = canon(cmd.text);
      const components = Object.fromEntries(
        secret.def.components.map((x) => [x.id, matchesAny(x.patterns, cmd.text)]),
      );
      const order = secret.def.order ?? [];
      const positions = order.map((id) => firstPosition(secret.def?.components.find((x) => x.id === id)?.patterns ?? [], c));
      const orderOk = positions.every((pos, i) => pos >= 0 && (i === 0 || positions[i - 1] < pos));
      const pass = Object.values(components).every(Boolean) && orderOk;
      emit('def.submit', { lineId: cmd.lineId, n: st.def.attempts + 1, components, orderOk, pass, path: 'rule' });
      if (pass) emit('layer.done', { layer: 'L1' });
      return;
    }
    case 'card.open': {
      if (st.layer !== 1 || !secret.def) return;
      emit('lesson.open', { conceptId: ctx.pkg.public.def?.conceptId ?? '', trigger: 'card' });
      return;
    }
    case 'card.answer': {
      if (!st.def.cardOpen) return;
      const conceptId = ctx.pkg.public.def?.conceptId ?? '';
      const answer = boundaryAnswer(ctx, conceptId);
      emit('lesson.check', { conceptId, stepId: 'boundary', choice: cmd.choice, correct: cmd.choice === answer });
      return;
    }
    case 'frame.template':
      if (st.layer !== 2) return;
      emit('frame.template', {});
      return;
    case 'frame.submit': {
      if (st.layer !== 2 || !secret.frame) return;
      const missing = secret.frame.checks.filter((x) => !matchesAny(x.patterns, cmd.text)).map((x) => x.id);
      const pass = missing.length === 0;
      emit('frame.submit', { lineId: cmd.lineId, n: st.frame.attempts + 1, missing, pass, path: 'rule' });
      if (pass) emit('layer.done', { layer: 'L2' });
      return;
    }
    case 'line.submit': {
      if (st.layer !== 3 || cmd.s.trim().length < 2) return;
      const hasJust = cmd.j.trim() !== '';
      const r = classifyLine(secret, `${cmd.s}　${cmd.j}`);
      const n = st.lines + 1;
      let cls: string;
      let keys: string[] = [];
      let newKeys: string[] = [];
      const payload: Record<string, unknown> = { lineId: cmd.lineId, n, provenance: cmd.provenance, path: 'rule', hasJust };
      if (r.type === 'err') {
        cls = 'error';
        payload.errorId = r.errorId;
      } else if (r.type === 'match') {
        keys = r.keys;
        // 用过提示才写出的步骤，没有依据（少于 6 个字）就不计入：标为示范行，等学生补依据。
        const fromDemo = keys.some((k) => st.viaHint.includes(k) && !st.hint.matched.has(k));
        if (fromDemo && cmd.j.length < 6) {
          cls = 'demo_needs_reason';
        } else {
          cls = 'match';
          newKeys = keys.filter((k) => !st.hint.matched.has(k));
        }
      } else {
        cls = 'unknown';
      }
      emit('line.submit', { ...payload, cls, keys, newKeys });
      const after = cur();
      const stuckMs = at - after.lastProgressAt;
      const stuckLimit = ctx.pkg.public.budget.stuckMs ?? 180000;
      if (after.noProgress >= 2 && stuckMs > stuckLimit) {
        emit('proactive.offer', { stuckMs, noProgress: after.noProgress });
      }
      return;
    }
    case 'hint.request':
      requestHint(ctx, at, st, emit);
      return;
    case 'finish.try': {
      if (st.layer !== 3) return;
      const complete = nextKey(secret, st.hint.matched) === null;
      emit('finish.try', { complete });
      if (!complete) return;
      emit('layer.done', { layer: 'L3' });
      const items = pickSelfcheck(secret).map((id) => {
        const bank = secret.selfcheckBank.find((q) => q.id === id);
        const ref = /\{line:(K\d+)\}/.exec(bank?.template ?? '');
        const line = ref ? cur().keyLine[ref[1]] : undefined;
        return line === undefined ? { id } : { id, line };
      });
      emit('selfcheck.assign', { items });
      return;
    }
    case 'selfcheck.submit': {
      if (st.layer !== 4) return;
      // 三题都写满（每题至少 4 个字）且全部通过，才完成第 4 层；未写满的题只记录已写的那几题。
      let complete = true;
      for (const [i, id] of st.selfcheck.items.entries()) {
        const answer = (cmd.answers[i] ?? '').trim();
        if (answer.length < 4) {
          complete = false;
          continue;
        }
        const item = secret.selfcheckBank.find((q) => q.id === id);
        if (!item) throw new Error(`自检题 ${id} 不在题目包中`);
        const { valid, refs } = checkSelfcheck(item, answer, st.lines);
        complete = complete && valid;
        emit('selfcheck.submit', { itemId: id, refs, valid, path: 'rule' });
      }
      if (complete) emit('layer.done', { layer: 'L4' });
      return;
    }
    case 'transfer.complete':
      if (st.layer !== 5) return;
      emit('layer.done', { layer: 'L5' });
      return;
    case 'summary.submit': {
      if (st.layer !== 6 || cmd.answers.some((a) => a.trim().length < 4)) return;
      const text = cmd.answers.join(' ');
      const missing = secret.summaryPoints.filter((p) => !matchesAny(p.patterns, text)).map((p) => p.id);
      const followupAsked = missing.length > 0 && !st.summary.asked;
      const pass = !followupAsked;
      emit('summary.submit', { missing, followupAsked, pass });
      if (!pass) return;
      const keysTotal = secret.keys.length;
      const reveal = st.hint.reveal;
      emit('attempt.complete', {
        reveal,
        independence: Math.max(0, 1 - reveal / keysTotal),
        keysOwn: st.hint.matched.size,
        keysTotal,
        durationMs: at - st.start,
      });
      return;
    }
    case 'layer.skip': {
      const cfg = ctx.pkg.public.layers[`L${st.layer}` as 'L1'];
      if (!cfg?.skippable || st.status[st.layer]) return;
      emit('layer.skip', { layer: `L${st.layer}`, reason: cmd.reason });
      return;
    }
    case 'flag.teacher':
      if (!st.hint.exhausted || st.flagged) return;
      emit('help.flag_teacher', { flagId: cmd.flagId, layer: `L${st.layer}` });
      return;
  }
}

function requestHint(ctx: Context, at: number, st: AttemptState, emit: Emit): void {
  if (st.layer !== 3) {
    emit('hint.deny', { reason: 'layer' });
    return;
  }
  const { decision } = selectHint(ctx.pkg.secret, ctx.pkg.public.budget, st.hint, at);
  switch (decision.type) {
    case 'blocked':
      emit('hint.deny', { reason: 'rapid_lock', waitSec: decision.waitSec });
      return;
    case 'rapid_lock':
      emit('hint.rapid_lock', { until: new Date(at + decision.waitSec * 1000).toISOString() });
      return;
    case 'needs_submit':
      emit('hint.deny', { reason: 'need_attempt' });
      return;
    case 'dwell':
      emit('hint.deny', { reason: 'dwell', waitSec: decision.waitSec });
      return;
    case 'complete':
      emit('hint.deny', { reason: 'complete' });
      return;
    case 'budget_exhausted':
      emit('budget.exhausted', { key: decision.key });
      return;
    case 'deliver': {
      // 外发前过闸门：提示文本含未允许的泄题片段时拦下，不下发、不计透露量（09 §7.2）。
      const gate = gateRule(ctx.pkg.secret, decision.text, st.hint.matched, hintAllow(decision.key, decision.cost));
      if (!gate.ok) {
        emit('gate.block', { channel: 'hint', stage: 'rule', fallback: 'H0', keys: gate.hits.map((h) => h.key) });
        return;
      }
      emit('hint.deliver', {
        hintId: `${decision.key}.${decision.level}`,
        key: decision.key,
        level: decision.level,
        cost: decision.cost,
        revealDelta: decision.revealDelta,
        revealAfter: decision.revealAfter,
      });
      return;
    }
  }
}

// 自检题的抽取（01-产品总规格 L4）：依据、作用、逻辑地位或条件各一题；题库顺序中取第一题。确定性，便于回放。
export function pickSelfcheck(secret: Secret): string[] {
  const first = (dimensions: string[]) => secret.selfcheckBank.find((q) => dimensions.includes(q.dimension))?.id;
  return [first(['justification']), first(['meaning']), first(['logical_status', 'condition'])].filter(
    (id): id is string => id !== undefined,
  );
}

// 自检题的规则判定（只看规则层；jev 类需要模型，P0 只检查长度）。
function checkSelfcheck(
  item: Secret['selfcheckBank'][number],
  answer: string,
  lines: number,
): { valid: boolean; refs: number[] } {
  const refs = [...answer.matchAll(/\d+/g)].map((m) => Number(m[0]));
  switch (item.check.type) {
    case 'lineRefs':
      return { valid: refs.length > 0 && refs.every((r) => r >= 1 && r <= lines), refs };
    case 'mentions':
      return { valid: (item.check.patterns ?? []).some((p) => matchesAny([p], answer)), refs };
    default:
      return { valid: true, refs };
  }
}

function firstPosition(patterns: readonly string[], text: string): number {
  const found = patterns
    .map((p) => new RegExp(p, 'u').exec(text)?.index ?? -1)
    .filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}

function boundaryAnswer(ctx: Context, conceptId: string): number | null {
  const concept = ctx.concepts.concepts.find((c) => c.id === conceptId) as
    | { card?: { boundary?: { answer?: number } } }
    | undefined;
  return concept?.card?.boundary?.answer ?? null;
}
