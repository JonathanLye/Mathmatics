import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { canon } from '@proof-gym/engine';

import { mathParses } from '@proof-gym/content-checks';

import type { ModelGateway } from '../ai/gateway.ts';
import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireStudent } from '../auth/session.ts';
import { studentAssignment, studentHome } from '../attempts/home.ts';
import { loadReview, studentMistakes, studentNotebook } from '../attempts/notebook.ts';
import { loadProblem } from '../attempts/problem.ts';
import { addLine, createAttemptService, type StepSpec } from '../attempts/service.ts';
import type { RewardsDto } from '../progress/service.ts';
import type { ContractValidator } from '../contract.ts';
import { AppError } from '../errors.ts';
import type { RouteInput } from '../help/intent.ts';
import { createIdempotency } from '../idempotency.ts';
import { createLessonService } from '../help/lesson.ts';
import { modelAllowed } from '../help/budget.ts';
import { rubricOf, judgeSemantic, classifyFallback, type SemanticRubric } from '../help/semantic.ts';
import { insertAnnotation } from '../help/store.ts';
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

// 13 §5：响应里有模型生成的内容时带 X-AIGC: 1。
function markAigc(reply: FastifyReply, result: Record<string, unknown>): void {
  if ((result.note as { aiGenerated?: boolean } | undefined)?.aiGenerated === true) reply.header('X-AIGC', '1');
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

export const attemptRoutes: FastifyPluginAsync<AuthRouteOptions & { gateway?: ModelGateway }> = async (app, { db, config, contract, gateway }) => {
  const svc = createAttemptService(db, contract);
  const helpSvc = createHelpService({
    db,
    attempts: svc,
    secret: config.sessionSecret,
    ...(gateway ? { gateway } : {}),
    flags: () => config.models.flags,
    ai: config.ai,
    parsesMath: mathParses,
  });
  const flagOn = (name: string): boolean => gateway !== undefined && config.models.flags[name] === true;
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
  // 作答写入 + 经验结算：响应在 { state } 之外，有新经验/徽章时多一个 rewards（add-only；镜像与教师端视图不带）。
  const run = async (spec: StepSpec): Promise<{ state: Record<string, unknown>; rewards?: RewardsDto }> => {
    let rewards: RewardsDto | undefined;
    const state = await svc.command({
      ...spec,
      onRewards: (r) => {
        rewards = r;
      },
    });
    return rewards ? { state, rewards } : { state };
  };

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

  // ---- 模型参与的判定（U15）。都是“规则先行，规则不过再问模型”，失败一律回到规则结果。
  async function attemptInfo(userId: string, attempt: string) {
    const row = (
      await db.query<{ problem_id: string; problem_version: number; mode: string }>(
        `select problem_id, problem_version, mode from app.attempts where id = $1 and user_id = $2`,
        [attempt, userId],
      )
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    return row;
  }

  // L1/L2 语义判定（09 §4 C1/C2）：规则通过 → 不问模型；规则不过且 help.llm 开 → 模型按要点判断。
  // 测验模式不调用（“还缺：…”是给学生看的反馈）。返回 semanticPass，以及模型指出的缺项（用于“还缺：…”批注）。
  async function semanticCheck(
    userId: string,
    attempt: string,
    layer: 'L1' | 'L2',
    text: string,
    kind: 'def.submit' | 'frame.submit',
  ): Promise<{ semanticPass: boolean; missingText: string | null }> {
    const none = { semanticPass: false, missingText: null };
    if (!gateway || !flagOn('help.llm')) return none;
    const info = await attemptInfo(userId, attempt);
    if (info.mode === 'test') return none;
    const dry = await svc.dryRun(userId, attempt, () => ({ kind, lineId: randomUUID(), text }));
    const event = dry.events.find((e) => e.type === kind);
    if (!event || event.payload.pass === true) return none;
    if (!(await modelAllowed(db, config.ai, userId, ['def_check'], 60))) return none;
    const problem = await loadProblem(db, info.problem_id, info.problem_version);
    const rubric = rubricOf(problem.ctx.pkg.secret, layer);
    if (!rubric) return none;
    const verdict = await judgeSemantic({ gateway, attemptId: attempt, timeoutMs: config.ai.classifyTimeoutMs }, rubric, text);
    if (verdict.status === 'pass') return { semanticPass: true, missingText: null };
    if (verdict.status === 'fail') return { semanticPass: false, missingText: missingTextOf(rubric, verdict.missing) };
    return none;
  }

  function missingTextOf(rubric: SemanticRubric, ids: string[]): string {
    const items = rubric.items.filter((item) => ids.includes(item.id));
    return rubric.layer === 'L1' ? `还缺：${items.map((item) => item.label).join('、')}` : items.map((item) => item.missing).join(' ');
  }

  async function noteMissing(tx: Parameters<typeof insertAnnotation>[0], attempt: string, text: string | null): Promise<void> {
    if (text === null) return;
    await insertAnnotation(tx, { id: randomUUID(), attemptId: attempt, lineId: null, kind: 'annotation', source: 'llm', text });
  }

  // 第 3 层兜底归类（flag llm.fallbackClassify）：规则判 unknown 时，模型按本题关键步骤的名字给这一行归类，只输出步骤 ID。
  // 不产生任何给学生看的文字，所以测验模式也运行。超时 / 低置信 / 非 JSON / 不存在的 ID → 空数组（保持 unknown）。
  async function fallbackKeys(userId: string, attempt: string, statement: string, justification: string): Promise<string[]> {
    if (!gateway || !flagOn('llm.fallbackClassify') || statement.trim().length < 2) return [];
    const dry = await svc.dryRun(userId, attempt, () => ({
      kind: 'line.submit',
      lineId: randomUUID(),
      s: statement,
      j: justification,
      provenance: 'keyboard',
    }));
    if (dry.events.find((e) => e.type === 'line.submit')?.payload.cls !== 'unknown') return [];
    if (!(await modelAllowed(db, config.ai, userId, ['classify_step'], 60))) return [];
    const info = await attemptInfo(userId, attempt);
    const problem = await loadProblem(db, info.problem_id, info.problem_version);
    const earlier = (await svc.stepLines(userId, attempt)).map((l) => `${l.statement}${l.justification ? `（依据：${l.justification}）` : ''}`);
    return classifyFallback(
      { gateway, attemptId: attempt, timeoutMs: config.ai.classifyTimeoutMs },
      {
        stem: problem.public.stem,
        keys: problem.ctx.pkg.secret.keys.map((k) => ({ id: k.id, label: k.label })),
        earlier,
        statement,
        justification,
      },
    );
  }

  // 学生首页（06 §3.1）：只读聚合，不要求同意书（未签同意也能先看到作业列表）。
  app.get('/student/home', async (request) => {
    const auth = await requireStudent(db, request);
    return studentHome(db, contract, auth.userId);
  });

  // 证明本 / 错题本（06 §3.1）：只读，本人已完成的作答；不要求同意书（和首页一致）。
  app.get('/student/notebook', async (request) => {
    const auth = await requireStudent(db, request);
    return studentNotebook(db, contract, auth.userId);
  });

  app.get('/student/mistakes', async (request) => {
    const auth = await requireStudent(db, request);
    return studentMistakes(db, contract, auth.userId);
  });

  // 重做：在已完成的作答上新建 kind=redo 的子作答（强制练习模式）。已有未结束的重做则返回它。
  app.post('/student/attempts/:attemptId/redo', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const state = await svc.redo(auth.userId, attemptId(request));
    return { state };
  });

  // 讲评：教师发布后，本人写完（或布置结束）才可读；参考证明读取记审计。
  app.get('/attempts/:attemptId/review', async (request) => {
    const auth = await requireStudent(db, request);
    return loadReview(db, contract, auth.userId, attemptId(request));
  });

  app.post('/student/assignments/:assignmentId/attempt', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const state = await svc.start(auth.userId, uuidParam(param(request, 'assignmentId')));
    return { state };
  });

  app.get('/attempts/:attemptId', async (request) => {
    const auth = await requireStudent(db, request);
    return { state: await svc.get(auth.userId, attemptId(request)) };
  });

  app.get('/student/assignments/:assignmentId', async (request) => {
    const auth = await requireStudent(db, request);
    return studentAssignment(db, contract, auth.userId, uuidParam(param(request, 'assignmentId')));
  });

  // 预写微课（06 §4.4）：只读，已过闸门；小核验的答案不下发，由 /check 判定。
  app.get('/attempts/:attemptId/lesson/:conceptId', async (request) => {
    const auth = await requireStudent(db, request);
    return lessonSvc.get(auth.userId, attemptId(request), conceptParam(request));
  });

  app.post('/attempts/:attemptId/lesson/:conceptId/check', { preHandler: [requireStudentConsent(db)] }, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<{ stepId: string; choice: number }>(contract, '/attempts/{attemptId}/lesson/{conceptId}/check', request);
    return lessonSvc.check(auth.userId, attemptId(request), conceptParam(request), body);
  });

  app.post('/attempts/:attemptId/definition', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/definition', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const lineId = randomUUID();
    const semantic = await semanticCheck(auth.userId, attemptId(request), 'L1', body.text, 'def.submit');
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'def.submit', lineId, text: body.text, ...(semantic.semanticPass ? { semanticPass: true } : {}) }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'def.submit')) return;
        await addLine(tx, row, { id: lineId, layer: 'L1', role: 'def', statement: body.text, provenance: body.input.provenance, recogId: body.input.recogId });
        await noteMissing(tx, row.id, semantic.missingText);
      },
    });
  });

  app.post('/attempts/:attemptId/framework', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/framework', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const lineId = randomUUID();
    const semantic = await semanticCheck(auth.userId, attemptId(request), 'L2', body.text, 'frame.submit');
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'frame.submit', lineId, text: body.text, ...(semantic.semanticPass ? { semanticPass: true } : {}) }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'frame.submit')) return;
        await addLine(tx, row, { id: lineId, layer: 'L2', role: 'frame', statement: body.text, provenance: body.input.provenance, recogId: body.input.recogId });
        await noteMissing(tx, row.id, semantic.missingText);
      },
    });
  });

  app.post('/attempts/:attemptId/framework/template', writable, async (request) => {
    const auth = await requireStudent(db, request);
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'frame.template' }),
    });
  });

  app.post('/attempts/:attemptId/lines', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<LineSubmission>(contract, '/attempts/{attemptId}/lines', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.statement]);
    if (body.justificationInput) {
      await assertConfirmedInput(db, auth.userId, attemptId(request), body.justificationInput, [body.justification ?? '']);
    }
    const lineId = randomUUID();
    const modelKeys = await fallbackKeys(auth.userId, attemptId(request), body.statement, body.justification ?? '');
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({
        kind: 'line.submit',
        lineId,
        s: body.statement,
        j: body.justification ?? '',
        provenance: body.input.provenance,
        ...(modelKeys.length > 0 ? { modelKeys } : {}),
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
          classifierPath: ev.payload.matchedBy === 'model' ? 'llm' : 'rule',
        });
      },
    });
  });

  app.post('/attempts/:attemptId/finish', writable, async (request) => {
    const auth = await requireStudent(db, request);
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'finish.try' }),
    });
  });

  app.post('/attempts/:attemptId/selfcheck/:itemId', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<TextSubmission>(contract, '/attempts/{attemptId}/selfcheck/{itemId}', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, [body.text]);
    const itemId = param(request, 'itemId');
    return run({
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
  });

  app.post('/attempts/:attemptId/transfer', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const state = await svc.transfer(auth.userId, attemptId(request), ifMatchOf(request));
    return { state };
  });

  app.post('/attempts/:attemptId/summary', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<SummarySubmission>(contract, '/attempts/{attemptId}/summary', request);
    await assertConfirmedInput(db, auth.userId, attemptId(request), body.input, body.answers);
    return run({
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
  });

  app.post('/attempts/:attemptId/park', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const state = await svc.park(auth.userId, attemptId(request), ifMatchOf(request));
    return { state };
  });

  // 只跳过当前层；层不符返回 409 WRONG_LAYER，不可跳过的层返回 409 LAYER_LOCKED。
  app.post('/attempts/:attemptId/layers/:layer/skip', writable, async (request) => {
    const auth = await requireStudent(db, request);
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      layer: layerParam(param(request, 'layer')),
      build: () => ({ kind: 'layer.skip', reason: 'self' }),
    });
  });

  // 切换到已解锁的层（06 §4.1）：已完成/已跳过的层或最前沿；其它层 409。
  app.post('/attempts/:attemptId/layers/:layer/enter', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const layer = layerParam(param(request, 'layer'));
    return run({
      userId: auth.userId,
      attemptId: attemptId(request),
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'layer.enter', layer }),
    });
  });

  // 改一行 / 删一行（05 §4.2 M15）：重新归类，matched 重算，但提示阶梯与 reveal 不减少。
  app.patch('/attempts/:attemptId/lines/:lineId', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<LineSubmission>(contract, '/attempts/{attemptId}/lines/{lineId}', request, 'patch');
    const id = attemptId(request);
    await assertConfirmedInput(db, auth.userId, id, body.input, [body.statement]);
    if (body.justificationInput) await assertConfirmedInput(db, auth.userId, id, body.justificationInput, [body.justification ?? '']);
    const line = await ownStepLine(auth.userId, id, uuidParam(param(request, 'lineId')));
    const justification = body.justification ?? '';
    const statementChanged = body.statement !== line.statement;
    const justChanged = justification !== (line.justification ?? '');
    const field = statementChanged && justChanged ? 'both' : justChanged ? 'justification' : 'statement';
    const modelKeys = await fallbackKeys(auth.userId, id, body.statement, justification);
    return run({
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
        ...(modelKeys.length > 0 ? { modelKeys } : {}),
      }),
      record: async (tx, row, result) => {
        const ev = result.events.find((e) => e.type === 'line.edit');
        if (!ev) return;
        await tx.query(
          `update app.attempt_lines
              set statement = $3, justification = $4, statement_canon = $5, justification_canon = $6, provenance = $7,
                  recog_id = $8, cls = $9, keys = $10, new_keys = $11, error_id = $12, classifier_path = $13, edited_at = now()
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
            ev.payload.matchedBy === 'model' ? 'llm' : 'rule',
          ],
        );
      },
    });
  });

  app.delete('/attempts/:attemptId/lines/:lineId', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const id = attemptId(request);
    const line = await ownStepLine(auth.userId, id, uuidParam(param(request, 'lineId')));
    return run({
      userId: auth.userId,
      attemptId: id,
      ifMatch: ifMatchOf(request),
      build: () => ({ kind: 'line.delete', lineId: line.id, oldKeys: line.counted, otherKeys: line.otherKeys }),
      record: async (tx, row, result) => {
        if (!result.events.some((e) => e.type === 'line.delete')) return;
        await tx.query(`update app.attempt_lines set deleted_at = now() where id = $1 and attempt_id = $2`, [line.id, row.id]);
      },
    });
  });

  // 草稿备份（前端以 IndexedDB 为主）：每个落点只留最新一份，不进事件，不影响作答状态。
  app.put('/attempts/:attemptId/draft', { preHandler: [requireStudentConsent(db)] }, async (request, reply) => {
    const auth = await requireStudent(db, request);
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
  app.post('/attempts/:attemptId/help', helpLimited, async (request, reply) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<HelpSubmission>(contract, '/attempts/{attemptId}/help', request);
    const result = await helpSvc.help(auth.userId, attemptId(request), helpInput(body), body.lineId === undefined ? {} : { lineId: body.lineId });
    markAigc(reply, result);
    return result;
  });

  // 学生对一条 AI 回答点“有用 / 没用”（13 §5）。只能点自己作答里的批注。
  app.post('/student/notes/:noteId/feedback', writable, async (request, reply) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<{ useful: boolean }>(contract, '/student/notes/{noteId}/feedback', request);
    const noteId = param(request, 'noteId');
    if (!UUID.test(noteId)) throw new AppError('NOT_FOUND', 404, '找不到这条批注');
    const updated = await db.query(
      `update app.annotations an set useful = $3 from app.attempts a
        where an.id = $1 and a.id = an.attempt_id and a.user_id = $2 returning an.id`,
      [noteId, auth.userId, body.useful],
    );
    if (updated.rows.length === 0) throw new AppError('NOT_FOUND', 404, '找不到这条批注');
    return reply.code(204).send();
  });

  // 领取 H2–H4 提示（06 §4.2）：必须带 /help 返回的 previewToken。
  app.post('/attempts/:attemptId/hints/claim', helpLimited, async (request, reply) => {
    const auth = await requireStudent(db, request);
    const body = parseBody<{ previewToken: string }>(contract, '/attempts/{attemptId}/hints/claim', request);
    const result = await helpSvc.claim(auth.userId, attemptId(request), body.previewToken);
    markAigc(reply, result);
    return result;
  });

  // 找老师（06 §4.2、U15）：额度用完，或卡住满 stuckMs 后可用。教师看板显示“求助”。
  app.post('/attempts/:attemptId/flag-teacher', helpLimited, async (request) => {
    const auth = await requireStudent(db, request);
    return { state: await helpSvc.flagTeacher(auth.userId, attemptId(request)) };
  });
};
