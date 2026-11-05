import { createHash } from 'node:crypto';

import { type AttemptState, type HelpPreview, helpPreview, independenceOf, type SerializedAttemptState } from '@proof-gym/engine';

import type { LoadedProblem } from './problem.ts';

// app.attempts 的一行（只列服务端用到的列）。用 type 而非 interface：Queryable.query 要求 Record<string, unknown>。
export type AttemptRow = {
  id: string;
  assignment_id: string;
  user_id: string;
  problem_id: string;
  problem_version: number;
  kind: 'main' | 'transfer';
  parent_attempt_id: string | null;
  mode: 'practice' | 'test';
  status: 'active' | 'parked' | 'locked' | 'completed' | 'abandoned';
  state: SerializedAttemptState;
  state_version: number;
  keys_total: number;
  last_event_seq: number | string;
};

export interface Snapshot {
  row: AttemptRow;
  state: AttemptState;
  problem: LoadedProblem;
  now: number;
}

const LAYER_TITLES = ['定义', '骨架', '写证明', '自检', '迁移', '总结'];

// 学生端唯一的状态来源（AttemptState，05 §4）。只输出 openapi 列出的字段：不含题目的 secret、
// 不含引擎的内部计数，也不含学生原文（原文只在 app.attempt_lines 里）。
export function toAttemptState({ row, state, problem, now }: Snapshot): Record<string, unknown> {
  const { pkg } = problem.ctx;
  const keysTotal = pkg.secret.keys.length;
  const pub = problem.public;
  const help = helpPreview(problem.ctx, state, now);
  const dto: Record<string, unknown> = {
    attemptId: row.id,
    parentAttemptId: row.parent_attempt_id,
    stateVersion: row.state_version,
    kind: row.kind,
    status: row.status,
    mode: row.mode,
    problem: problemView(row, problem),
    currentLayer: `L${state.layer}`,
    layers: [1, 2, 3, 4, 5, 6].map((n) => layerView(n, state, problem)),
    budget: {
      revealUsed: state.hint.reveal,
      revealMax: pub.budget.reveal,
      keysOwn: state.hint.matched.size,
      keysTotal,
    },
    def: { conceptId: pub.def?.conceptId ?? '', submissions: state.def.attempts, lessonSuggested: false },
    notes: overrideNotes(row, state, problem),
    help: helpView(help),
    integrity: { mode: row.mode, locked: row.status === 'locked' },
    serverTime: new Date(now).toISOString(),
  };
  if (state.selfcheck.items.length > 0) dto.selfcheck = selfcheckView(state, problem);
  if (state.done) {
    dto.completion = {
      done: true,
      independence: independenceOf(state, keysTotal),
      reviewAvailable: false,
      leanCard: null,
    };
  }
  return dto;
}

// 教师补发的 H4（软着陆）以批注形式下发：由引擎状态 overrides 推出，不另存，所以刷新/重连后仍在，回放一致。
// 文本是题目包里该步骤的 H4 提示，补发时已过闸门（H4 放行本步骤片段）。noteId 由作答与步骤确定，便于前端去重/关闭。
function overrideNotes(row: AttemptRow, state: AttemptState, problem: LoadedProblem): Record<string, unknown>[] {
  return (state.overrides ?? []).flatMap((keyId) => {
    const hint = problem.ctx.pkg.secret.keys.find((k) => k.id === keyId)?.hints.find((h) => h.level === 'H4');
    if (!hint) return [];
    const h = createHash('sha256').update(`${row.id}:override:${keyId}`).digest('hex');
    const noteId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    return [
      {
        noteId,
        kind: 'hint',
        who: 'H4 · 老师补发',
        text: hint.text,
        lineId: null,
        level: 'H4',
        cost: 0,
        lessonConceptId: null,
        at: new Date(state.overrideAt?.[keyId] ?? Date.now()).toISOString(),
      },
    ];
  });
}

function problemView(row: AttemptRow, problem: LoadedProblem): Record<string, unknown> {
  const p = problem.public;
  const view: Record<string, unknown> = {
    problemId: row.problem_id,
    version: row.problem_version,
    title: p.title ?? row.problem_id,
    stem: p.stem,
    chapter: p.chapter ?? '',
    keyCount: p.keyCount ?? problem.ctx.pkg.secret.keys.length,
  };
  // 显示用来源（如 "华东师大版同步辅导 · 第二章 · 例 4"）；题库里 source 是结构化对象，这里只取展示用的文字。
  const sourceText = [p.source?.book, p.chapter].filter((s): s is string => Boolean(s)).join(' · ');
  if (sourceText !== '') view.source = sourceText;
  if (p.askChips !== undefined) view.askChips = p.askChips;
  return view;
}

function layerView(n: number, state: AttemptState, problem: LoadedProblem): Record<string, unknown> {
  const cfg = problem.public.layers[`L${n}` as 'L1'];
  const engine = state.status[n];
  const status = !cfg.enabled || engine === 'disabled'
    ? 'disabled'
    : engine === 'done'
      ? 'done'
      : engine === 'skip'
        ? 'skipped'
        : n === state.layer
          ? 'active'
          : 'locked';
  return {
    layer: `L${n}`,
    title: LAYER_TITLES[n - 1],
    status,
    enabled: cfg.enabled,
    skippable: cfg.skippable ?? false,
  };
}

function selfcheckView(state: AttemptState, problem: LoadedProblem): Record<string, unknown> {
  return {
    items: state.selfcheck.items.map((itemId) => {
      const item = problem.ctx.pkg.secret.selfcheckBank.find((q) => q.id === itemId);
      const passed = state.selfcheck.passed[itemId];
      return {
        itemId,
        question: (item?.template ?? '').replace(/\{line:(K\d+)\}/g, (_, key: string) => {
          const line = state.keyLine[key];
          return line === undefined ? '（写出该步骤后显示行号）' : `第 ${line} 行`;
        }),
        status: passed === undefined ? 'open' : passed ? 'accepted' : 'followup',
      };
    }),
  };
}

function helpView(help: HelpPreview): Record<string, unknown> {
  return {
    hintAvailable: help.hintAvailable,
    nextLevel: help.nextLevel,
    nextCost: help.nextCost,
    waitSec: help.waitSec,
    needAttempt: help.needAttempt,
    rapidLockUntil: help.rapidLockUntil === null ? null : new Date(help.rapidLockUntil).toISOString(),
    exhausted: help.exhausted,
    flagged: help.flagged,
    stuckOffer: help.stuckOffer,
  };
}
