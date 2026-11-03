import { createHash } from 'node:crypto';

import type { Db } from '../db/index.ts';
import { computeAttemptMetrics, type AttemptMetrics } from '../metrics/attempt.ts';

// 作答汇总表的导出列（08 §5.1 字段字典的子集）。列名与字典一致。
// 未包含：依赖求助/提示/识别事件的字段（#29、#21 之后补），以及 08 §5.1 的其余字段。字典里的完整列表以 08 为准。
export const ATTEMPTS_COLUMNS = [
  'anon_id',
  'class_code',
  'arm',
  'arm_order',
  'problem_id',
  'problem_version',
  'mode',
  'started_at',
  'completed_at',
  'duration_s',
  'lines',
  'away_count',
  'away_s',
  'integrity_max_score',
  'integrity_signals',
  'completed',
] as const;

const BOM = '﻿';

// RFC 4180：含逗号、引号、换行的字段加双引号，内部引号加倍。
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// 班级代号：班级 ID 的哈希前 8 位（不导出班级名称）。
export function classCode(classId: string): string {
  return createHash('sha256').update(classId).digest('hex').slice(0, 8);
}

type ExportRow = {
  attempt_id: string;
  class_id: string;
  anon_code: string;
  arm: string | null;
  arm_order: string | null;
  problem_id: string;
  problem_version: number;
  mode: string;
  started_at: Date | null;
  completed_at: Date | null;
};

export async function buildAttemptsCsv(db: Db, classId: string): Promise<string> {
  const rows = await db.query<ExportRow>(
    `select t.id as attempt_id, asg.class_id, u.anon_code, m.arm, m.arm_order,
            t.problem_id, t.problem_version, t.mode, t.started_at, t.completed_at
       from app.attempts t
       join app.assignments asg on asg.id = t.assignment_id
       join app.users u on u.id = t.user_id
       left join app.class_members m on m.class_id = asg.class_id and m.user_id = t.user_id
      where asg.class_id = $1
      order by t.started_at, t.id`,
    [classId],
  );

  const lines = [ATTEMPTS_COLUMNS.join(',')];
  for (const row of rows.rows) {
    const metrics: AttemptMetrics = await computeAttemptMetrics(db, row.attempt_id);
    const durationS = metrics.durationMs === null ? null : Math.round(metrics.durationMs / 1000);
    const values: Record<(typeof ATTEMPTS_COLUMNS)[number], unknown> = {
      anon_id: row.anon_code,
      class_code: classCode(row.class_id),
      arm: row.arm,
      arm_order: row.arm_order,
      problem_id: row.problem_id,
      problem_version: row.problem_version,
      mode: row.mode === 'test' ? '测验' : '练习',
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_s: durationS,
      lines: metrics.lines,
      away_count: metrics.awayCount,
      away_s: Math.round(metrics.awayMs / 1000),
      integrity_max_score: metrics.integrityMaxScore,
      integrity_signals: Object.keys(metrics.integrityFlags).sort().join(';'),
      completed: metrics.completed,
    };
    lines.push(ATTEMPTS_COLUMNS.map((c) => csvField(values[c])).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
