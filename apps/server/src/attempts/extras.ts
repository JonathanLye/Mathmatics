import type { Queryable } from '../db/index.ts';
import { loadStoredNotes } from '../help/store.ts';

import type { AttemptRow } from './view.ts';

// AttemptState 里需要从库里读的那部分（契约的 StepsView / DefView.last / FrameView / TransferView / SummaryView）。
// toAttemptState 保持纯函数，所以由调用方（作答服务、教师镜像）先读好再传进去。
// 不读 cls / keys / newKeys / errorId：这些是服务端判断，不属于学生 DTO（ProofLine 只有 lineId、n、statement、justification、
// provenance、flagged、createdAt）。已软删除的行不算。
export interface ProofLineRow {
  lineId: string;
  n: number;
  statement: string;
  justification: string | null;
  provenance: string;
  flagged: boolean;
  createdAt: string;
}

export interface ViewExtras {
  lines: ProofLineRow[];
  defLast: string | null;
  frameLast: string | null;
  templateShown: boolean;
  summaryAnswers: string[];
  // 最近一次 summary.submit 缺了哪些要点（用于挑追问）；没提交过为 null。
  summaryMissing: string[] | null;
  transfer: { childAttemptId: string; stem: string | null } | null;
  // 完成后能不能看讲评：自学作答完成即可；教师布置要布置关闭且教师已发布。
  reviewAvailable: boolean;
  // 已下发的提示与批注（app.hint_deliveries / app.annotations），刷新后读回。noteId = 行 ID。
  notes: Record<string, unknown>[];
}

// 刚创建的作答：还没有任何行与事件。
export const EMPTY_EXTRAS: ViewExtras = {
  lines: [],
  defLast: null,
  frameLast: null,
  templateShown: false,
  summaryAnswers: [],
  summaryMissing: null,
  transfer: null,
  reviewAvailable: false,
  notes: [],
};

export async function loadViewExtras(q: Queryable, row: AttemptRow): Promise<ViewExtras> {
  const lines = (
    await q.query<{
      id: string;
      layer: string;
      role: string;
      idx: number;
      slot: string | null;
      statement: string;
      justification: string | null;
      provenance: string;
      flagged: boolean;
      created_at: Date | string;
    }>(
      `select id, layer, role, idx, slot, statement, justification, provenance, flagged, created_at
         from app.attempt_lines
        where attempt_id = $1 and deleted_at is null
        order by created_at, idx`,
      [row.id],
    )
  ).rows;
  const iso = (value: Date | string): string => new Date(value).toISOString();
  const last = (role: string): string | null => lines.filter((l) => l.role === role).at(-1)?.statement ?? null;

  const templateShown =
    (await q.query(`select 1 from ev.events where attempt_id = $1 and type = 'frame.template' limit 1`, [row.id])).rows.length > 0;
  const submitted = (
    await q.query<{ payload: { missing?: string[] } }>(
      `select payload from ev.events where attempt_id = $1 and type = 'summary.submit' order by seq desc limit 1`,
      [row.id],
    )
  ).rows[0];
  const child = (
    await q.query<{ id: string; problem_id: string; problem_version: number }>(
      `select id, problem_id, problem_version from app.attempts where parent_attempt_id = $1 and kind = 'transfer' order by started_at limit 1`,
      [row.id],
    )
  ).rows[0];
  const childStem = child
    ? ((
        await q.query<{ stem: string | null }>(
          `select public->>'stem' as stem from content.problem_versions where problem_id = $1 and version = $2`,
          [child.problem_id, child.problem_version],
        )
      ).rows[0]?.stem ?? null)
    : null;

  const asg = (
    await q.query<{ origin: string; published: boolean; closed: boolean }>(
      `select origin, review_published_at is not null as published,
              (status in ('closed', 'cancelled') or (close_at is not null and close_at <= now())) as closed
         from app.assignments where id = $1`,
      [row.assignment_id],
    )
  ).rows[0];
  const reviewAvailable =
    row.status === 'completed' && asg !== undefined && (asg.origin === 'path' || (asg.published && asg.closed));

  return {
    reviewAvailable,
    lines: lines
      .filter((l) => l.role === 'step')
      .map((l) => ({
        lineId: l.id,
        n: l.idx,
        statement: l.statement,
        justification: l.justification,
        provenance: l.provenance,
        flagged: l.flagged,
        createdAt: iso(l.created_at),
      })),
    defLast: last('def'),
    frameLast: last('frame'),
    templateShown,
    // 追问后会再交一次：每一问取最近一次的回答。
    summaryAnswers: [
      ...lines
        .filter((l) => l.role === 'summary')
        .reduce((bySlot, l) => bySlot.set(Number(l.slot ?? l.idx), l.statement), new Map<number, string>())
        .entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text),
    summaryMissing: submitted ? (submitted.payload.missing ?? []) : null,
    transfer: child ? { childAttemptId: child.id, stem: childStem } : null,
    notes: await loadStoredNotes(q, row.id, null),
  };
}
