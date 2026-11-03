/**
 * 学生端渲染用的契约类型（子集）。
 *
 * 唯一真源：证明陪练场_产品设计工作区/10-开发文档/contracts/openapi.yaml
 * - 本文件只镜像 AttemptState 及其子结构里「学生端要渲染」的字段，不做任何业务判定。
 * - #6 落地后由 packages/contracts 生成完整类型替换本文件（见 issue #8 领取评论）。
 */

export type LayerId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'
export type LayerStatusValue = 'locked' | 'active' | 'done' | 'skipped' | 'disabled'
export type AttemptKind = 'main' | 'transfer'
export type AttemptStatus = 'active' | 'parked' | 'locked' | 'completed' | 'abandoned'
export type AttemptMode = 'practice' | 'test'
export type NoteKind = 'annotation' | 'hint' | 'concept' | 'system' | 'refusal' | 'lesson' | 'nudge' | 'student'
export type HintLevel = 'H0' | 'H1' | 'H2' | 'H3' | 'H4' | null
export type HelpIntent = 'stuck' | 'concept' | 'check_line' | 'free'
export type RecognitionStatus = 'ok' | 'empty' | 'low_confidence' | 'error'
export type InputProvenance = 'ink' | 'keyboard' | 'photo' | 'mixed' | 'paste'

export interface MathText extends String {}

export interface ProblemView {
  problemId: string
  version: number
  title: string
  stem: string
  chapter: string
  source?: string
  keyCount: number
  askChips?: string[]
}

export interface LayerStatus {
  layer: LayerId
  title: string
  status: LayerStatusValue
  enabled: boolean
  skippable: boolean
}

export interface BudgetView {
  revealUsed: number
  revealMax: number
  keysOwn: number
  keysTotal: number
}

export interface ProofLine {
  lineId: string
  n: number
  statement: string
  justification?: string | null
  provenance?: InputProvenance
  cls?: string | null
  keys?: string[]
  path?: string | null
  inkId?: string | null
}

export interface Note {
  noteId: string
  kind: NoteKind
  who: string
  text: string
  lineId?: string | null
  level?: HintLevel
  cost?: number | null
  lessonConceptId?: string | null
  at: string
}

export interface DefView {
  task?: string
  conceptId?: string
  submissions?: number
  last?: string | null
  lessonSuggested?: boolean
}

export interface FrameView {
  task?: string
  lessonId?: string
  last?: string | null
  templateShown?: boolean
  template?: string | null
}

export interface StepsView {
  lines: ProofLine[]
  canFinish: boolean
}

export interface HelpState {
  hintAvailable: boolean
  nextLevel?: HintLevel
  nextCost?: number | null
  waitSec?: number | null
  needAttempt?: boolean
  rapidLockUntil?: string | null
  exhausted: boolean
  flagged: boolean
  stuckOffer?: boolean
}

export interface IntegrityView {
  mode: AttemptMode
  locked: boolean
  warnings?: number
  maxWarnings?: number | null
  notice?: string | null
  watermark?: string | null
}

/**
 * 提示预览。字段全部可选：契约（openapi.yaml / packages/contracts/gen/api.ts）
 * 没有 required；服务端 blocked preview 只返回 { allowed:false, reason, waitSec }，
 * 没有 level/cost（06 §3.4「不能领取时 preview.allowed=false」）。
 * revealAfter 是「领取后的累计透露量」，不是秒数；等待秒数一律看 waitSec。
 */
export interface HintPreview {
  level?: 'H2' | 'H3' | 'H4'
  cost?: number
  revealAfter?: number
  allowed?: boolean
  reason?: 'need_attempt' | 'dwell' | 'rapid_lock' | 'budget' | 'layer' | 'test_mode' | 'complete' | null
  waitSec?: number | null
  previewToken?: string | null
  softLanding?: string[]
}

export interface HelpResult {
  routed: 'stuck' | 'concept' | 'check_line' | 'pressure' | 'off_topic'
  preview?: HintPreview
  note?: Note
  state: AttemptState
}

export interface Recognition {
  recogId: string
  status: RecognitionStatus
  text?: string
  lines?: Array<{ text: string; bbox?: number[]; confidence?: number }>
  confidence?: number
  agree?: boolean | null
  diff?: Array<{ start: number; end: number; alt: string }>
  rendered?: boolean
}

export interface AttemptState {
  attemptId: string
  parentAttemptId?: string | null
  stateVersion: number
  kind: AttemptKind
  status: AttemptStatus
  mode: AttemptMode
  problem: ProblemView
  currentLayer: LayerId
  layers: LayerStatus[]
  budget: BudgetView
  def?: DefView
  frame?: FrameView
  steps?: StepsView
  selfcheck?: unknown
  transfer?: unknown
  summary?: unknown
  notes: Note[]
  help: HelpState
  integrity: IntegrityView
  completion?: { done: boolean; independence?: number | null; reviewAvailable?: boolean; leanCard?: unknown }
  serverTime: string
}

/** 一次输入的来源与草稿标识（openapi.yaml InputMeta；03 §1：一个落点一个 draftId）。 */
export interface InputMeta {
  provenance: InputProvenance
  draftId: string
  recogId?: string
  pasteChars?: number
}

export interface LineDraft {
  statement: string
  justification?: string
  input: InputMeta
  /** 依据是独立输入落点：依据非空时必带，并用自己的 provenance/draftId（03 §1）。 */
  justificationInput?: InputMeta
}

export interface AttemptEnvelope<T = unknown> {
  state: AttemptState
}
