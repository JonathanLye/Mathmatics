import type { AppConfig } from '../../config.ts';
import type { Db } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { encryptPii, normalizeStudentNo, studentNoHash } from '../../auth/crypto.ts';

// 04 §10：名单 CSV 是 `学号,姓名`（姓名可空），UTF-8 或 GBK 自动识别；重复学号合并；不合法行列出行号与原因。
// 学号只存密文与哈希（05 §7）；匹配键必须与服务端登录同一个 studentNoHash（NFKC + trim → HMAC-SHA256）。
export interface RosterInvalidRow {
  row: number;
  reason: string;
}

export interface RosterImportResult {
  added: number;
  duplicates: number;
  invalid: RosterInvalidRow[];
}

// Node 24+ 自带 full-ICU：TextDecoder 支持 utf-8 / gbk / gb18030（已在本机验证 GBK → “学号,姓名”）。
// 先按严格 UTF-8 解码，失败再回退 GB18030（GBK 的超集）。不引入 iconv-lite。
export function decodeCsv(buffer: Buffer): { text: string; encoding: 'utf-8' | 'gb18030' } {
  if (buffer.length === 0) return { text: '', encoding: 'utf-8' };
  let body = buffer;
  let encoding: 'utf-8' | 'gb18030' = 'utf-8';
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) body = body.subarray(3);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding };
  } catch {
    encoding = 'gb18030';
    return { text: new TextDecoder('gb18030').decode(body), encoding };
  }
}

// 最小 RFC 4180 解析：引号包裹、`""` 转义、CRLF/LF、引号内逗号与换行。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_CELLS = new Set(['学号', 'studentno', 'student_no', 'studentid', 'student_id']);

export async function importRoster(
  db: Db,
  config: AppConfig,
  classId: string,
  buffer: Buffer,
): Promise<RosterImportResult> {
  const { text } = decodeCsv(buffer);
  if (text.trim() === '') throw new AppError('VALIDATION_FAILED', 422, '名单文件为空');
  const rows = parseCsv(text);
  const result: RosterImportResult = { added: 0, duplicates: 0, invalid: [] };
  const seen = new Set<string>();

  // 一次导入一个事务：避免“导一半”留下部分名单（A 复审 P3-7）。
  return db.tx(async (tx) => {
    let headerChecked = false;
    let dataRows = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const cells = rows[index];
      if (!cells) continue;
      const rowNo = index + 1;
      const first = (cells[0] ?? '').trim();
      if (cells.every((cell) => cell.trim() === '')) continue; // 空行（含文件前置空行）

      // 可选表头：以“第一个非空行”判断，避免前置空行把表头当成学号。
      if (!headerChecked) {
        headerChecked = true;
        if (HEADER_CELLS.has(first.toLowerCase())) continue;
      }
      dataRows += 1;

      const studentNo = normalizeStudentNo(first);
      const name = (cells[1] ?? '').trim();
      if (studentNo === '') {
        result.invalid.push({ row: rowNo, reason: '学号为空' });
        continue;
      }
      if (cells.length > 2) {
        result.invalid.push({ row: rowNo, reason: '列数超过 2 列（学号,姓名）' });
        continue;
      }

      const hash = studentNoHash(config.studentNoPepper, studentNo);
      if (seen.has(hash)) {
        result.duplicates += 1; // 文件内重复：合并
        continue;
      }
      seen.add(hash);

      const nameEnc = name === '' ? null : encryptPii(config.piiKey, name);
      const existing = (
        await tx.query<{ id: string; name_enc: Buffer | null }>(
          `select id, name_enc from app.roster_entries where class_id = $1 and student_no_hash = $2`,
          [classId, hash],
        )
      ).rows[0];

      if (existing) {
        result.duplicates += 1; // 库里已有：合并；先导学号后补姓名时把姓名补上（04 §10）
        if (existing.name_enc === null && nameEnc !== null) {
          await tx.query(`update app.roster_entries set name_enc = $2 where id = $1`, [existing.id, nameEnc]);
        }
        continue;
      }

      await tx.query(
        `insert into app.roster_entries (class_id, student_no_hash, name_enc) values ($1, $2, $3)`,
        [classId, hash, nameEnc],
      );
      result.added += 1;
    }

    if (dataRows === 0) throw new AppError('VALIDATION_FAILED', 422, '名单文件没有数据行');
    return result;
  });
}
