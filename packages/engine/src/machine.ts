import { canon, matchesAny } from './canon.ts';
import { classifyLine, nextKey } from './classify.ts';
import { gateRule, hintAllow } from './gate.ts';
import { type HintState, initialHintState, selectHint } from './hint.ts';
import type { ConceptsFile } from './leak.ts';
import type { HintLevel, ProblemPackage, Secret } from './types.ts';

// 作答状态机（09 §6、05 §4）。
// - 命令（学生输入）经 step 产生事件；事件是事实，只带 at（毫秒，由调用方的时钟给出）和 payload。
// - 状态只由 apply 改变。实时运行与 replay 走同一条路径，所以 replay(events) 必须等于实时终态。
// - payload 不含学生原文：只有行号、归类、关键步骤 ID、计数与布尔值。原文只在命令里，不进事件。
// - 层的路径由题目包的 public.layers 决定：禁用的层直接跳过（迁移题只启用第 3 层）。

export interface Context {
  pkg: ProblemPackage;
  concepts: ConceptsFile;
}

export type LayerNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface AttemptState {
  start: number;
  layer: number;
  status: Record<number, 'done' | 'skip' | 'disabled'>;
  lines: number;
  keyLine: Readonly<Record<string, number>>;
  viaHint: readonly string[];
  def: { attempts: number; passed: boolean; cardOpen: boolean; cardDone: boolean };
  frame: { attempts: number; passed: boolean };
  noProgress: number;
  lastProgressAt: number;
  selfcheck: { items: readonly string[]; passed: Readonly<Record<string, boolean>> };
  summary: { asked: boolean };
  flagged: boolean;
  done: boolean;
  rapidWindowMs: number;
  hint: HintState;
  // 教师在额度耗尽后补发过 H4 的关键步骤（05 §4：不增加 reveal，但本题不计入"独立"）。旧版本存的状态没有这两个字段。
  overrides?: readonly string[];
  overrideAt?: Readonly<Record<string, number>>;
}

export interface EngineEvent {
  type: string;
  at: number;
  payload: Record<string, unknown>;
}

export type Rejection = 'wrong_layer' | 'invalid' | 'not_allowed' | 'unknown_item';

export type Command =
  | { kind: 'def.submit'; lineId: string; text: string }
  | { kind: 'card.open' }
  | { kind: 'card.answer'; choice: number }
  | { kind: 'frame.template' }
  | { kind: 'frame.submit'; lineId: string; text: string }
  | { kind: 'line.submit'; lineId: string; s: string; j: string; provenance: 'ink' | 'keyboard' | 'photo' | 'mixed' | 'paste' }
  | { kind: 'hint.request' }
  // 教师补发一次 H4（额度耗尽的唯一出口，05 §4）。key 缺省取下一个未完成的关键步骤。
  | { kind: 'teacher.grant_h4'; key?: string }
  | { kind: 'finish.try' }
  | { kind: 'selfcheck.item'; itemId: string; answer: string }
  | { kind: 'selfcheck.submit'; answers: readonly string[] }
  | { kind: 'transfer.complete' }
  | { kind: 'summary.submit'; answers: readonly string[] }
  | { kind: 'layer.skip'; reason: 'self' | 'pretest' | 'history' | 'teacher_config' }
  | { kind: 'flag.teacher'; flagId: string };

const enabledLayer = (ctx: Context, n: number): boolean => ctx.pkg.public.layers[`L${n}` as 'L1'].enabled;

// 下一个启用的层；没有了则为 null（此时作答完成）。
function nextEnabled(ctx: Context, from: number): number | null {
  for (let n = from + 1; n <= 6; n += 1) if (enabledLayer(ctx, n)) return n;
  return null;
}

export function createAttempt(ctx: Context, start: number): AttemptState {
  const status: Record<number, 'disabled'> = {};
  for (let n = 1; n <= 6; n += 1) if (!enabledLayer(ctx, n)) status[n] = 'disabled';
  const first = [1, 2, 3, 4, 5, 6].find((n) => enabledLayer(ctx, n)) ?? 3;
  return {
    start,
    layer: first,
    status,
    lines: 0,
    keyLine: {},
    viaHint: [],
    def: { attempts: 0, passed: false, cardOpen: false, cardDone: false },
    frame: { attempts: 0, passed: false },
    noProgress: 0,
    lastProgressAt: start,
    selfcheck: { items: [], passed: {} },
    summary: { asked: false },
    flagged: false,
    done: false,
    rapidWindowMs: (ctx.pkg.public.budget.rapidWindowSec ?? 30) * 1000,
    hint: initialHintState(),
  };
}

// 驱动引擎状态的事件类型，与下面 apply 的 case 一一对应。重放只取这些类型：
// 服务端的其它事件（attempt.start/park/lock/unlock、integ.*）和客户端观察事件不驱动状态。
// 白名单而不是黑名单：新增服务端事件时，默认不会被当成引擎事件而让重放抛错。
export const ENGINE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'def.submit',
  'lesson.open',
  'lesson.check',
  'frame.template',
  'frame.submit',
  'line.submit',
  'selfcheck.assign',
  'selfcheck.submit',
  'finish.try',
  'hint.deliver',
  'hint.deny',
  'hint.rapid_lock',
  'budget.exhausted',
  'gate.block',
  'layer.done',
  'layer.skip',
  'help.flag_teacher',
  'summary.submit',
  'attempt.complete',
  'proactive.offer',
]);

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
      return { ...state, selfcheck: { items: (p.items as { id: string }[]).map((x) => x.id), passed: {} } };
    case 'selfcheck.submit':
      return {
        ...state,
        selfcheck: { ...state.selfcheck, passed: { ...state.selfcheck.passed, [p.itemId as string]: p.valid === true } },
      };
    case 'finish.try':
      return state;
    case 'hint.deliver': {
      const key = p.key as string;
      const level = p.level as string;
      const cost = p.cost as number;
      const lv = state.hint.hintLv[key] ?? 0;
      if (p.override === true) {
        // 教师补发：不改 reveal，不进学生的求助计时（快速窗口、停留、"先写一行"门槛都不受影响）。
        // 学生要补 ≥6 字依据，该步才计入（见 line.submit 的 demo_needs_reason）。
        return {
          ...state,
          viaHint: level === 'H4' && !state.viaHint.includes(key) ? [...state.viaHint, key] : state.viaHint,
          overrides: (state.overrides ?? []).includes(key) ? state.overrides : [...(state.overrides ?? []), key],
          overrideAt: { ...(state.overrideAt ?? {}), [key]: event.at },
          hint: {
            ...state.hint,
            hintLv: { ...state.hint.hintLv, [key]: lv + 1 },
            keyCost: cost > 0 ? { ...state.hint.keyCost, [key]: Math.max(state.hint.keyCost[key] ?? 0, cost) } : state.hint.keyCost,
          },
        };
      }
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
      const next = p.next as number | null;
      return {
        ...state,
        status: { ...state.status, [n]: event.type === 'layer.skip' ? 'skip' : 'done' },
        layer: next ?? state.layer,
      };
    }
    case 'help.flag_teacher':
      return { ...state, flagged: true };
    case 'summary.submit':
      return { ...state, summary: { asked: state.summary.asked || p.followupAsked === true } };
    case 'attempt.complete':
      return { ...state, done: true, status: state.layer === 6 ? { ...state.status, 6: 'done' } : state.status };
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
  // 命令被拒绝（层不对、内容不合法、条件不满足）时给出原因；此时 events 为空。
  rejected?: Rejection;
}

// 执行一条命令，返回新事件与新状态。
export function step(ctx: Context, state: AttemptState, cmd: Command, at: number): StepResult {
  const events: EngineEvent[] = [];
  let current = state;
  let rejected: Rejection | undefined;
  const emit = (type: string, payload: Record<string, unknown>) => {
    const event = { type, at, payload };
    events.push(event);
    current = apply(current, event);
  };
  const reject = (reason: Rejection) => {
    rejected ??= reason;
  };
  decide(ctx, cmd, at, () => current, emit, reject);
  return rejected ? { state: current, events, rejected } : { state: current, events };
}

type Emit = (type: string, payload: Record<string, unknown>) => void;
type Reject = (reason: Rejection) => void;

function decide(ctx: Context, cmd: Command, at: number, cur: () => AttemptState, emit: Emit, reject: Reject): void {
  const secret = ctx.pkg.secret;
  const st = cur();
  switch (cmd.kind) {
    case 'def.submit': {
      if (st.layer !== 1) return reject('wrong_layer');
      if (!secret.def) return reject('not_allowed');
      const c = canon(cmd.text);
      const components = Object.fromEntries(
        secret.def.components.map((x) => [x.id, matchesAny(x.patterns, cmd.text)]),
      );
      const order = secret.def.order ?? [];
      const positions = order.map((id) => firstPosition(secret.def?.components.find((x) => x.id === id)?.patterns ?? [], c));
      const orderOk = positions.every((pos, i) => pos >= 0 && (i === 0 || positions[i - 1] < pos));
      const pass = Object.values(components).every(Boolean) && orderOk;
      emit('def.submit', { lineId: cmd.lineId, n: st.def.attempts + 1, components, orderOk, pass, path: 'rule' });
      if (pass) layerDone(ctx, 1, at, cur, emit);
      return;
    }
    case 'card.open': {
      if (st.layer !== 1) return reject('wrong_layer');
      if (!secret.def) return reject('not_allowed');
      emit('lesson.open', { conceptId: ctx.pkg.public.def?.conceptId ?? '', trigger: 'card' });
      return;
    }
    case 'card.answer': {
      if (!st.def.cardOpen) return reject('not_allowed');
      const conceptId = ctx.pkg.public.def?.conceptId ?? '';
      const answer = boundaryAnswer(ctx, conceptId);
      emit('lesson.check', { conceptId, stepId: 'boundary', choice: cmd.choice, correct: cmd.choice === answer });
      return;
    }
    case 'frame.template':
      if (st.layer !== 2) return reject('wrong_layer');
      emit('frame.template', {});
      return;
    case 'frame.submit': {
      if (st.layer !== 2) return reject('wrong_layer');
      if (!secret.frame) return reject('not_allowed');
      const missing = secret.frame.checks.filter((x) => !matchesAny(x.patterns, cmd.text)).map((x) => x.id);
      const pass = missing.length === 0;
      emit('frame.submit', { lineId: cmd.lineId, n: st.frame.attempts + 1, missing, pass, path: 'rule' });
      if (pass) layerDone(ctx, 2, at, cur, emit);
      return;
    }
    case 'line.submit': {
      if (st.layer !== 3) return reject('wrong_layer');
      if (cmd.s.trim().length < 2) return reject('invalid');
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
    case 'teacher.grant_h4':
      grantH4(ctx, cmd.key, st, emit, reject);
      return;
    case 'finish.try': {
      if (st.layer !== 3) return reject('wrong_layer');
      const complete = nextKey(secret, st.hint.matched) === null;
      emit('finish.try', { complete });
      if (!complete) return;
      layerDone(ctx, 3, at, cur, emit);
      if (cur().layer === 4 && cur().selfcheck.items.length === 0) {
        const items = pickSelfcheck(secret).map((id) => {
          const bank = secret.selfcheckBank.find((q) => q.id === id);
          const ref = /\{line:(K\d+)\}/.exec(bank?.template ?? '');
          const line = ref ? cur().keyLine[ref[1]] : undefined;
          return line === undefined ? { id } : { id, line };
        });
        emit('selfcheck.assign', { items });
      }
      return;
    }
    case 'selfcheck.item': {
      if (st.layer !== 4) return reject('wrong_layer');
      if (!st.selfcheck.items.includes(cmd.itemId)) return reject('unknown_item');
      if (cmd.answer.trim().length < selfcheckMinChars(secret, cmd.itemId)) return reject('invalid');
      answerSelfcheck(ctx, cmd.itemId, cmd.answer, at, cur, emit);
      return;
    }
    case 'selfcheck.submit': {
      if (st.layer !== 4) return reject('wrong_layer');
      // 批量提交是原子的：任一题过短则整批拒绝，不写入部分题。
      const answers = st.selfcheck.items.map((id, i) => ({ id, answer: (cmd.answers[i] ?? '').trim() }));
      if (answers.some(({ id, answer }) => answer.length < selfcheckMinChars(secret, id))) return reject('invalid');
      for (const { id, answer } of answers) answerSelfcheck(ctx, id, answer, at, cur, emit);
      return;
    }
    case 'transfer.complete':
      if (st.layer !== 5) return reject('wrong_layer');
      layerDone(ctx, 5, at, cur, emit);
      return;
    case 'summary.submit': {
      if (st.layer !== 6) return reject('wrong_layer');
      if (cmd.answers.some((a) => a.trim().length < 4)) return reject('invalid');
      const text = cmd.answers.join(' ');
      const missing = secret.summaryPoints.filter((p) => !matchesAny(p.patterns, text)).map((p) => p.id);
      const followupAsked = missing.length > 0 && !st.summary.asked;
      const pass = !followupAsked;
      emit('summary.submit', { missing, followupAsked, pass });
      if (pass) completeAttempt(ctx, at, cur, emit);
      return;
    }
    case 'layer.skip': {
      const skippable = ctx.pkg.public.layers[`L${st.layer}` as 'L1']?.skippable === true;
      if (!skippable || st.status[st.layer]) return reject('not_allowed');
      const next = nextEnabled(ctx, st.layer);
      emit('layer.skip', { layer: `L${st.layer}`, reason: cmd.reason, next });
      if (next === null) completeAttempt(ctx, at, cur, emit);
      return;
    }
    case 'flag.teacher':
      if (!st.hint.exhausted || st.flagged) return reject('not_allowed');
      emit('help.flag_teacher', { flagId: cmd.flagId, layer: `L${st.layer}` });
      return;
  }
}

// 第 n 层完成：下一层为启用的下一层；没有下一层则作答完成。
function layerDone(ctx: Context, n: number, at: number, cur: () => AttemptState, emit: Emit): void {
  const next = nextEnabled(ctx, n);
  emit('layer.done', { layer: `L${n}`, next });
  if (next === null) completeAttempt(ctx, at, cur, emit);
}

function completeAttempt(ctx: Context, at: number, cur: () => AttemptState, emit: Emit): void {
  const st = cur();
  const keysTotal = ctx.pkg.secret.keys.length;
  const reveal = st.hint.reveal;
  const overrides = st.overrides ?? [];
  emit('attempt.complete', {
    reveal,
    independence: independenceOf(st, keysTotal),
    keysOwn: st.hint.matched.size,
    keysTotal,
    durationMs: at - st.start,
    ...(overrides.length > 0 ? { teacherOverrides: [...overrides] } : {}),
  });
}

// 独立度 = 1 − 透露量 / 关键步骤数（08 §4）。教师补发的 H4 不增加 reveal，但每条按透露 1 计入，
// 所以含教师补发的作答不会被算成"独立完成"（01 §4）。
export function independenceOf(st: AttemptState, keysTotal: number): number {
  const effective = st.hint.reveal + (st.overrides ?? []).length;
  return Math.max(0, 1 - effective / keysTotal);
}

// 按题作答自检题：写满的题计入（valid 由规则层判定）；三题全部通过则第 4 层完成。
function answerSelfcheck(ctx: Context, itemId: string, answer: string, at: number, cur: () => AttemptState, emit: Emit): void {
  const item = ctx.pkg.secret.selfcheckBank.find((q) => q.id === itemId);
  if (!item) throw new Error(`自检题 ${itemId} 不在题目包中`);
  const { valid, refs } = checkSelfcheck(item, answer, cur().lines);
  emit('selfcheck.submit', { itemId, refs, valid, path: 'rule' });
  const st = cur();
  if (st.layer === 4 && st.selfcheck.items.every((id) => st.selfcheck.passed[id] === true)) {
    layerDone(ctx, 4, at, cur, emit);
  }
}

// 自检题的最少字数：题库给出（check.minChars），缺省 4。
function selfcheckMinChars(secret: Secret, itemId: string): number {
  return secret.selfcheckBank.find((q) => q.id === itemId)?.check.minChars ?? 4;
}

// 教师补发 H4（05 §4、12 §7 软着陆）：只在额度耗尽后；文本照常过闸门（H4 放行本步骤片段）；
// revealDelta=0、override=true，所以不改 reveal；回放同一条 hint.deliver 事件即可重建。
function grantH4(ctx: Context, keyId: string | undefined, st: AttemptState, emit: Emit, reject: Reject): void {
  if (!st.hint.exhausted) return reject('not_allowed');
  if (st.layer !== 3) return reject('wrong_layer');
  const secret = ctx.pkg.secret;
  const key = keyId === undefined ? nextKey(secret, st.hint.matched) : secret.keys.find((k) => k.id === keyId);
  if (!key || st.hint.matched.has(key.id) || (st.overrides ?? []).includes(key.id)) return reject('invalid');
  const hint = key.hints.find((h) => h.level === 'H4');
  if (!hint) return reject('invalid');
  const gate = gateRule(secret, hint.text, st.hint.matched, hintAllow(key.id, hint.cost));
  if (!gate.ok) {
    emit('gate.block', { channel: 'hint', stage: 'rule', fallback: 'H0', keys: gate.hits.map((h) => h.key) });
    return;
  }
  emit('hint.deliver', {
    hintId: `${key.id}.${hint.level}`,
    key: key.id,
    level: hint.level,
    cost: hint.cost,
    revealDelta: 0,
    revealAfter: st.hint.reveal,
    override: true,
  });
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

// 只读的提示预览（GET 用）：读状态与时间，不计入快速窗口，不改状态。
export interface HelpPreview {
  hintAvailable: boolean;
  nextLevel: HintLevel | null;
  nextCost: number | null;
  waitSec: number | null;
  needAttempt: boolean;
  rapidLockUntil: number | null;
  exhausted: boolean;
  flagged: boolean;
  stuckOffer: boolean;
}

export function helpPreview(ctx: Context, state: AttemptState, now: number): HelpPreview {
  const policy = ctx.pkg.public.budget;
  const dwellMs = (policy.dwellSec ?? 20) * 1000;
  const stuckMs = policy.stuckMs ?? 180000;
  const key = state.layer === 3 ? nextKey(ctx.pkg.secret, state.hint.matched) : null;
  const lv = key ? (state.hint.hintLv[key.id] ?? 0) : 0;
  const hint = key ? key.hints[Math.min(lv, 4)] : null;
  const locked = state.hint.blockedUntil !== null && now < state.hint.blockedUntil;
  let waitSec: number | null = null;
  if (locked && state.hint.blockedUntil !== null) {
    waitSec = Math.ceil((state.hint.blockedUntil - now) / 1000);
  } else if (hint && hint.cost > 0 && state.hint.lastHintAt !== null && now - state.hint.lastHintAt < dwellMs) {
    waitSec = Math.ceil((dwellMs - (now - state.hint.lastHintAt)) / 1000);
  }
  return {
    hintAvailable: state.layer === 3,
    nextLevel: hint ? hint.level : null,
    nextCost: hint ? Math.max(0, hint.cost - (state.hint.keyCost[key?.id ?? ''] ?? 0)) : null,
    waitSec,
    needAttempt: hint !== null && hint.cost > 0 && state.hint.submitsSinceHint < 1,
    rapidLockUntil: locked ? state.hint.blockedUntil : null,
    exhausted: state.hint.exhausted,
    flagged: state.flagged,
    stuckOffer: state.noProgress >= 2 && now - state.lastProgressAt > stuckMs,
  };
}

// 状态的 JSON 形式：hint.matched 的 Set 变成数组。服务端把它存进 app.attempts.state。
export interface SerializedAttemptState extends Omit<AttemptState, 'hint'> {
  hint: Omit<HintState, 'matched'> & { matched: string[] };
}

export function serializeState(state: AttemptState): SerializedAttemptState {
  return { ...state, hint: { ...state.hint, matched: [...state.hint.matched] } };
}

export function deserializeState(json: SerializedAttemptState): AttemptState {
  return { ...json, hint: { ...json.hint, matched: new Set(json.hint.matched) } };
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

