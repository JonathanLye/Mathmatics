import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { AppError } from '../../errors.ts';
import type { Db, Queryable } from '../../db/index.ts';
import { computeAttemptMetrics } from '../../metrics/attempt.ts';
import { csvField } from '../../export/attempts-csv.ts';

export type ExportFormat = 'csv' | 'xlsx' | 'jsonl';
export type ExportTable = 'attempts' | 'lines' | 'hints' | 'help' | 'recognitions' | 'integrity' | 'events';
export const EXPORT_TABLES: readonly ExportTable[] = [
  'attempts',
  'lines',
  'hints',
  'help',
  'recognitions',
  'integrity',
  'events',
];
const FORMATS: readonly ExportFormat[] = ['csv', 'xlsx', 'jsonl'];

export interface CreateExportInput {
  classId: string;
  assignmentIds?: string[];
  format: ExportFormat;
  tables: ExportTable[];
  anonymized?: boolean;
}

export interface ExportJobDto {
  exportId: string;
  status: 'queued' | 'pending_approval' | 'running' | 'done' | 'failed' | 'expired';
  url: string | null;
  rows: number | null;
}

const BOM = '\uFEFF';
const FILE_DIR = process.env.EXPORT_DIR ?? path.join(tmpdir(), 'proof-gym-exports');
const FILE_EXT: Record<ExportFormat, string> = { csv: 'zip', xlsx: 'xlsx', jsonl: 'zip' };

export function classCodeOf(classId: string): string {
  return createHash('sha256').update(classId).digest('hex').slice(0, 8);
}

export function parseCreateExport(body: unknown): CreateExportInput {
  if (body === null || typeof body !== 'object') throw new AppError('VALIDATION_FAILED', 422, '导出请求体不合法');
  const raw = body as Record<string, unknown>;
  if (typeof raw.classId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.classId)) {
    throw new AppError('VALIDATION_FAILED', 422, 'classId 必须是 UUID');
  }
  if (typeof raw.format !== 'string' || !FORMATS.includes(raw.format as ExportFormat)) {
    throw new AppError('VALIDATION_FAILED', 422, 'format 必须是 csv/xlsx/jsonl');
  }
  if (!Array.isArray(raw.tables) || raw.tables.length === 0) {
    throw new AppError('VALIDATION_FAILED', 422, 'tables 至少选一张表');
  }
  const tables: ExportTable[] = [];
  for (const table of raw.tables) {
    if (typeof table !== 'string' || !EXPORT_TABLES.includes(table as ExportTable)) {
      throw new AppError('VALIDATION_FAILED', 422, `未知导出表：${String(table)}`);
    }
    if (!tables.includes(table as ExportTable)) tables.push(table as ExportTable);
  }
  const assignmentIds = Array.isArray(raw.assignmentIds)
    ? raw.assignmentIds.map((id) => {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          throw new AppError('VALIDATION_FAILED', 422, 'assignmentIds 含非法 UUID');
        }
        return id;
      })
    : undefined;
  return {
    classId: raw.classId,
    ...(assignmentIds === undefined ? {} : { assignmentIds }),
    format: raw.format as ExportFormat,
    tables,
    anonymized: raw.anonymized !== false,
  };
}

// 08 §5 字段字典（导出列名）；与 SQL 的 select 别名一一对应，缺数据的列导出为空而不是伪造。
const DICTIONARY: Record<ExportTable, string[]> = {
  attempts: [
    'anon_id', 'class_code', 'arm', 'arm_order', 'grade', 'problem_id', 'problem_version', 'chapter', 'tags',
    'difficulty', 'role', 'mode', 'kind', 'parent_attempt_id', 'started_at', 'completed_at', 'duration_s',
    'active_s', 'submissions', 'layers_done', 'layers_skipped', 'def_attempts', 'lesson_opened', 'lines',
    'keys_total', 'keys_own', 'keys_autonomous', 'reveal', 'independence', 'hints_total', 'hint_max_level',
    'first_error', 'first_help_latency_s', 'post_hint_dwell_med_s', 'rapid_locks', 'stuck_offers',
    'pressure_count', 'help_stuck', 'help_concept', 'help_check', 'help_free', 'input_ink', 'input_kbd',
    'input_photo', 'input_paste', 'recog_requests', 'recog_edit_rate', 'recog_disagree_rate', 'away_count',
    'away_s', 'integrity_max_score', 'integrity_signals', 'completed', 'summary_missing_points',
    'model_versions', 'prompt_version',
  ],
  lines: [
    'anon_id', 'attempt_id', 'layer', 'role', 'idx', 'slot', 'statement', 'justification',
    'statement_canon', 'provenance', 'cls', 'keys', 'new_keys', 'error_id', 'conf', 'classifier_path',
    'created_at', 'edited_at', 'deleted_at',
  ],
  hints: ['anon_id', 'attempt_id', 'help_id', 'key_id', 'level', 'cost', 'reveal_before', 'reveal_after', 'text_shown', 'delivered_at'],
  help: ['anon_id', 'attempt_id', 'layer', 'intent', 'routed', 'routed_by', 'conf', 'text', 'outcome', 'created_at'],
  recognitions: [
    'anon_id', 'attempt_id', 'kind', 'provider', 'cross_provider', 'confidence', 'agree',
    'latency_ms', 'queue_ms', 'status', 'edited', 'edit_distance', 'cost_cny', 'created_at',
  ],
  integrity: ['anon_id', 'attempt_id', 'signal', 'score', 'evidence', 'source', 'disposition', 'created_at'],
  events: [
    'id', 'seq', 'type', 'source', 'ts_server', 'ts_client', 'session_id', 'device_id', 'client_seq',
    'user_anon', 'role', 'class_id', 'assignment_id', 'attempt_id', 'problem_id', 'problem_version', 'layer',
    'mode', 'arm', 'app_version', 'platform', 'prompt_version', 'model_versions', 'payload',
  ],
};

type Row = Record<string, unknown>;

async function buildRows(db: Queryable, classId: string, table: ExportTable, assignmentIds?: string[]): Promise<Row[]> {
  const scoped = assignmentIds !== undefined && assignmentIds.length > 0;
  const params: unknown[] = scoped ? [classId, assignmentIds] : [classId];
  const scopeClause = scoped ? `and t.assignment_id = any($2::uuid[])` : '';
  const baseFrom = `
    from app.attempts t
    join app.assignments asg on asg.id = t.assignment_id
    join app.users u on u.id = t.user_id
    left join app.class_members m on m.class_id = asg.class_id and m.user_id = t.user_id`;
  const where = `where asg.class_id = $1 ${scopeClause}`;
  switch (table) {
    case 'attempts': {
      const rows = (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, asg.class_id,
                m.arm, m.arm_order, sp.grade,
                t.problem_id, t.problem_version, pv.public,
                t.mode, t.kind, t.parent_attempt_id,
                t.started_at, t.completed_at, t.reveal, t.keys_own, t.keys_total, t.independence,
                t.active_ms, t.status
           from app.attempts t
           join app.assignments asg on asg.id = t.assignment_id
           join app.users u on u.id = t.user_id
           left join app.student_profiles sp on sp.user_id = t.user_id
           left join app.class_members m on m.class_id = asg.class_id and m.user_id = t.user_id
           left join content.problem_versions pv on pv.problem_id = t.problem_id and pv.version = t.problem_version
          where asg.class_id = $1 ${scopeClause}
          order by t.started_at, t.id`,
        params,
      )).rows;
      const result: Row[] = [];
      for (const row of rows) {
        const metrics = await computeAttemptMetrics(db, String(row.attempt_id));
        const away = (
          await db.query<{ away_count: string; away_ms: string | null }>(
            `select count(*) filter (
                      where payload->>'state' = 'visible' and coalesce((payload->>'awayMs')::bigint, 0) >= 2000
                    )::text as away_count,
                    coalesce(sum(case when payload->>'state' = 'visible' then coalesce((payload->>'awayMs')::bigint, 0) end), 0)::text as away_ms
               from ev.events where attempt_id = $1 and type = 'integ.visibility'`,
            [row.attempt_id],
          )
        ).rows[0];
        const pub = (row.public ?? {}) as Record<string, unknown>;
        const startedAt = row.started_at as Date | null;
        const completedAt = row.completed_at as Date | null;
        const durationS =
          completedAt !== null && startedAt !== null ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000) : null;
        result.push({
          anon_id: row.anon_id,
          class_code: classCodeOf(classId),
          arm: row.arm,
          arm_order: row.arm_order,
          grade: row.grade,
          problem_id: row.problem_id,
          problem_version: row.problem_version,
          chapter: pub.chapter ?? null,
          tags: Array.isArray(pub.tags) ? (pub.tags as unknown[]).join(';') : null,
          difficulty: pub.difficulty ?? null,
          role: null,
          mode: row.mode === 'test' ? '测验' : '练习',
          kind: row.kind,
          parent_attempt_id: row.parent_attempt_id,
          started_at: startedAt,
          completed_at: completedAt,
          duration_s: durationS,
          active_s: Math.round(Number(row.active_ms ?? 0) / 1000),
          submissions: null,
          layers_done: null,
          layers_skipped: null,
          def_attempts: metrics.defAttempts,
          lesson_opened: metrics.lessonOpened,
          lines: metrics.lines,
          keys_total: row.keys_total,
          keys_own: row.keys_own,
          keys_autonomous: null,
          reveal: row.reveal,
          independence: row.independence,
          hints_total: null,
          hint_max_level: null,
          first_error: null,
          first_help_latency_s: null,
          post_hint_dwell_med_s: null,
          rapid_locks: null,
          stuck_offers: null,
          pressure_count: null,
          help_stuck: null,
          help_concept: null,
          help_check: null,
          help_free: null,
          input_ink: metrics.provenance.ink ?? null,
          input_kbd: metrics.provenance.keyboard ?? null,
          input_photo: metrics.provenance.photo ?? null,
          input_paste: metrics.provenance.paste ?? null,
          recog_requests: null,
          recog_edit_rate: null,
          recog_disagree_rate: null,
          away_count: Number(away?.away_count ?? 0),
          away_s: Math.round(Number(away?.away_ms ?? 0) / 1000),
          integrity_max_score: metrics.integrityMaxScore,
          integrity_signals: Object.keys(metrics.integrityFlags).sort().join(';'),
          completed: metrics.completed,
          summary_missing_points: null,
          model_versions: null,
          prompt_version: null,
        });
      }
      return result;
    }
    case 'lines':
      return (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, l.layer, l.role, l.idx, l.slot,
                l.statement, l.justification, l.statement_canon, l.provenance, l.cls, l.keys, l.new_keys,
                l.error_id, l.conf, l.classifier_path, l.created_at, l.edited_at, l.deleted_at
           ${baseFrom}
           join app.attempt_lines l on l.attempt_id = t.id
           ${where}
          order by t.id, l.layer, l.idx, l.created_at`,
        params,
      )).rows;
    case 'hints':
      return (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, h.help_id, h.key_id, h.level, h.cost,
                h.reveal_before, h.reveal_after, h.text_shown, h.created_at as delivered_at
           ${baseFrom}
           join app.hint_deliveries h on h.attempt_id = t.id
           ${where}
          order by t.id, h.created_at`,
        params,
      )).rows;
    case 'help':
      return (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, h.layer, h.intent, h.routed, h.routed_by,
                h.conf, h.text, h.outcome, h.created_at
           ${baseFrom}
           join app.help_requests h on h.attempt_id = t.id
           ${where}
          order by t.id, h.created_at`,
        params,
      )).rows;
    case 'recognitions':
      return (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, r.kind, r.provider, r.cross_provider,
                r.confidence, r.agree, r.latency_ms, r.queue_ms, r.status, r.edited, r.edit_distance,
                r.cost_cny, r.created_at
           ${baseFrom}
           join app.recognitions r on r.attempt_id = t.id
           ${where}
          order by t.id, r.created_at`,
        params,
      )).rows;
    case 'integrity':
      return (await db.query<Row>(
        `select u.anon_code as anon_id, t.id as attempt_id, s.signal, s.score, s.evidence, s.source,
                s.disposition, s.created_at
           ${baseFrom}
           join app.integrity_signals s on s.attempt_id = t.id
           ${where}
          order by t.id, s.created_at`,
        params,
      )).rows;
    case 'events':
      return (await db.query<Row>(
        `select e.id, e.seq, e.type, e.source, e.ts_server, e.ts_client, e.session_id, e.device_id,
                e.client_seq, e.user_anon, e.role, e.class_id, e.assignment_id, e.attempt_id, e.problem_id,
                e.problem_version, e.layer, e.mode, e.arm, e.app_version, e.platform, e.prompt_version,
                e.model_versions, e.payload
           ${baseFrom}
           join ev.events e on e.attempt_id = t.id
           ${where}
          order by e.ts_server, e.seq`,
        params,
      )).rows;
  }
}

function toCsv(columns: string[], rows: Row[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvField(row[column])).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

function dictionaryCsv(tables: ExportTable[]): string {
  const lines = ['table,field,description'];
  for (const table of tables) {
    for (const field of DICTIONARY[table]) lines.push(`${table},${field},08 §5 字段字典`);
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

async function writeCsvZip(id: string, format: ExportFormat, tables: ExportTable[], rows: Map<ExportTable, Row[]>): Promise<number> {
  await mkdir(FILE_DIR, { recursive: true });
  const zip = new JSZip();
  let count = 0;
  for (const table of tables) {
    const tableRows = rows.get(table) ?? [];
    count += tableRows.length;
    const ext = format === 'jsonl' ? 'jsonl' : 'csv';
    const body =
      ext === 'csv'
        ? toCsv(DICTIONARY[table], tableRows)
        : tableRows.map((row) => JSON.stringify(row)).join('\n') + (tableRows.length > 0 ? '\n' : '');
    zip.file(`${table}.${ext}`, body);
    zip.file(`${table}.dictionary.csv`, dictionaryCsv([table]));
  }
  zip.file('dictionary.csv', dictionaryCsv(tables));
  zip.file('README.txt', '默认匿名导出；字段字典见 *.dictionary.csv（Excel 为“字段字典”工作表）。口径 08 §5。\n');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(path.join(FILE_DIR, `${id}.${FILE_EXT[format]}`), buffer);
  return count;
}

async function writeXlsx(id: string, tables: ExportTable[], rows: Map<ExportTable, Row[]>): Promise<number> {
  await mkdir(FILE_DIR, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'proof-gym';
  let count = 0;
  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.slice(0, 31));
    const columns = DICTIONARY[table];
    sheet.addRow(columns);
    for (const row of rows.get(table) ?? []) {
      sheet.addRow(columns.map((column) => {
        const value = row[column];
        if (value instanceof Date) return value.toISOString();
        if (value === null || value === undefined) return '';
        return typeof value === 'object' ? JSON.stringify(value) : value;
      }));
      count += 1;
    }
    sheet.getRow(1).font = { bold: true };
  }
  const dict = workbook.addWorksheet('字段字典');
  dict.addRow(['table', 'field', 'description']);
  for (const table of tables) for (const field of DICTIONARY[table]) dict.addRow([table, field, '08 §5 字段字典']);
  await workbook.xlsx.writeFile(path.join(FILE_DIR, `${id}.xlsx`));
  return count;
}

export async function runExport(db: Db, exportId: string): Promise<void> {
  const row = (await db.query<{ scope: CreateExportInput; format: ExportFormat; anonymized: boolean; status: string }>(
    `select scope, format, anonymized, status from app.exports where id = $1`,
    [exportId],
  )).rows[0];
  if (row === undefined) return;
  await db.query(`update app.exports set status = 'running' where id = $1`, [exportId]);
  try {
    const rows = new Map<ExportTable, Row[]>();
    for (const table of row.scope.tables) {
      rows.set(table, await buildRows(db, row.scope.classId, table, row.scope.assignmentIds));
    }
    const count =
      row.format === 'xlsx'
        ? await writeXlsx(exportId, row.scope.tables, rows)
        : await writeCsvZip(exportId, row.format, row.scope.tables, rows);
    await db.query(
      `update app.exports set status='done', file_key=$2, row_count=$3, finished_at=now() where id=$1`,
      [exportId, `${exportId}.${FILE_EXT[row.format]}`, count],
    );
  } catch {
    await db.query(`update app.exports set status='failed', finished_at=now() where id=$1`, [exportId]);
  }
}

export async function createExport(db: Db, actorId: string, role: string, input: CreateExportInput): Promise<ExportJobDto> {
  const status = input.anonymized === false ? 'pending_approval' : 'queued';
  const inserted = await db.query<{ id: string }>(
    `insert into app.exports (requested_by, scope, format, anonymized, status)
     values ($1, $2::jsonb, $3, $4, $5) returning id`,
    [actorId, JSON.stringify({ classId: input.classId, assignmentIds: input.assignmentIds ?? [], tables: input.tables }), input.format, input.anonymized !== false, status],
  );
  const exportId = inserted.rows[0]!.id;
  await db.query(
    `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'export_create', $2, $3::jsonb)`,
    [actorId, exportId, JSON.stringify({ classId: input.classId, format: input.format, tables: input.tables, anonymized: input.anonymized !== false, role })],
  );
  if (status === 'queued') {
    setImmediate(() => {
      void runExport(db, exportId);
    });
  }
  return { exportId, status, url: null, rows: null };
}

export async function getExport(db: Db, actorId: string, role: string, exportId: string): Promise<ExportJobDto> {
  const row = (await db.query<{
    id: string;
    requested_by: string;
    status: ExportJobDto['status'];
    file_key: string | null;
    row_count: number | null;
  }>(`select id, requested_by, status, file_key, row_count from app.exports where id = $1`, [exportId])).rows[0];
  if (row === undefined) throw new AppError('NOT_FOUND', 404, '导出任务不存在');
  if (row.requested_by !== actorId && role !== 'admin') throw new AppError('NOT_FOUND', 404, '导出任务不存在');
  const done = row.status === 'done' && row.file_key !== null;
  return {
    exportId: row.id,
    status: row.status,
    url: done ? `/api/v1/teacher/exports/${row.id}/download` : null,
    rows: row.row_count,
  };
}

export async function exportFilePath(db: Db, actorId: string, role: string, exportId: string): Promise<string> {
  const row = (await db.query<{ requested_by: string; status: string; file_key: string | null }>(
    `select requested_by, status, file_key from app.exports where id = $1`,
    [exportId],
  )).rows[0];
  if (row === undefined) throw new AppError('NOT_FOUND', 404, '导出任务不存在');
  if (row.requested_by !== actorId && role !== 'admin') throw new AppError('NOT_FOUND', 404, '导出任务不存在');
  if (row.status !== 'done' || row.file_key === null) throw new AppError('NOT_FOUND', 404, '导出文件尚未就绪');
  mkdirSync(FILE_DIR, { recursive: true });
  const file = path.join(FILE_DIR, row.file_key);
  if (!existsSync(file)) throw new AppError('NOT_FOUND', 404, '导出文件已过期或被清理');
  return file;
}

export function contentTypeFor(format: ExportFormat): string {
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/zip';
}
