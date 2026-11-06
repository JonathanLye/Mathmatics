import { randomUUID } from 'node:crypto';

import {
  type AttemptState,
  type Command,
  type Context,
  type EngineEvent,
  type Rejection,
  type StepResult,
  canon,
  createAttempt,
  deserializeState,
  independenceOf,
  serializeState,
  step,
} from '@proof-gym/engine';

import type { ContractValidator } from '../contract.ts';
import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { nextSeq } from '../integrity/seq.ts';

import { loadProblem } from './problem.ts';
import { EMPTY_EXTRAS, loadViewExtras } from './extras.ts';
import { type AttemptRow, type Snapshot, toAttemptState } from './view.ts';

export interface StepSpec {
  userId: string;
  attemptId: string;
  ifMatch?: number;
  // 路由所在的层（如 /layers/L2/skip）；与当前层不符则 409 WRONG_LAYER。
  layer?: number;
  build(ctx: Context): Command;
  // 与状态变化同一事务写入的行（如第 3 层的一行），只在命令产生了对应事件时调用。
  record?(tx: Queryable, row: AttemptRow, result: StepResult): Promise<void>;
}

export interface LineInput {
  id?: string;
  layer: string;
  role: 'def' | 'frame' | 'step' | 'selfcheck' | 'summary';
  idx?: number;
  slot?: string | null;
  statement: string;
  justification?: string | null;
  provenance: string;
  // 手写/拍照来源：已确认的识别结果（app.recognitions.id）
  recogId?: string | null;
  cls?: string | null;
  keys?: string[];
  newKeys?: string[];
  errorId?: string | null;
}

type AssignmentRow = {
  id: string;
  problem_id: string;
  problem_version: number;
  mode: 'practice' | 'test';
  status: 'scheduled' | 'open' | 'closed' | 'cancelled';
  open_at: Date;
  close_at: Date | null;
};

export interface HelpRecordInput {
  intent: 'stuck' | 'concept' | 'check_line' | 'free';
  routed: 'stuck' | 'concept' | 'check_line' | 'pressure' | 'off_topic';
  routedBy: 'chip' | 'rule' | 'jev' | 'llm';
  // 学生自由输入的原文：只进 app.help_requests（08 §2 要求保留，研究用），事件里只有字数。
  text?: string;
  lineId?: string;
}

export interface AttemptService {
  // 08 §3 的服务端事件 help.request + app.help_requests 一行；返回 helpId。每次 /help 都要记，不论结果。
  // 作答不可写（锁定/搁置/已结束）或布置已关闭时不记录，返回 null：这些状态不接受任何写入
  // （作答状态由 schema status CHECK 与 guardWritable 约束；布置关闭见 06 §5 ASSIGNMENT_CLOSED；测验锁定见 11 §5.2）。
  recordHelp(userId: string, attemptId: string, input: HelpRecordInput): Promise<string | null>;
  setHelpOutcome(helpId: string | null, outcome: 'hint' | 'concept' | 'annotation' | 'refusal' | 'denied'): Promise<void>;
  start(userId: string, assignmentId: string): Promise<Record<string, unknown>>;
  get(userId: string, attemptId: string): Promise<Record<string, unknown>>;
  command(spec: StepSpec): Promise<Record<string, unknown>>;
  park(userId: string, attemptId: string, ifMatch?: number): Promise<Record<string, unknown>>;
  transfer(userId: string, attemptId: string, ifMatch?: number): Promise<Record<string, unknown>>;
  // 证明本/错题本的「重做」：父作答已完成才能建；强制练习模式；已有未结束的重做则返回它。
  redo(userId: string, attemptId: string): Promise<Record<string, unknown>>;
  // 教师软着陆（05 §4、11 §5.2）：额度耗尽后补发一条 H4。授权由调用方在事务内做（authorize 抛错即回滚）。
  // 作答若处于锁定状态，同时解除锁定（与 unlockAttempt 一致）。写 hint.deliver{override} 与 attempt.unlock{by, grantH4}。
  grantH4(spec: GrantH4Spec): Promise<void>;
}

export interface GrantH4Spec {
  attemptId: string;
  keyId?: string;
  teacherAnon: string;
  authorize(tx: Queryable, row: AttemptRow): Promise<void>;
}

// 作答的写入路径（05 §4、06 §5）：
// 1. 事务内 SELECT ... FOR UPDATE 锁住作答行；
// 2. 检查作答可写、If-Match 与 state_version；
// 3. 引擎 step 产生事件（事件只带 at 与 payload，不带学生原文）；
// 4. 追加 ev.events（seq 接在 last_event_seq 之后），并以 WHERE state_version = 旧版本 的 UPDATE 写入新状态；
// 5. 同一事务内写行（app.attempt_lines），提交。
export function createAttemptService(db: Db, contract: ContractValidator): AttemptService {
  const dto = (snap: Snapshot): Record<string, unknown> => {
    const state = toAttemptState(snap);
    contract.validate('AttemptState', state);
    return state;
  };

  async function lockOwned(tx: Queryable, attemptId: string, userId: string): Promise<AttemptRow> {
    const row = (
      await tx.query<AttemptRow>(`select * from app.attempts where id = $1 and user_id = $2 for update`, [
        attemptId,
        userId,
      ])
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    return row;
  }

  async function snapshotOf(q: Queryable, row: AttemptRow, now = Date.now()): Promise<Snapshot> {
    const problem = await loadProblem(q, row.problem_id, row.problem_version, { redo: row.kind === 'redo' });
    return { row, state: deserializeState(row.state), problem, now, extras: await loadViewExtras(q, row) };
  }

  async function userAnon(q: Queryable, userId: string): Promise<string> {
    const r = await q.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [userId]);
    return r.rows[0]?.anon_code ?? 'unknown';
  }

  // 06 §5：布置关闭（教师关闭、取消，或超过 close_at）后作答只读。start 里已有同样的判断；
  // 这里补上已开始的作答，否则测验截止后学生仍能继续改答案。用数据库时钟 now()；start 用应用时钟 Date.now()，
  // 两者在 close_at 边界上可能差毫秒级（可接受，写接口一律以数据库为准）。
  async function guardAssignmentOpen(tx: Queryable, row: AttemptRow): Promise<void> {
    // 重做（kind=redo）只在已完成的练习/自学或已结束的测验上创建（见 redo()），之后不受布置开关限制：
    // 布置关闭后学生仍可重做自己的作答。
    if (row.kind === 'redo') return;
    const closed = (
      await tx.query<{ closed: boolean }>(
        `select (status in ('closed', 'cancelled') or (close_at is not null and close_at <= now())) as closed
           from app.assignments where id = $1`,
        [row.assignment_id],
      )
    ).rows[0]?.closed;
    if (closed !== false) throw new AppError('ASSIGNMENT_CLOSED', 409, '布置已关闭，作答为只读');
  }

  function guardWritable(snap: Snapshot, ifMatch: number | undefined): void {
    if (snap.row.status === 'locked') throw new AppError('ATTEMPT_LOCKED', 409, '本题已锁定，请联系老师');
    if (snap.row.status !== 'active') throw new AppError('ATTEMPT_LOCKED', 409, '这次作答已搁置或已结束');
    if (ifMatch !== undefined && ifMatch !== snap.row.state_version) {
      throw new AppError('STATE_STALE', 409, '作答已在别处更新，请以最新状态为准', { state: dto(snap) });
    }
  }

  function rejection(reason: Rejection, snap: Snapshot): AppError {
    switch (reason) {
      case 'wrong_layer':
        return new AppError('WRONG_LAYER', 409, '这一步不在当前层', { state: dto(snap) });
      case 'not_allowed':
        return new AppError('LAYER_LOCKED', 409, '这一步现在不能做', { state: dto(snap) });
      case 'invalid':
        return new AppError('VALIDATION_FAILED', 422, '内容太短或不完整');
      case 'unknown_item':
        return new AppError('NOT_FOUND', 404, '没有这道自检题');
    }
  }

  // 追加事件，返回新的 last_event_seq。
  async function appendEvents(
    tx: Queryable,
    row: AttemptRow,
    events: readonly EngineEvent[],
    anon: string,
    fallbackLayer: string,
  ): Promise<number> {
    let seq = Number(row.last_event_seq);
    for (const event of events) {
      seq += 1;
      const layer = typeof event.payload.layer === 'string' ? event.payload.layer : fallbackLayer;
      await tx.query(
        `insert into ev.events
           (id, seq, type, source, ts_server, user_id, user_anon, role, assignment_id, attempt_id,
            problem_id, problem_version, layer, mode, payload)
         values (gen_random_uuid(), $1, $2, 'server', $3, $4, $5, 'student', $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          seq,
          event.type,
          new Date(event.at).toISOString(),
          row.user_id,
          anon,
          row.assignment_id,
          row.id,
          row.problem_id,
          row.problem_version,
          layer,
          row.mode,
          JSON.stringify(event.payload),
        ],
      );
    }
    return seq;
  }

  // 写入新状态（版本号 +1）。WHERE state_version = 旧版本 是第二道保险：锁内不应失败。
  async function commit(
    tx: Queryable,
    row: AttemptRow,
    next: { state: AttemptState; events: readonly EngineEvent[] },
    status: AttemptRow['status'],
    anon: string,
    fallbackLayer: string,
  ): Promise<AttemptRow> {
    const seq = await appendEvents(tx, row, next.events, anon, fallbackLayer);
    const done = next.state.done;
    const reveal = next.state.hint.reveal;
    const saved = (
      await tx.query<AttemptRow>(
        `update app.attempts
            set state = $3::jsonb,
                state_version = state_version + 1,
                current_layer = $4,
                status = $5,
                reveal = $6,
                keys_own = $7,
                independence = $8,
                last_event_seq = $9,
                completed_at = case when $10::boolean then now() else completed_at end,
                updated_at = now()
          where id = $1 and state_version = $2
          returning *`,
        [
          row.id,
          row.state_version,
          JSON.stringify(serializeState(next.state)),
          `L${next.state.layer}`,
          done ? 'completed' : status,
          reveal,
          next.state.hint.matched.size,
          done ? independenceOf(next.state, row.keys_total) : null,
          seq,
          done,
        ],
      )
    ).rows[0];
    if (!saved) throw new AppError('INTERNAL', 500, '作答状态写入冲突（持有行锁时不应出现）');
    return saved;
  }

  async function command(spec: StepSpec): Promise<Record<string, unknown>> {
    return db.tx(async (tx) => {
      const row = await lockOwned(tx, spec.attemptId, spec.userId);
      const snap = await snapshotOf(tx, row);
      guardWritable(snap, spec.ifMatch);
      await guardAssignmentOpen(tx, row);
      if (spec.layer !== undefined && snap.state.layer !== spec.layer) throw rejection('wrong_layer', snap);

      const result = step(snap.problem.ctx, snap.state, spec.build(snap.problem.ctx), snap.now);
      if (result.rejected) throw rejection(result.rejected, snap);
      if (result.events.length === 0) return dto(snap);

      const anon = await userAnon(tx, row.user_id);
      const saved = await commit(tx, row, result, row.status, anon, `L${snap.state.layer}`);
      if (spec.record) await spec.record(tx, saved, result);
      if (saved.kind === 'transfer' && saved.status === 'completed' && saved.parent_attempt_id !== null) {
        await completeTransferParent(tx, saved.parent_attempt_id, saved.user_id);
      }
      // 行和事件都在这个事务里刚写完：重新读，响应里才有刚写的那一行。
      return dto({ ...snap, row: saved, state: result.state, extras: await loadViewExtras(tx, saved) });
    });
  }

  // 迁移题子作答完成（含跳过）：同一事务里把 transfer.complete 应用到父作答，走和普通命令一样的
  // 事件 + 状态 + state_version 路径。父作答已越过第 5 层（或已结束）时引擎拒绝该命令，视为已处理，什么都不写。
  // 加锁顺序：子作答（调用方已锁）-> 父作答；transfer() 先锁父作答，但那时子作答还不存在，不会互相等待。
  async function completeTransferParent(tx: Queryable, parentId: string, userId: string): Promise<void> {
    const parent = (
      await tx.query<AttemptRow>(`select * from app.attempts where id = $1 and user_id = $2 for update`, [parentId, userId])
    ).rows[0];
    if (!parent || parent.status === 'completed' || parent.status === 'abandoned') return;
    const snap = await snapshotOf(tx, parent);
    const result = step(snap.problem.ctx, snap.state, { kind: 'transfer.complete' }, snap.now);
    if (result.rejected || result.events.length === 0) return;
    const anon = await userAnon(tx, parent.user_id);
    await commit(tx, parent, result, parent.status, anon, `L${snap.state.layer}`);
  }

  async function grantH4(spec: GrantH4Spec): Promise<void> {
    await db.tx(async (tx) => {
      const row = (await tx.query<AttemptRow>(`select * from app.attempts where id = $1 for update`, [spec.attemptId])).rows[0];
      if (!row) throw new AppError('NOT_FOUND', 404, '作答不存在');
      await spec.authorize(tx, row);
      if (row.status !== 'active' && row.status !== 'locked') {
        throw new AppError('VALIDATION_FAILED', 409, '这次作答已搁置或已结束，不能补发提示');
      }
      const snap = await snapshotOf(tx, row);
      const result = step(snap.problem.ctx, snap.state, { kind: 'teacher.grant_h4', key: spec.keyId }, snap.now);
      if (result.rejected === 'not_allowed') {
        throw new AppError('VALIDATION_FAILED', 409, '学生的提示额度还没有用完；补发只在额度耗尽后使用');
      }
      if (result.rejected === 'wrong_layer') {
        throw new AppError('VALIDATION_FAILED', 409, '补发提示只在第 3 层写证明时使用');
      }
      if (result.rejected === 'invalid') {
        throw new AppError('VALIDATION_FAILED', 422, '这个关键步骤不存在、已经完成，或已经补发过');
      }
      if (!result.events.some((e) => e.type === 'hint.deliver')) {
        // 闸门拦下（gate.block）：不下发，也不留下半个状态
        throw new AppError('VALIDATION_FAILED', 409, '这条提示没有通过防泄题检查，未补发');
      }
      const anon = await userAnon(tx, row.user_id);
      const saved = await commit(tx, row, result, 'active', anon, `L${snap.state.layer}`);
      if (row.status === 'locked') await tx.query(`update app.attempts set locked_reason = null where id = $1`, [row.id]);
      const seq = await nextSeq(tx, row.id);
      await tx.query(
        `insert into ev.events
           (id, seq, type, source, ts_server, user_id, user_anon, role, assignment_id, attempt_id,
            problem_id, problem_version, layer, mode, payload)
         values (gen_random_uuid(), $1, 'attempt.unlock', 'teacher', now(), $2, $3, 'student', $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [
          seq,
          saved.user_id,
          anon,
          saved.assignment_id,
          saved.id,
          saved.problem_id,
          saved.problem_version,
          `L${result.state.layer}`,
          saved.mode,
          JSON.stringify({ by: spec.teacherAnon, grantH4: spec.keyId ?? (result.events[0]?.payload.key as string) }),
        ],
      );
    });
  }

  async function start(userId: string, assignmentId: string): Promise<Record<string, unknown>> {
    return db.tx(async (tx) => {
      const assignment = (
        await tx.query<AssignmentRow>(
          `select a.id, a.problem_id, a.problem_version, a.mode, a.status, a.open_at, a.close_at
             from app.assignments a
             join app.class_members m on m.class_id = a.class_id
            where a.id = $1 and m.user_id = $2`,
          [assignmentId, userId],
        )
      ).rows[0];
      if (!assignment) throw new AppError('NOT_FOUND', 404, '找不到这份布置');

      const now = Date.now();
      const open =
        assignment.status === 'open' &&
        new Date(assignment.open_at).getTime() <= now &&
        (assignment.close_at === null || new Date(assignment.close_at).getTime() > now);
      if (!open) throw new AppError('ASSIGNMENT_CLOSED', 409, '布置尚未开放或已关闭');

      const existing = (
        await tx.query<AttemptRow>(
          `select * from app.attempts where assignment_id = $1 and user_id = $2 and kind = 'main' for update`,
          [assignmentId, userId],
        )
      ).rows[0];
      if (existing) {
        if (existing.status !== 'parked') return dto(await snapshotOf(tx, existing, now));
        // 搁置后再次开始：恢复为进行中，事件记 resumed=true。
        const snap = await snapshotOf(tx, existing, now);
        const anon = await userAnon(tx, userId);
        const events = [{ type: 'attempt.start', at: now, payload: { resumed: true, kind: 'main' } }];
        const saved = await commit(tx, existing, { state: snap.state, events }, 'active', anon, 'L1');
        return dto({ ...snap, row: saved });
      }

      const problem = await loadProblem(tx, assignment.problem_id, assignment.problem_version);
      const initial = createAttempt(problem.ctx, now);
      const inserted = (
        await tx.query<AttemptRow>(
          `insert into app.attempts
             (assignment_id, user_id, problem_id, problem_version, kind, mode, state, keys_total)
           values ($1, $2, $3, $4, 'main', $5, $6::jsonb, $7)
           on conflict (assignment_id, user_id) where kind = 'main' do nothing
           returning *`,
          [
            assignmentId,
            userId,
            assignment.problem_id,
            assignment.problem_version,
            assignment.mode,
            JSON.stringify(serializeState(initial)),
            problem.ctx.pkg.secret.keys.length,
          ],
        )
      ).rows[0];
      if (!inserted) {
        // 并发的另一次开始已经写入：读它。
        const again = (
          await tx.query<AttemptRow>(
            `select * from app.attempts where assignment_id = $1 and user_id = $2 and kind = 'main'`,
            [assignmentId, userId],
          )
        ).rows[0];
        if (!again) throw new AppError('INTERNAL', 500, '作答创建冲突且找不到已有作答');
        return dto(await snapshotOf(tx, again, now));
      }
      const anon = await userAnon(tx, userId);
      const events = [{ type: 'attempt.start', at: now, payload: { resumed: false, kind: 'main' } }];
      const saved = await commit(tx, inserted, { state: initial, events }, 'active', anon, 'L1');
      return dto({ row: saved, state: initial, problem, now, extras: EMPTY_EXTRAS });
    });
  }

  async function recordHelp(userId: string, attemptId: string, input: HelpRecordInput): Promise<string | null> {
    return db.tx(async (tx) => {
      const row = await lockOwned(tx, attemptId, userId);
      if (row.status !== 'active') return null;
      try {
        await guardAssignmentOpen(tx, row);
      } catch (error) {
        if (error instanceof AppError && error.code === 'ASSIGNMENT_CLOSED') return null;
        throw error;
      }
      const helpId = randomUUID();
      const anon = await userAnon(tx, row.user_id);
      const payload: Record<string, unknown> = {
        helpId,
        intent: input.intent,
        routed: input.routed,
        routedBy: input.routedBy,
        ...(input.text === undefined ? {} : { textChars: [...input.text].length }),
      };
      const layer = `L${row.state.layer}`;
      const seq = await appendEvents(tx, row, [{ type: 'help.request', at: Date.now(), payload }], anon, layer);
      await tx.query(`update app.attempts set last_event_seq = $2 where id = $1`, [row.id, seq]);

      // line_id 外键：只接受这次作答自己的行，其它一律不记（不信任客户端传来的 id）。
      let lineId: string | null = null;
      if (input.lineId !== undefined) {
        const found = await tx.query(`select 1 from app.attempt_lines where id = $1 and attempt_id = $2`, [input.lineId, row.id]);
        lineId = found.rows.length > 0 ? input.lineId : null;
      }
      await tx.query(
        `insert into app.help_requests (id, attempt_id, layer, intent, routed, routed_by, text, line_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [helpId, row.id, layer, input.intent, input.routed, input.routedBy, input.text ?? null, lineId],
      );
      return helpId;
    });
  }

  // 行与事件已在 recordHelp 的事务里提交；这里是一次独立 UPDATE。两步之间崩溃会让 outcome 留在 NULL，
  // 语义上可接受（不丢求助记录，只是缺结果），不为此把 service 边界改成跨事务。
  async function setHelpOutcome(
    helpId: string | null,
    outcome: 'hint' | 'concept' | 'annotation' | 'refusal' | 'denied',
  ): Promise<void> {
    if (helpId === null) return;
    await db.query(`update app.help_requests set outcome = $2 where id = $1`, [helpId, outcome]);
  }

  async function get(userId: string, attemptId: string): Promise<Record<string, unknown>> {
    const row = (
      await db.query<AttemptRow>(`select * from app.attempts where id = $1 and user_id = $2`, [attemptId, userId])
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    return dto(await snapshotOf(db, row));
  }

  async function park(userId: string, attemptId: string, ifMatch?: number): Promise<Record<string, unknown>> {
    return db.tx(async (tx) => {
      const row = await lockOwned(tx, attemptId, userId);
      const snap = await snapshotOf(tx, row);
      guardWritable(snap, ifMatch);
      await guardAssignmentOpen(tx, row);
      const anon = await userAnon(tx, row.user_id);
      const layer = `L${snap.state.layer}`;
      const events = [{ type: 'attempt.park', at: snap.now, payload: { layer } }];
      const saved = await commit(tx, row, { state: snap.state, events }, 'parked', anon, layer);
      return dto({ ...snap, row: saved });
    });
  }

  // 第 5 层开始迁移题：创建子作答（kind=transfer，沿用布置），父作答保持第 5 层未完成。
  async function transfer(userId: string, attemptId: string, ifMatch?: number): Promise<Record<string, unknown>> {
    return db.tx(async (tx) => {
      const row = await lockOwned(tx, attemptId, userId);
      const snap = await snapshotOf(tx, row);
      guardWritable(snap, ifMatch);
      await guardAssignmentOpen(tx, row);
      if (row.kind !== 'main' || snap.state.layer !== 5) throw rejection('wrong_layer', snap);

      const existing = (
        await tx.query<AttemptRow>(`select * from app.attempts where parent_attempt_id = $1 and kind = 'transfer'`, [
          row.id,
        ])
      ).rows[0];
      if (existing) return dto(await snapshotOf(tx, existing));

      const transferId = snap.problem.public.transferProblemId;
      if (!transferId) throw new AppError('INTERNAL', 500, '题目没有配置迁移题');
      const version = (
        await tx.query<{ version: number }>(
          `select max(version) as version from content.problem_versions
            where problem_id = $1 and review_status = 'published'`,
          [transferId],
        )
      ).rows[0]?.version;
      if (version === undefined || version === null) throw new AppError('INTERNAL', 500, '迁移题没有已发布版本');

      const problem = await loadProblem(tx, transferId, version);
      const now = Date.now();
      const initial = createAttempt(problem.ctx, now);
      const inserted = (
        await tx.query<AttemptRow>(
          `insert into app.attempts
             (assignment_id, user_id, problem_id, problem_version, kind, parent_attempt_id, mode, state, keys_total)
           values ($1, $2, $3, $4, 'transfer', $5, $6, $7::jsonb, $8)
           on conflict (parent_attempt_id) where kind = 'transfer' do nothing
           returning *`,
          [
            row.assignment_id,
            row.user_id,
            transferId,
            version,
            row.id,
            row.mode,
            JSON.stringify(serializeState(initial)),
            problem.ctx.pkg.secret.keys.length,
          ],
        )
      ).rows[0];
      if (!inserted) throw new AppError('INTERNAL', 500, '迁移题创建冲突');
      const anon = await userAnon(tx, row.user_id);
      const events = [
        { type: 'attempt.start', at: now, payload: { resumed: false, kind: 'transfer', parentAttemptId: row.id } },
      ];
      const saved = await commit(tx, inserted, { state: initial, events }, 'active', anon, 'L3');
      return dto({ row: saved, state: initial, problem, now, extras: EMPTY_EXTRAS });
    });
  }

  // 重做：新建 kind=redo 的子作答（parent_attempt_id=被重做的作答），沿用布置与题目版本，引擎状态从头开始，
  // 模式固定为练习。第 5 层不走（loadProblem 的 redo 选项）。服务端只允许重做自己的、已完成的作答；
  // 测验布置在开放/未开始期间不允许（测验结束后才行）。
  async function redo(userId: string, attemptId: string): Promise<Record<string, unknown>> {
    return db.tx(async (tx) => {
      const parent = (await tx.query<AttemptRow>(`select * from app.attempts where id = $1 for update`, [attemptId])).rows[0];
      if (!parent) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
      if (parent.user_id !== userId) throw new AppError('FORBIDDEN', 403, '只能重做自己的作答');
      if (parent.kind === 'transfer') throw new AppError('VALIDATION_FAILED', 409, '迁移题不能单独重做');
      if (parent.status !== 'completed') throw new AppError('VALIDATION_FAILED', 409, '这道题还没写完，写完以后才能重做');

      const asg = (
        await tx.query<{ mode: string; open_test: boolean }>(
          `select mode,
                  (mode = 'test' and status in ('scheduled', 'open') and (close_at is null or close_at > now())) as open_test
             from app.assignments where id = $1`,
          [parent.assignment_id],
        )
      ).rows[0];
      if (!asg) throw new AppError('NOT_FOUND', 404, '找不到这份布置');
      if (asg.open_test) throw new AppError('TEST_MODE_RESTRICTED', 403, '测验还没结束，结束以后才能重做');

      const existing = (
        await tx.query<AttemptRow>(
          `select * from app.attempts
            where parent_attempt_id = $1 and kind = 'redo' and status in ('active', 'parked', 'locked') for update`,
          [parent.id],
        )
      ).rows[0];
      const now = Date.now();
      const anon = await userAnon(tx, userId);
      if (existing) {
        const snap = await snapshotOf(tx, existing, now);
        if (existing.status !== 'parked') return dto(snap);
        const events = [{ type: 'attempt.start', at: now, payload: { resumed: true, kind: 'redo', parentAttemptId: parent.id } }];
        const saved = await commit(tx, existing, { state: snap.state, events }, 'active', anon, `L${snap.state.layer}`);
        return dto({ ...snap, row: saved });
      }

      const problem = await loadProblem(tx, parent.problem_id, parent.problem_version, { redo: true });
      const initial = createAttempt(problem.ctx, now);
      const inserted = (
        await tx.query<AttemptRow>(
          `insert into app.attempts
             (assignment_id, user_id, problem_id, problem_version, kind, parent_attempt_id, mode, state, keys_total)
           values ($1, $2, $3, $4, 'redo', $5, 'practice', $6::jsonb, $7)
           returning *`,
          [
            parent.assignment_id,
            userId,
            parent.problem_id,
            parent.problem_version,
            parent.id,
            JSON.stringify(serializeState(initial)),
            problem.ctx.pkg.secret.keys.length,
          ],
        )
      ).rows[0];
      if (!inserted) throw new AppError('INTERNAL', 500, '重做创建冲突');
      const events = [{ type: 'attempt.start', at: now, payload: { resumed: false, kind: 'redo', parentAttemptId: parent.id } }];
      const first = `L${initial.layer}`;
      const saved = await commit(tx, inserted, { state: initial, events }, 'active', anon, first);
      return dto({ row: saved, state: initial, problem, now, extras: EMPTY_EXTRAS });
    });
  }

  return {
    recordHelp,
    setHelpOutcome,
    redo,
    start,
    get,
    command,
    park,
    transfer,
    grantH4,
  };
}

// 第 n 行写入 app.attempt_lines：学生原文只存这里，事件里没有。
export async function addLine(tx: Queryable, row: AttemptRow, line: LineInput): Promise<void> {
  const idx = line.idx ?? (await nextIdx(tx, row.id, line.layer, line.role));
  await tx.query(
    `insert into app.attempt_lines
       (id, attempt_id, layer, role, idx, slot, statement, justification, statement_canon, justification_canon,
        provenance, recog_id, cls, keys, new_keys, error_id, classifier_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'rule')`,
    [
      line.id ?? randomUUID(),
      row.id,
      line.layer,
      line.role,
      idx,
      line.slot ?? null,
      line.statement,
      line.justification ?? null,
      canon(line.statement),
      line.justification ? canon(line.justification) : null,
      line.provenance,
      line.recogId ?? null,
      line.cls ?? null,
      line.keys ?? [],
      line.newKeys ?? [],
      line.errorId ?? null,
    ],
  );
}

async function nextIdx(q: Queryable, attemptId: string, layer: string, role: string): Promise<number> {
  const r = await q.query<{ next: number }>(
    `select coalesce(max(idx), 0) + 1 as next from app.attempt_lines
      where attempt_id = $1 and layer = $2 and role = $3`,
    [attemptId, layer, role],
  );
  return Number(r.rows[0]?.next ?? 1);
}
