/**
 * 镜像页的「只读视图」数据选择（issue #43 A 侧 / 04 §5.1）。
 *
 * 只从服务端下发的 AttemptState 里挑学生端会看到的字段，供页面渲染；
 * 不产生任何输入/提交动作，也不做判定。纯函数，可直接单测。
 */
import { layerLabel } from '@/copy'
import type {
  AttemptState,
  AttemptStatus,
  LayerId,
  LayerStatus,
  Note,
  ProofLine,
  SelfcheckItem,
  SummaryView,
  TransferView,
} from '@/types/attempt'

export const MIRROR_BANNER = '教师镜像预览 · 只读'
export const MIRROR_PLAYBACK_NOTE = '回放由教师端提供：本页只展示服务端推送的最新状态，不伪造历史事件。'

const STATUS_LABELS: Record<AttemptStatus, string> = {
  active: '进行中',
  parked: '已搁置',
  locked: '已锁定',
  completed: '已完成',
  abandoned: '已放弃',
}

const NOTE_KIND_LABELS: Record<Note['kind'], string> = {
  annotation: '批注',
  hint: '提示',
  concept: '概念',
  refusal: '拒绝',
  system: '系统',
  lesson: '微课',
  nudge: '提醒',
  student: '学生',
}

const SELFCHECK_STATUS_LABELS: Record<SelfcheckItem['status'], string> = {
  open: '待回答',
  accepted: '已通过',
  followup: '追问中',
}

const TRANSFER_STATUS_LABELS: Record<TransferView['status'], string> = {
  not_started: '未开始',
  active: '进行中',
  completed: '已完成',
  skipped: '已跳过',
}

export function mirrorLayerLabel(layer: LayerId): string {
  return layerLabel(layer) || layer
}

export function mirrorStatusLabel(status: AttemptStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function mirrorNoteKindLabel(kind: Note['kind']): string {
  return NOTE_KIND_LABELS[kind] ?? kind
}

export function mirrorSelfcheckStatusLabel(status: SelfcheckItem['status']): string {
  return SELFCHECK_STATUS_LABELS[status] ?? status
}

export function mirrorTransferStatusLabel(status: TransferView['status']): string {
  return TRANSFER_STATUS_LABELS[status] ?? status
}

export interface MirrorDefinitionSection {
  task: string | null
  last: string | null
  submissions: number
}

export interface MirrorFrameSection {
  task: string | null
  template: string | null
  last: string | null
  templateShown: boolean
}

export interface MirrorSelfcheckRow {
  itemId: string
  question: string
  status: 'open' | 'accepted' | 'followup'
  statusLabel: string
  answer: string | null
}

export interface MirrorSummarySection {
  questions: string[]
  answers: Array<string | null>
}

export interface MirrorCompletionSection {
  done: boolean
  independence: number | null
  theorems: string[]
  steps: string[]
}

export interface MirrorTransferSection {
  status: TransferView['status']
  statusLabel: string
  stem: string | null
}

export interface MirrorNoteItem {
  noteId: string
  kind: Note['kind']
  kindLabel: string
  who: string
  text: string
  at: string
}

export interface MirrorLayerItem {
  layer: LayerId
  label: string
  status: LayerStatus['status']
  active: boolean
}

export interface MirrorBudgetView {
  revealUsed: number
  revealMax: number
  keysOwn: number
  keysTotal: number
}

export interface MirrorViewModel {
  attemptId: string
  stateVersion: number
  title: string
  chapter: string
  stem: string
  layerLabel: string
  statusLabel: string
  layers: MirrorLayerItem[]
  budget: MirrorBudgetView
  definition: MirrorDefinitionSection | null
  frame: MirrorFrameSection | null
  lines: ProofLine[]
  notes: MirrorNoteItem[]
  selfcheck: MirrorSelfcheckRow[]
  transfer: MirrorTransferSection | null
  summary: MirrorSummarySection | null
  completion: MirrorCompletionSection | null
  integrity: { locked: boolean; warnings: number } | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * AttemptState → 镜像页视图。只挑字段，绝不注入输入/动作。
 * 返回 null 表示数据不可渲染（页面显示连接占位，不抛错）。
 */
export function buildMirrorViewModel(state: AttemptState | null): MirrorViewModel | null {
  if (!state || typeof state !== 'object') return null
  const problem = state.problem
  if (!problem || typeof problem.title !== 'string') return null

  const definition = state.def
    ? { task: asString(state.def.task), last: asString(state.def.last), submissions: state.def.submissions ?? 0 }
    : null
  const frame = state.frame
    ? {
        task: asString(state.frame.task),
        template: asString(state.frame.template),
        last: asString(state.frame.last),
        templateShown: Boolean(state.frame.templateShown),
      }
    : null

  const selfcheckItems: SelfcheckItem[] = Array.isArray(state.selfcheck?.items) ? state.selfcheck.items : []
  const summary: SummaryView | undefined = state.summary
  const transfer: TransferView | undefined = state.transfer
  const completion = state.completion

  return {
    attemptId: state.attemptId,
    stateVersion: state.stateVersion,
    title: problem.title,
    chapter: problem.chapter ?? '',
    stem: problem.stem ?? '',
    layerLabel: mirrorLayerLabel(state.currentLayer),
    statusLabel: mirrorStatusLabel(state.status),
    layers: (state.layers ?? []).map((layer) => ({
      layer: layer.layer,
      label: mirrorLayerLabel(layer.layer),
      status: layer.status,
      active: layer.layer === state.currentLayer,
    })),
    budget: {
      revealUsed: state.budget?.revealUsed ?? 0,
      revealMax: state.budget?.revealMax ?? 0,
      keysOwn: state.budget?.keysOwn ?? 0,
      keysTotal: state.budget?.keysTotal ?? 0,
    },
    definition,
    frame,
    lines: state.steps?.lines ?? [],
    notes: (state.notes ?? []).map((note) => ({
      noteId: note.noteId,
      kind: note.kind,
      kindLabel: mirrorNoteKindLabel(note.kind),
      who: note.who,
      text: note.text,
      at: note.at,
    })),
    selfcheck: selfcheckItems.map((item) => ({
      itemId: item.itemId,
      question: item.question,
      status: item.status,
      statusLabel: mirrorSelfcheckStatusLabel(item.status),
      answer: asString(item.answer),
    })),
    transfer: transfer
      ? {
          status: transfer.status,
          statusLabel: mirrorTransferStatusLabel(transfer.status),
          stem: asString(transfer.stem),
        }
      : null,
    summary: summary
      ? {
          questions: Array.isArray(summary.questions) ? summary.questions : [],
          answers: Array.isArray(summary.answers) ? summary.answers : [],
        }
      : null,
    completion: completion
      ? {
          done: Boolean(completion.done),
          independence: typeof completion.independence === 'number' ? completion.independence : null,
          theorems: Array.isArray(completion.leanCard?.theorems) ? completion.leanCard.theorems : [],
          steps: Array.isArray(completion.leanCard?.steps)
            ? completion.leanCard.steps.map((step) => step.label ?? step.keyId ?? '').filter((label) => label.length > 0)
            : [],
        }
      : null,
    integrity: state.integrity
      ? { locked: Boolean(state.integrity.locked), warnings: state.integrity.warnings ?? 0 }
      : null,
  }
}
