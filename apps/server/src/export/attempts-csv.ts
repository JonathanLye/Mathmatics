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

// 研究/教学导出可以包含的作答：不含 kind='redo'（重做不进导出，否则同一题被算两次），
// 且排除撤回了「教研使用」同意的学生（13 §2：曾同意 research、最近一次有效同意里不再同意——
// 含整份同意书被撤销）。从未勾选 research 的学生不在此排除（沿用既有导出口径，由教师端按班级范围控制）。
export function exportableAttemptSql(alias = 't'): string {
  const uid = `${alias}.user_id`;
  return `${alias}.kind <> 'redo'
    and not (
      exists (select 1 from app.consents rc where rc.user_id = ${uid} and rc.items->>'research' = 'true')
      and (select lc.items->>'research' from app.consents lc
            where lc.user_id = ${uid} and lc.revoked_at is null order by lc.created_at desc limit 1) is distinct from 'true'
    )`;
}

// RFC 4180：含逗号、引号、换行的字段加双引号，内部引号加倍。
// 字符串以 = + - @、制表符/回车/换行或它们的全角形式开头时前置单引号，避免研究者用 Excel 打开时被当成公式（OWASP CSV injection）。
// 只处理 string：数字（含负数）和日期是我们自己格式化的，不会被当成公式。
// jsonb 列（payload、evidence、keys）序列化成 JSON；String(object) 只会得到 [object Object]，数据就丢了。
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r\n＝＋－＠]/.test(text)) text = `'${text}`;
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
      where asg.class_id = $1 and ${exportableAttemptSql('t')}
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
