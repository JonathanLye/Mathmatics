// 提交时的来源核对（03 §3.2「只有确认过的识别结果才能用于提交」；06 §1）。
// 手写/拍照/混合来源的提交必须带 recogId，且：该识别属于本人本次作答、已确认、类型与来源匹配，
// 提交的文字与学生确认的文字一致（按 canon 比较，空白差异不算）。
// 否则一个已确认的 recogId 就能给任意文字"洗"出手写来源（诚信信号 no_provenance 会被绕过）。
import { canon } from '@proof-gym/engine';

import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

export interface InputProvenance {
  provenance: 'ink' | 'keyboard' | 'photo' | 'mixed' | 'paste';
  recogId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notConfirmed(message = '手写或拍照内容需先确认识别结果'): AppError {
  return new AppError('RECOG_NOT_CONFIRMED', 409, message);
}

export async function assertConfirmedInput(
  db: Queryable,
  userId: string,
  attemptId: string,
  input: InputProvenance,
  texts: readonly string[],
): Promise<void> {
  if (input.provenance === 'keyboard' || input.provenance === 'paste') return;
  if (input.recogId === undefined || !UUID.test(input.recogId)) throw notConfirmed();

  const found = await db.query<{ kind: 'ink' | 'photo'; confirmed_text: string | null }>(
    `select r.kind, r.confirmed_text
       from app.recognitions r join app.attempts a on a.id = r.attempt_id
      where r.id = $1 and r.attempt_id = $2 and a.user_id = $3 and r.confirmed_at is not null`,
    [input.recogId, attemptId, userId],
  );
  const rec = found.rows[0];
  if (!rec || rec.confirmed_text === null) throw notConfirmed();
  if (input.provenance === 'ink' && rec.kind !== 'ink') throw notConfirmed('提交的来源与识别结果不符');
  if (input.provenance === 'photo' && rec.kind !== 'photo') throw notConfirmed('提交的来源与识别结果不符');

  const confirmed = new Set<string>([canon(rec.confirmed_text), ...rec.confirmed_text.split('\n').map((line) => canon(line))]);
  confirmed.delete('');
  const submitted = texts.map((t) => t.trim()).filter((t) => t !== '');
  const matches = submitted.map((t) => confirmed.has(canon(t)));
  const ok = input.provenance === 'mixed' ? matches.some(Boolean) : matches.length > 0 && matches.every(Boolean);
  if (!ok) throw notConfirmed('提交的内容与你确认的识别结果不一致，请重新确认');
}
