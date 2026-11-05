// 手写识别服务（03 §3.1、§3.2；09 §10、§11）。
//
// 流程（ink）：
//   1. 事务 A：锁作答行 → 检查状态/限频 → 保存 app.ink_captures（原始笔迹，只多不少）。
//   2. 事务外：栅格化 → 取并发槽 → SimpleTex 主识别（conf<0.7 再调标准接口取高）‖ Qwen 视觉交叉 → canon 比对。
//      callModel 会发 HTTP 请求，绝不能在持有作答行锁的事务里调用（ai/gateway.ts 的约定）。
//   3. 事务 B：写 app.recognitions + recog.request / recog.result 事件（seq 在同一事务里按作答分配）。
// 降级：SimpleTex 出错/超时/排队 >4s → Qwen 当主识别（agree=null）；Qwen 失败 → agree=null；两路都失败 → 503 UPSTREAM_UNAVAILABLE。
// 识别结果只是候选：学生确认（/confirm）之后才能用于提交（routes/attempts.ts 的 assertConfirmedInput）。
import { randomUUID } from 'node:crypto';

import { canon } from '@proof-gym/engine';

import type { CallResult, ModelGateway } from '../ai/gateway.ts';
import type { AppConfig } from '../config.ts';
import type { ContractValidator } from '../contract.ts';
import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { nextSeq } from '../integrity/seq.ts';

import { diffTexts, editDistance, type DiffSpan } from './diff.ts';
import { decodeInk, InkError, inkStats, rasterizeStrokes, visibleStrokes } from './ink.ts';
import { RecogLimiter } from './limiter.ts';
import { latexToMathTextLines } from './mathtext.ts';

export type EventStatus = 'ok' | 'error' | 'timeout' | 'empty';
export type ApiStatus = 'ok' | 'empty' | 'low_confidence' | 'error';

export interface RecognitionView {
  recogId: string;
  status: ApiStatus;
  text: string;
  lines: { text: string; bbox?: number[]; confidence?: number }[];
  confidence?: number;
  agree: boolean | null;
  diff: DiffSpan[];
}

type AttemptLock = {
  id: string;
  user_id: string;
  status: string;
  mode: 'practice' | 'test';
};

// 09 §10 / 03 §3.1：SimpleTex 低于该置信度再调标准接口；排队超过该时间改用 Qwen 当主识别。
const STD_RETRY_BELOW = 0.7;
const QUEUE_WAIT_MS = 4000;
// 低于该置信度，界面提示"不太确定，请逐字核对"。
const LOW_CONFIDENCE = 0.5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecognitionServiceDeps {
  db: Db;
  gateway: ModelGateway;
  config: AppConfig;
  contract: ContractValidator;
}

export interface RecognitionService {
  recognizeInk(userId: string, body: { attemptId: string; draftId: string; target: string; ink: string }): Promise<RecognitionView>;
  confirm(userId: string, recogId: string, body: { text: string; lines?: string[] }): Promise<{ recogId: string; edited: boolean }>;
  limiter: RecogLimiter;
}

export function newlineJoin(lines: readonly string[]): string {
  return lines.join('\n');
}

// 事务内追加一条服务端事件。调用方必须已持有该作答的行锁（FOR UPDATE）。
export async function appendServerEvent(
  tx: Queryable,
  attemptId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const seq = await nextSeq(tx, attemptId);
  await tx.query(
    `insert into ev.events
       (id, seq, type, source, ts_server, user_id, user_anon, role, class_id, assignment_id, attempt_id,
        problem_id, problem_version, mode, payload)
     select gen_random_uuid(), $2, $3, 'server', now(), a.user_id, u.anon_code, 'student', asg.class_id, a.assignment_id,
            a.id, a.problem_id, a.problem_version, a.mode, $4::jsonb
       from app.attempts a
       join app.users u on u.id = a.user_id
       join app.assignments asg on asg.id = a.assignment_id
      where a.id = $1`,
    [attemptId, seq, type, JSON.stringify(payload)],
  );
}

export async function lockActiveAttempt(tx: Queryable, attemptId: string, userId: string): Promise<AttemptLock> {
  if (!UUID.test(attemptId)) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
  const row = (
    await tx.query<AttemptLock>(
      `select id, user_id, status, mode from app.attempts where id = $1 and user_id = $2 for update`,
      [attemptId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
  if (row.status === 'locked') throw new AppError('ATTEMPT_LOCKED', 409, '本题已锁定，请联系老师');
  if (row.status !== 'active') throw new AppError('ATTEMPT_LOCKED', 409, '这次作答已搁置或已结束');
  return row;
}

export async function countRecentRecognitions(tx: Queryable, userId: string, kind: 'ink' | 'photo'): Promise<number> {
  const r = await tx.query<{ n: number | string }>(
    `select count(*) as n from app.recognitions r join app.attempts a on a.id = r.attempt_id
      where a.user_id = $1 and r.kind = $2 and r.created_at > now() - interval '24 hours'`,
    [userId, kind],
  );
  return Number(r.rows[0]?.n ?? 0);
}

function modelText(result: CallResult): string | null {
  if (result.status !== 'ok' || !result.output) return null;
  const text = result.output.text;
  return typeof text === 'string' ? text : null;
}

function modelConfidence(result: CallResult): number | null {
  const c = result.output?.confidence;
  return typeof c === 'number' ? c : null;
}

export function createRecognitionService(deps: RecognitionServiceDeps): RecognitionService {
  const { db, gateway, config, contract } = deps;
  const limiter = new RecogLimiter(config.recognition.concurrency, config.recognition.perUserConcurrency);
  const flags = config.models.flags;
  const crossEnabled = flags['ocr.cross'] !== false;
  const qwenPrimary = flags['ocr.primary'] === 'qwen';

  async function runSimpleTex(png: string, attemptId: string): Promise<{ text: string; confidence: number | null } | null> {
    const input = { image: png, mime: 'image/png' };
    const first = await gateway.callModel('ocr_line', input, { role: 'ocr_line', attemptId, promptVersion: 'simpletex-turbo', redactOutput: true });
    let best = first.status === 'ok' ? { text: modelText(first) ?? '', confidence: modelConfidence(first) } : null;
    if (best && (best.confidence ?? 0) < STD_RETRY_BELOW && best.text !== '') {
      const std = await gateway.callModel('ocr_line_std', input, { role: 'ocr_line_std', attemptId, promptVersion: 'simpletex-std', redactOutput: true });
      if (std.status === 'ok') {
        const candidate = { text: modelText(std) ?? '', confidence: modelConfidence(std) };
        if (candidate.text !== '' && (candidate.confidence ?? 0) > (best.confidence ?? 0)) best = candidate;
      }
    } else if (!best) {
      // turbo 失败时不重试标准接口：失败多半是网络/配额，重试只会拖慢（降级到 Qwen 更快）
    }
    return best;
  }

  async function runQwen(png: string, attemptId: string): Promise<string | null> {
    const result = await gateway.callModel('ocr_cross', { image: png, mime: 'image/png', mode: 'line' }, {
      role: 'cross',
      attemptId,
      promptVersion: 'P-OCR-1',
      redactOutput: true,
    });
    const text = modelText(result);
    return text === null ? null : text.replace(/\s*\n+\s*/g, ' ').trim();
  }

  async function recognizeInk(
    userId: string,
    body: { attemptId: string; draftId: string; target: string; ink: string },
  ): Promise<RecognitionView> {
    let decoded;
    try {
      decoded = decodeInk(body.ink);
    } catch (error) {
      if (error instanceof InkError) {
        if (error.reason === 'too_large') throw new AppError('PAYLOAD_TOO_LARGE', 413, '笔迹数据太大');
        throw new AppError('VALIDATION_FAILED', 422, '笔迹数据无效');
      }
      throw error;
    }
    const { doc, gz } = decoded;
    const visible = visibleStrokes(doc);
    const raster = rasterizeStrokes(visible);
    const stats = inkStats(doc);

    // —— 事务 A：保存原始笔迹（空行也保存：研究数据只多不少）
    const acquired = await limiter.acquire(userId, QUEUE_WAIT_MS);
    if (!acquired.ok) {
      if (acquired.reason === 'user_busy') throw new AppError('RATE_LIMITED', 429, '上一行还在识别，请稍等');
    }
    const slot = acquired.ok ? acquired.slot : null;
    const queueMs = slot?.queueMs ?? QUEUE_WAIT_MS;
    try {
      const inkId = await db.tx(async (tx) => {
        const attempt = await lockActiveAttempt(tx, body.attemptId, userId);
        if ((await countRecentRecognitions(tx, userId, 'ink')) >= config.recognition.inkPerDay) {
          throw new AppError('RATE_LIMITED', 429, '今天的手写识别次数用完了，可以改用键盘输入');
        }
        const saved = await tx.query<{ id: string }>(
          `insert into app.ink_captures
             (attempt_id, draft_id, target, strokes, stroke_count, point_count, duration_ms, canvas, pointer_types)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           returning id`,
          [
            attempt.id,
            body.draftId,
            body.target,
            gz,
            stats.strokeCount,
            stats.pointCount,
            stats.durationMs,
            JSON.stringify({ w: doc.w, h: doc.h, dpr: doc.dpr, orientation: doc.orientation, fullscreen: doc.fullscreen }),
            stats.pointerTypes,
          ],
        );
        return (saved.rows[0] as { id: string }).id;
      });

      const recogId = randomUUID();
      const started = Date.now();

      // —— 识别（事务外）
      let primary: { provider: string; text: string; confidence: number | null } | null = null;
      let crossText: string | null = null;
      let crossProvider: string | null = null;
      let statusForEvent: EventStatus = 'ok';
      let multiLines: string[] = [];

      if (raster === null) {
        statusForEvent = 'empty';
      } else {
        const png = raster.png.toString('base64');
        const useSimple = slot !== null && !qwenPrimary;
        const [simple, qwen] = await Promise.all([
          useSimple ? runSimpleTex(png, body.attemptId) : Promise.resolve(null),
          crossEnabled || !useSimple ? runQwen(png, body.attemptId) : Promise.resolve(null),
        ]);
        const simpleLines = simple ? latexToMathTextLines(simple.text) : [];
        const simpleText = newlineJoin(simpleLines);
        if (simple && simpleText !== '') {
          primary = { provider: 'simpletex', text: simpleText, confidence: simple.confidence };
          multiLines = simpleLines;
          if (qwen !== null) {
            crossText = qwen;
            crossProvider = 'qwen3.8-flash';
          }
        } else if (qwen !== null && qwen !== '') {
          primary = { provider: 'qwen3.8-flash', text: qwen, confidence: null };
          multiLines = [qwen];
        } else if ((simple && simpleText === '') || qwen === '') {
          statusForEvent = 'empty';
        } else {
          statusForEvent = slot === null ? 'timeout' : 'error';
        }
      }

      let agree: boolean | null = null;
      let diff: DiffSpan[] = [];
      if (primary && crossText !== null) {
        agree = canon(primary.text) === canon(crossText);
        diff = agree ? [] : diffTexts(primary.text, crossText);
      }

      const apiStatus: ApiStatus =
        statusForEvent === 'ok'
          ? primary && primary.confidence !== null && primary.confidence < LOW_CONFIDENCE
            ? 'low_confidence'
            : 'ok'
          : statusForEvent === 'empty'
            ? 'empty'
            : 'error';

      // —— 事务 B：落库 + 事件
      await db.tx(async (tx) => {
        await tx.query(
          `insert into app.recognitions
             (id, attempt_id, draft_id, kind, ink_id, provider, result_text, result_lines, confidence, cross_provider,
              cross_text, agree, latency_ms, queue_ms, status)
           values ($1, $2, $3, 'ink', $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)`,
          [
            recogId,
            body.attemptId,
            body.draftId,
            inkId,
            primary?.provider ?? 'none',
            primary?.text ?? null,
            JSON.stringify(multiLines.map((text) => ({ text }))),
            primary?.confidence ?? null,
            crossProvider,
            crossText,
            agree,
            Date.now() - started,
            queueMs,
            statusForEvent,
          ],
        );
        await tx.query(`select 1 from app.attempts where id = $1 for update`, [body.attemptId]);
        await appendServerEvent(tx, body.attemptId, 'recog.request', {
          recogId,
          kind: 'ink',
          provider: primary?.provider ?? 'simpletex',
          queueMs,
        });
        await appendServerEvent(tx, body.attemptId, 'recog.result', {
          recogId,
          provider: primary?.provider ?? 'simpletex',
          ...(primary?.confidence != null ? { confidence: primary.confidence } : {}),
          latencyMs: Date.now() - started,
          ...(crossProvider ? { crossProvider } : {}),
          agree,
          status: statusForEvent,
        });
      });

      if (statusForEvent === 'error' || statusForEvent === 'timeout') {
        throw new AppError('UPSTREAM_UNAVAILABLE', 503, '没认出来，再写一次，或者用键盘');
      }

      const view: RecognitionView = {
        recogId,
        status: apiStatus,
        text: primary?.text ?? '',
        lines: (multiLines.length > 0 ? multiLines : []).map((text) => ({
          text,
          ...(primary?.confidence != null ? { confidence: primary.confidence } : {}),
        })),
        ...(primary?.confidence != null ? { confidence: primary.confidence } : {}),
        agree,
        diff,
      };
      contract.validate('Recognition', view);
      return view;
    } finally {
      slot?.release();
    }
  }

  async function confirm(
    userId: string,
    recogId: string,
    body: { text: string; lines?: string[] },
  ): Promise<{ recogId: string; edited: boolean }> {
    if (!UUID.test(recogId)) throw new AppError('NOT_FOUND', 404, '找不到这条识别结果');
    return db.tx(async (tx) => {
      const found = await tx.query<{
        id: string;
        attempt_id: string;
        kind: 'ink' | 'photo';
        status: string;
        result_text: string | null;
        result_lines: { text: string }[] | null;
        confirmed_text: string | null;
      }>(
        `select r.id, r.attempt_id, r.kind, r.status, r.result_text, r.result_lines, r.confirmed_text
           from app.recognitions r join app.attempts a on a.id = r.attempt_id
          where r.id = $1 and a.user_id = $2`,
        [recogId, userId],
      );
      const rec = found.rows[0];
      if (!rec) throw new AppError('NOT_FOUND', 404, '找不到这条识别结果');
      await lockActiveAttempt(tx, rec.attempt_id, userId);
      // 没识别出内容的结果（empty）没有可确认的东西：学生应改用键盘输入。
      if (rec.status !== 'ok') throw new AppError('VALIDATION_FAILED', 422, '这条识别没有结果，请改用键盘输入');

      const confirmedLines =
        rec.kind === 'photo'
          ? (body.lines ?? body.text.split('\n')).map((l) => l.trim()).filter((l) => l !== '')
          : [body.text.trim()];
      const confirmedText = newlineJoin(confirmedLines);
      const before = rec.result_text ?? '';
      const distance = editDistance(before, confirmedText);
      const edited = distance > 0;

      // 照片：一张照片的 recogId 会被逐行加入多次，已确认的行累加（只增不减）；手写：以最后一次确认为准。
      let stored = confirmedText;
      if (rec.kind === 'photo' && rec.confirmed_text) {
        const existing = rec.confirmed_text.split('\n');
        stored = newlineJoin([...existing, ...confirmedLines.filter((l) => !existing.includes(l))]);
      }
      await tx.query(
        `update app.recognitions
            set confirmed_text = $2, edited = $3, edit_distance = $4, confirmed_at = coalesce(confirmed_at, now())
          where id = $1`,
        [recogId, stored, edited, distance],
      );
      await appendServerEvent(tx, rec.attempt_id, 'recog.confirm', { recogId, edited, editDistance: distance });
      return { recogId, edited };
    });
  }

  return { recognizeInk, confirm, limiter };
}
