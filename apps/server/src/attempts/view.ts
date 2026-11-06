import { createHash } from 'node:crypto';

import {
  type AttemptState,
  gateRule,
  type HelpPreview,
  helpPreview,
  independenceOf,
  nextKey,
  type SerializedAttemptState,
} from '@proof-gym/engine';

import type { ViewExtras } from './extras.ts';
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
  extras: ViewExtras;
}

// 总结五问（01 §L6 原文）。题目包里没有这一项，所有题共用。
export const SUMMARY_QUESTIONS = [
  '这个证明证了什么？',
  '分几块？块与块之间是什么关系？',
  '哪个选择决定了成败？',
  '写到哪一步才算证完？',
  '哪个做法下次还能用、哪个只适用于本题？',
];

const LAYER_TITLES = ['定义', '骨架', '写证明', '自检', '迁移', '总结'];

// 学生端唯一的状态来源（AttemptState，05 §4）。只输出 openapi 列出的字段：不含题目的 secret、
// 不含引擎的内部计数，也不含服务端对行的判断（cls / keys / errorId）。学生自己写的行原文要回显（StepsView、DefView.last 等）。
export function toAttemptState({ row, state, problem, now, extras }: Snapshot): Record<string, unknown> {
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
    def: {
      ...(pub.def?.task === undefined ? {} : { task: pub.def.task }),
      conceptId: pub.def?.conceptId ?? '',
      submissions: state.def.attempts,
      ...(extras.defLast === null ? {} : { last: extras.defLast }),
      lessonSuggested: false,
      lessonAvailable: lessonAvailable(problem),
    },
    notes: overrideNotes(row, state, problem),
    help: helpView(help),
    integrity: { mode: row.mode, locked: row.status === 'locked' },
    serverTime: new Date(now).toISOString(),
  };
  if (pub.frame) {
    dto.frame = {
      task: pub.frame.task,
      ...(pub.frame.lessonId === undefined ? {} : { lessonId: pub.frame.lessonId }),
      ...(extras.frameLast === null ? {} : { last: extras.frameLast }),
      templateShown: extras.templateShown,
      template: extras.templateShown ? (pub.frame.template ?? null) : null,
    };
  }
  dto.steps = {
    lines: extras.lines.map((l) => ({
      lineId: l.lineId,
      n: l.n,
      statement: l.statement,
      ...(l.justification === null ? {} : { justification: l.justification }),
      provenance: l.provenance,
      flagged: l.flagged,
      createdAt: l.createdAt,
    })),
    // 与引擎 finish.try 同一判据：本题路线上的关键步骤都已写出。
    canFinish: state.layer === 3 && nextKey(problem.ctx.pkg.secret, state.hint.matched) === null,
  };
  if (state.selfcheck.items.length > 0) dto.selfcheck = selfcheckView(state, problem);
  if (pub.transferProblemId !== undefined) dto.transfer = transferView(state, extras);
  if (state.layer === 6 || state.done) dto.summary = summaryView(state, problem, extras);
  if (state.done) {
    dto.completion = {
      done: true,
      independence: independenceOf(state, keysTotal),
      reviewAvailable: extras.reviewAvailable,
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

// 概念缺失或没有微课步骤时隐藏微课入口（GET /lesson 对缺失概念是 404）。
function lessonAvailable(problem: LoadedProblem): boolean {
  const conceptId = problem.public.def?.conceptId;
  if (!conceptId) return false;
  const concept = problem.ctx.concepts.concepts.find((c) => c.id === conceptId) as { lesson?: { steps?: unknown[] } } | undefined;
  return Array.isArray(concept?.lesson?.steps) && concept.lesson.steps.length > 0;
}

function transferView(state: AttemptState, extras: ViewExtras): Record<string, unknown> {
  const done = state.status[5];
  const status = done === 'skip' ? 'skipped' : done === 'done' ? 'completed' : extras.transfer ? 'active' : 'not_started';
  return {
    childAttemptId: extras.transfer?.childAttemptId ?? null,
    ...(extras.transfer?.stem ? { stem: extras.transfer.stem } : {}),
    status,
  };
}

// 总结五问 + 已交的回答；第一次缺要点时给追问（取缺的第一个要点预写的追问，过闸门，被拦就不给）。
function summaryView(state: AttemptState, problem: LoadedProblem, extras: ViewExtras): Record<string, unknown> {
  const secret = problem.ctx.pkg.secret;
  const missing = extras.summaryMissing ?? [];
  const point = state.summary.asked && !state.done ? secret.summaryPoints.find((p) => missing.includes(p.id)) : undefined;
  const followup = point !== undefined && gateRule(secret, point.question, new Set(state.hint.matched), []).ok ? point.question : null;
  return { questions: SUMMARY_QUESTIONS, answers: extras.summaryAnswers, followup };
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
