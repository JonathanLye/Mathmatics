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
