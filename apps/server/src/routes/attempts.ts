import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireAuth } from '../auth/session.ts';
import { studentHome } from '../attempts/home.ts';
import { addLine, createAttemptService } from '../attempts/service.ts';
import type { ContractValidator } from '../contract.ts';
import { AppError } from '../errors.ts';
import type { RouteInput } from '../help/intent.ts';
import { createIdempotency } from '../idempotency.ts';
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

function parseBody<T>(contract: ContractValidator, path: string, request: FastifyRequest): T {
  contract.validateRequest(path, 'post', request.body);
  return request.body as T;
}

export const attemptRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  const svc = createAttemptService(db, contract);
  const helpSvc = createHelpService({ db, attempts: svc, secret: config.sessionSecret });
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
};
