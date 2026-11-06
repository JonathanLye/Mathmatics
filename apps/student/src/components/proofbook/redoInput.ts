/**
 * 证明本「稍后重做」接线（#47 redo.ts ↔ #26 proofbook 页 / mock notebook）。
 *
 * 纯逻辑：把 NotebookCard 映射成 redo.listRedoable 的 CompletedAttemptView，并给出分档文案。
 * 契约 Notebook.cards 没有独立度/教师标记等字段；mock 在 cards 上补了这些字段（#24 由服务端下发）。
 */
import type { NotebookCard } from '@/types/attempt'
import { independenceCopy } from '@/copy'
import type { CompletedAttemptView, RedoEntry, RedoList, RedoOptions } from './redo'
import { independenceLevel, listRedoable, type IndependenceLevel } from './redo'

export const REDO_OPTIONS: RedoOptions = { threshold: 0.5, includeHinted: false, cooldownDays: 2, limit: 5 }

/** NotebookCard → 稍后重做的输入；没有 problemId 的卡片用 attemptId 兜底（避免同题去重失效）。 */
export function toCompletedAttemptView(card: NotebookCard): CompletedAttemptView {
  return {
    attemptId: card.attemptId,
    problemId: card.problemId ?? card.attemptId,
    title: card.title,
    completedAt: card.completedAt ?? '1970-01-01T00:00:00.000Z',
    kind: card.kind,
    independence: card.independence ?? null,
    revealUsed: card.revealUsed,
    keysTotal: card.keysTotal,
    redoRecommended: card.redoRecommended === true,
    assignmentId: card.assignmentId ?? null,
    problemVersion: card.problemVersion,
  }
}

/** 证明本页的「稍后重做」列表（mock now 用当前时间；真接口由服务端冷却/标记决定）。 */
export function buildRedoList(cards: readonly NotebookCard[], options: RedoOptions = REDO_OPTIONS): RedoList {
  return listRedoable(cards.map(toCompletedAttemptView), { ...REDO_OPTIONS, ...options })
}

export const LEVEL_LABEL: Record<IndependenceLevel, string> = {
  independent: '靠自己',
  hinted: '用了提示',
  dependent: '多靠提示',
  unknown: '还没有记录',
}

/** 分档的学生说法（04 独立度分档：≥0.85 / 0.5–0.85 / <0.5）。不评判，只说事实。 */
export function levelLabel(value: number | null, threshold = 0.5): string {
  return LEVEL_LABEL[independenceLevel(value, threshold)]
}

/** 证明本一行：“4 步里 1 步靠自己”；不知道关键步骤数时退回分档的说法。 */
export function redoIndependenceText(entry: Pick<RedoEntry, 'independence' | 'keysTotal'>): string {
  if (entry.independence === null || !entry.keysTotal) return levelLabel(entry.independence)
  return independenceCopy(Math.round(entry.independence * entry.keysTotal), entry.keysTotal)
}
