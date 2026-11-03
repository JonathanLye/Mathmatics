import type { components } from '@proof-gym/contracts/gen/api.ts';

// 前端类型一律来自契约生成物（06 §7），不手写第二份 DTO。
export type Me = components['schemas']['Me'];
export type ClassSummary = components['schemas']['ClassSummary'];
export type ClassSettings = components['schemas']['ClassSettings'];
export type AssignmentCard = components['schemas']['AssignmentCard'];
export type AssignmentCreate = components['schemas']['AssignmentCreate'];
export type LiveSnapshot = components['schemas']['LiveSnapshot'];
export type LiveRow = components['schemas']['LiveRow'];
export type AttemptDetail = components['schemas']['AttemptDetail'];
export type MetricsView = components['schemas']['MetricsView'];
export type ExportJob = components['schemas']['ExportJob'];

// 04 §10：名单导入结果（openapi 里的内联响应，不是命名 schema）
export interface RosterImportResult {
  added: number;
  duplicates: number;
  invalid: Array<{ row: number; reason: string }>;
}

// —— #35：教师端详情/指标/导出用到的扩展类型 ——
// 服务端额外返回 helpFlags 与 integrity[].flagId（契约缺命名 schema，见 #102 的缺口清单）。
export interface HelpFlagItem {
  flagId: string;
  kind: string;
  layer: string | null;
  at: string;
  resolved: boolean;
  note: string | null;
}

export interface IntegrityItem {
  flagId?: string;
  signal: string;
  score: number;
  evidence?: unknown;
  source?: string;
  disposition?: string | null;
  at?: string;
}

export interface TeacherLine {
  lineId: string;
  layer: string;
  n: number;
  statement: string;
  justification: string;
  provenance: string;
  cls: string;
  keys: string[];
  conf: number | null;
  path: string;
}

export interface TeacherHint {
  hintId: string;
  key: string;
  level: string;
  cost: number;
  revealAfter: number;
  override?: boolean;
  text: string;
  deliveredAt: string;
}

export interface TimelineItem {
  seq: number;
  type: string;
  at: string;
  layer: string | null;
}

export interface TeacherAttemptDetail {
  attemptId: string;
  anonCode: string;
  displayName: string | null;
  status: string;
  mode: string;
  problem: { problemId: string; version: number; title: string };
  lines: TeacherLine[];
  hints: TeacherHint[];
  notes: unknown[];
  helpFlags: HelpFlagItem[];
  integrity: IntegrityItem[];
  timeline: TimelineItem[];
  metrics: Record<string, unknown>;
}

export type ExportFormat = 'csv' | 'xlsx' | 'jsonl';
export type ExportTable = 'attempts' | 'lines' | 'hints' | 'help' | 'recognitions' | 'integrity' | 'events';
