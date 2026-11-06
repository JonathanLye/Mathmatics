import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { canon } from '@proof-gym/engine';

import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireAuth } from '../auth/session.ts';
import { studentAssignment, studentHome } from '../attempts/home.ts';
import { loadProblem } from '../attempts/problem.ts';
import { addLine, createAttemptService } from '../attempts/service.ts';
import type { ContractValidator } from '../contract.ts';
import { AppError } from '../errors.ts';
import type { RouteInput } from '../help/intent.ts';
import { createIdempotency } from '../idempotency.ts';
import { createLessonService } from '../help/lesson.ts';
import { createHelpService } from '../help/service.ts';
import { assertConfirmedInput } from '../recognition/provenance.ts';

import type { AuthRouteOptions } from './auth.ts';

type Provenance = 'ink' | 'keyboard' | 'photo' | 'mixed' | 'paste';

interface InputMeta {
  provenance: Provenance;
  draftId: string;
  recogId?: string;
  pasteChars?: number;
}

interface TextSubmission {
  text: string;
  input: InputMeta;
}

interface LineSubmission {
  statement: string;
  justification?: string;
  input: InputMeta;
  // 依据是独立的输入落点（03 §1）：没带时按键盘输入处理，不拿 input 的 recogId 去核对依据文字。
  justificationInput?: InputMeta;
}

interface SummarySubmission {
  answers: string[];
  input: InputMeta;
}

interface HelpSubmission {
  intent: 'stuck' | 'concept' | 'check_line' | 'free';
  text?: string;
  lineId?: string;
}

function helpInput(body: HelpSubmission): RouteInput {
  if (body.intent === 'free') return { intent: 'free', text: body.text ?? '' };
  return { intent: body.intent };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(raw: string): string {
  if (!UUID.test(raw)) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
  return raw;
}

function layerParam(raw: string): number {
  const match = /^L([1-6])$/.exec(raw);
  if (!match) throw new AppError('NOT_FOUND', 404, '没有这一层');
  return Number(match[1]);
}

// If-Match 可以是裸数字或带引号的数字（06 §5）。
function ifMatchOf(request: FastifyRequest): number | undefined {
  const raw = request.headers['if-match'];
  if (raw === undefined) return undefined;
  const version = Number(String(raw).replaceAll('"', '').trim());
  if (!Number.isInteger(version) || version < 0) throw new AppError('VALIDATION_FAILED', 422, 'If-Match 需为状态版本号');
  return version;
}

function parseBody<T>(
  contract: ContractValidator,
  path: string,
  request: FastifyRequest,
  method: 'post' | 'put' | 'patch' = 'post',
): T {
  contract.validateRequest(path, method, request.body);
  return request.body as T;
}

export const attemptRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  const svc = createAttemptService(db, contract);
  const helpSvc = createHelpService({ db, attempts: svc, secret: config.sessionSecret });
  const lessonSvc = createLessonService({ db, attempts: svc });
  const conceptParam = (request: FastifyRequest): string => {
    const raw = (request.params as Record<string, string>).conceptId ?? '';
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(raw)) throw new AppError('NOT_FOUND', 404, '没有这个概念');
    return raw;
  };
  // 06 §1：写接口带 Idempotency-Key 时，同键重放返回首次响应。先鉴权/同意书，再占位。
  const idempotency = createIdempotency(db);
  const writable = { preHandler: [requireStudentConsent(db), idempotency.preHandler], onSend: idempotency.onSend };
  // 求助接口会触发引擎与（后续）模型调用：按会话限流，防失控重试；引擎自己的 rapid_lock 仍是产品层面的限制。
  const helpLimited = {
    ...writable,
    config: { rateLimit: { max: config.rateLimits.help, timeWindow: '1 minute', keyGenerator: bySession } },
  };
  const param = (request: FastifyRequest, name: string): string => (request.params as Record<string, string>)[name] ?? '';
  const attemptId = (request: FastifyRequest): string => uuidParam(param(request, 'attemptId'));

  // 学生自己这次作答里一行未删除的第 3 层证明行；counted 是它计入的关键步骤，otherKeys 是其它行计入的。
  async function ownStepLine(userId: string, attempt: string, lineId: string) {
    const rows = (
      await db.query<{ id: string; idx: number; statement: string; justification: string | null; cls: string | null; keys: string[] }>(
        `select l.id, l.idx, l.statement, l.justification, l.cls, l.keys
           from app.attempt_lines l join app.attempts a on a.id = l.attempt_id
          where l.attempt_id = $1 and a.user_id = $2 and l.role = 'step' and l.deleted_at is null`,
        [attempt, userId],
      )
    ).rows;
    const line = rows.find((row) => row.id === lineId);
    if (!line) throw new AppError('NOT_FOUND', 404, '找不到这一行');
    const counted = (row: { cls: string | null; keys: string[] }): string[] => (row.cls === 'match' ? row.keys : []);
    return {
      ...line,
      counted: counted(line),
      otherKeys: [...new Set(rows.filter((row) => row.id !== lineId).flatMap(counted))],
    };
  }

  // 学生首页（06 §3.1）：只读聚合，不要求同意书（未签同意也能先看到作业列表）。
  app.get('/student/home', async (request) => {
    const auth = await requireAuth(db, request);
    return studentHome(db, contract, auth.userId);
  });

  app.post('/student/assignments/:assignmentId/attempt', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.start(auth.userId, uuidParam(param(request, 'assignmentId')));
    return { state };
  });

  app.get('/attempts/:attemptId', async (request) => {
    const auth = await requireAuth(db, request);
    return { state: await svc.get(auth.userId, attemptId(request)) };
  });

  app.get('/student/assignments/:assignmentId', async (request) => {
    const auth = await requireAuth(db, request);
    return studentAssignment(db, contract, auth.userId, uuidParam(param(request, 'assignmentId')));
  });

  // 预写微课（06 §4.4）：只读，已过闸门；小核验的答案不下发，由 /check 判定。
  app.get('/attempts/:attemptId/lesson/:conceptId', async (request) => {
    const auth = await requireAuth(db, request);
    return lessonSvc.get(auth.userId, attemptId(request), conceptParam(request));
  });

  app.post('/attempts/:attemptId/lesson/:conceptId/check', { preHandler: [requireStudentConsent(db)] }, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<{ stepId: string; choice: number }>(contract, '/attempts/{attemptId}/lesson/{conceptId}/check', request);
    return lessonSvc.check(auth.userId, attemptId(request), conceptParam(request), body);
  });

  app.post('/attempts/:attemptId/definition', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/definition', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const lineId = randomUUID();
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'def.submit', lineId, text: body.text }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'def.submit')) return;
        await addLine(tx, row, { id: lineId, layer: 'L1', role: 'def', statement: body.text, provenance: body.input.provenance, recogId: body.input.recogId });
      },
    });
    return { state };
  });

  app.post('/attempts/:attemptId/framework', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/framework', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const lineId = randomUUID();
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'frame.submit', lineId, text: body.text }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'frame.submit')) return;
        await addLine(tx, row, { id: lineId, layer: 'L2', role: 'frame', statement: body.text, provenance: body.input.provenance, recogId: body.input.recogId });
      },
    });
    return { state };
  });

  app.post('/attempts/:attemptId/framework/template', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'frame.template' }),
    });
    return { state };
  });

  app.post('/attempts/:attemptId/lines', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<LineSubmission>(contract, '/attempts/{attemptId}/lines', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.statement]);
    if (body.justificationInput) {
      await assertConfirmedInput(db, auth.userId, attemptId(request), body.justificationInput, [body.justification ?? '']);
    }
    const lineId = randomUUID();
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({
        kind: 'line.submit',
        lineId,
        s: body.statement,
        j: body.justification ?? '',
        provenance: body.input.provenance,
      }),
      record: async (tx, row, result) => {
        const ev = result.events.find((e) => e.type === 'line.submit');
        if (!ev) return;
        await addLine(tx, row, {
          id: lineId,
          layer: 'L3',
          role: 'step',
          idx: Number(ev.payload.n),
          statement: body.statement,
          justification: body.justification ?? null,
          provenance: body.input.provenance,
          recogId: body.input.recogId,
          cls: String(ev.payload.cls),
          keys: ev.payload.keys as string[],
          newKeys: ev.payload.newKeys as string[],
          errorId: (ev.payload.errorId as string | undefined) ?? null,
        });
      },
    });
    return { state };
  });

  app.post('/attempts/:attemptId/finish', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'finish.try' }),
    });
    return { state };
  });

  app.post('/attempts/:attemptId/selfcheck/:itemId', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/selfcheck/{itemId}', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const itemId = param(request, 'itemId');
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'selfcheck.item', itemId, answer: body.text }),
      record: async (tx, row, result) => {
        const ev = result.events.find((e) => e.type === 'selfcheck.submit' && e.payload.itemId === itemId);
        if (!ev) return;
        await addLine(tx, row, {
          layer: 'L4',
          role: 'selfcheck',
          slot: itemId,
          statement: body.text,
          provenance: body.input.provenance,
          recogId: body.input.recogId,
          cls: ev.payload.valid === true ? 'pass' : 'fail',
        });
      },
    });
    return { state };
  });

  app.post('/attempts/:attemptId/transfer', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.transfer(auth.userId, attemptId(request), ifMatchOf(request));
    return { state };
  });

  app.post('/attempts/:attemptId/summary', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<SummarySubmission>(contract, '/attempts/{attemptId}/summary', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, body.answers);
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'summary.submit', answers: body.answers }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'summary.submit')) return;
        for (const [i, answer] of body.answers.entries()) {
          await addLine(tx, row, {
            layer: 'L6',
            role: 'summary',
            idx: i + 1,
            slot: String(i + 1),
            statement: answer,
            provenance: body.input.provenance,
            recogId: body.input.recogId,
          });
        }
      },
    });
    return { state };
  });

  app.post('/attempts/:attemptId/park', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.park(auth.userId, attemptId(request), ifMatchOf(request));
    return { state };
  });

  // 只跳过当前层；层不符返回 409 WRONG_LAYER，不可跳过的层返回 409 LAYER_LOCKED。
  app.post('/attempts/:attemptId/layers/:layer/skip', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      layer: layerParam(param(request, 'layer')),
      build: () => ({ kind: 'layer.skip', reason: 'self' }),
    });
    return { state };
  });

  // 切换到已解锁的层（06 §4.1）：已完成/已跳过的层或最前沿；其它层 409。
  app.post('/attempts/:attemptId/layers/:layer/enter', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const layer = layerParam(param(request, 'layer'));
    const state = await svc.command({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'layer.enter', layer }),
    });
    return { state };
  });

  // 改一行 / 删一行（05 §4.2 M15）：重新归类，matched 重算，但提示阶梯与 reveal 不减少。
  app.patch('/attempts/:attemptId/lines/:lineId', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<LineSubmission>(contract, '/attempts/{attemptId}/lines/{lineId}', request, 'patch');
    const id = attemptId(request);
    await assertConfirmedInput(db, auth.userId, id, body.input, [body.statement]);
    if (body.justificationInput) await assertConfirmedInput(db, auth.userId, id, body.justificationInput, [body.justification ?? '']);
    const line = await ownStepLine(auth.userId, id, uuidParam(param(request, 'lineId')));
    const justification = body.justification ?? '';
    const statementChanged = body.statement !== line.statement;
    const justChanged = justification !== (line.justification ?? '');
    const field = statementChanged && justChanged ? 'both' : justChanged ? 'justification' : 'statement';
    const state = await svc.command({
      userId: auth.userId,
      attemptId: id,
      ifMatch: ifMatchOf(request),
      build: () => ({
        kind: 'line.edit',
        lineId: line.id,
        n: line.idx,
        s: body.statement,
        j: justification,
        field,
        provenance: body.input.provenance,
        oldKeys: line.counted,
        otherKeys: line.otherKeys,
      }),
      record: async (tx, row, result) => {
        const ev = result.events.find((e) => e.type === 'line.edit');
        if (!ev) return;
        await tx.query(
          `update app.attempt_lines
              set statement = $3, justification = $4, statement_canon = $5, justification_canon = $6, provenance = $7,
                  recog_id = $8, cls = $9, keys = $10, new_keys = $11, error_id = $12, edited_at = now()
            where id = $1 and attempt_id = $2`,
          [
            line.id,
            row.id,
            body.statement,
            body.justification ?? null,
            canon(body.statement),
            body.justification ? canon(body.justification) : null,
            body.input.provenance,
            body.input.recogId ?? null,
            String(ev.payload.cls),
            ev.payload.keys as string[],
            ev.payload.newKeys as string[],
            (ev.payload.errorId as string | undefined) ?? null,
          ],
        );
      },
    });
    return { state };
  });

  app.delete('/attempts/:attemptId/lines/:lineId', writable, async (request) => {
    const auth = await requireAuth(db, request);
    const id = attemptId(request);
    const line = await ownStepLine(auth.userId, id, uuidParam(param(request, 'lineId')));
    const state = await svc.command({
      userId: auth.userId,
      attemptId: id,
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'line.delete', lineId: line.id, oldKeys: line.counted, otherKeys: line.otherKeys }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'line.delete')) return;
        await tx.query(`update app.attempt_lines set deleted_at = now() where id = $1 and attempt_id = $2`, [line.id, row.id]);
      },
    });
    return { state };
  });

  // 草稿备份（前端以 IndexedDB 为主）：每个落点只留最新一份，不进事件，不影响作答状态。
  app.put('/attempts/:attemptId/draft', { preHandler: [requireStudentConsent(db)] }, async (request, reply) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<{ target: string; content: Record<string, unknown> }>(contract, '/attempts/{attemptId}/draft', request, 'put');
    const raw = JSON.stringify(body.content);
    if (body.target.length > 64 || raw.length > 64 * 1024) throw new AppError('VALIDATION_FAILED', 422, '草稿太大');
    const saved = await db.query(
      `insert into app.drafts (attempt_id, target, content)
       select a.id, $3, $4::jsonb from app.attempts a where a.id = $1 and a.user_id = $2
       on conflict (attempt_id, target) do update set content = excluded.content, updated_at = now()
       returning 1`,
      [attemptId(request), auth.userId, body.target, raw],
    );
    if (saved.rows.length === 0) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    return reply.code(204).send();
  });

  // 求助（06 §4.2）：按钮意图与自由提问共用一个入口，服务端判意图。
  app.post('/attempts/:attemptId/help', helpLimited, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<HelpSubmission>(contract, '/attempts/{attemptId}/help', request);
    return helpSvc.help(auth.userId, attemptId(request), helpInput(body), body.lineId === undefined ? {} : { lineId: body.lineId });
  });

  // 领取 H2–H4 提示（06 §4.2）：必须带 /help 返回的 previewToken。
  app.post('/attempts/:attemptId/hints/claim', helpLimited, async (request) => {
    const auth = await requireAuth(db, request);
    const body = parseBody<{ previewToken: string }>(contract, '/attempts/{attemptId}/hints/claim', request);
    return helpSvc.claim(auth.userId, attemptId(request), body.previewToken);
  });

  // 找老师（06 §4.2、U15）：额度用完，或卡住满 stuckMs 后可用。教师看板显示“求助”。
  app.post('/attempts/:attemptId/flag-teacher', helpLimited, async (request) => {
    const auth = await requireAuth(db, request);
    return { state: await helpSvc.flagTeacher(auth.userId, attemptId(request)) };
  });
};
