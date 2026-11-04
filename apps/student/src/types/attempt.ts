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

/** 微课/图解小核验（concept.schema.json 的 CheckQuestion；answer 由服务端判定，前端不自己判对错）。 */
export interface CheckQuestion {
  q: string
  options: string[]
  answer: number
  right: string
  wrong: string
}

/**
 * 参数化图解（concept.schema.json 的 VisualSpec；前端只认这几种 type，不执行数据里的代码）。
 *
 * 注：`abs-triangle` 是 #47 P1 接线时本地 mock 用的扩展（03 §7 的契约 type 只有前五种）；
 * 真实接口接入（#24）时由概念库下发合法 type，或把 abs-triangle 补进契约（B 侧）。
 */
export interface VisualSpec {
  type: 'seq-band' | 'partial-sums' | 'func-band' | 'monotone-steps' | 'number-line' | 'abs-triangle'
  title?: string
  params: {
    expr?: string
    exprLatex?: string
    series?: Array<{ expr: string; label: string }>
    limit?: number
    at?: number
    epsilon?: { min?: number; max?: number; init?: number; step?: number }
    nMax?: number
    xRange?: [number, number]
    yRange?: [number, number]
    showN?: boolean
    /**
     * 仅 mock 扩展（#26 微课）：预生成的序列点，供 diagrams/SeqBandDiagram 的 points prop 使用。
     * 契约 VisualSpec 只有 expr（前端不执行数据里的表达式，真实接口 #24 由服务端给出渲染参数/点位）。
     */
    points?: Array<{ n: number; a: number }>
    /** 仅 mock 扩展（#47 图解）：abs-triangle 的 a、b。 */
    a?: number
    b?: number
  }
}

/** 微课一步（concept.schema.json 的 LessonStep；check.answer 不下发，由 /lesson/check 判定）。 */
export interface LessonStep {
  id: string
  kind: 'intuition' | 'map' | 'distortion' | 'boundary' | 'build' | 'return'
  text: string
  visual?: VisualSpec
  check?: CheckQuestion
}

/** 微课（openapi LessonView；服务端已过闸门）。 */
export interface LessonView {
  conceptId: string
  title: string
  steps: LessonStep[]
  generated?: string | null
  currentStepId?: string
}

export interface SelfcheckItem {
  itemId: string
  question: string
  answer?: string
  status: 'open' | 'accepted' | 'followup'
  /**
   * 仅 mock 扩展：自检题维度（自适应选题用；契约 SelfcheckView 只下发 itemId/question/status/answer，
   * 维度在真实接口里由服务端按 selfcheckBank 挑题时决定 —— #24 后把维度/记录收进契约或服务端完成选题）。
   */
  dimension?: 'basis' | 'role' | 'logic' | 'condition' | 'module' | 'transfer'
  /** 仅 mock：本题已作答次数（自适应 maxAttempts 用）。 */
  attempts?: number
}

export interface SelfcheckView {
  items: SelfcheckItem[]
  /** 仅 mock：passed 记录（服务端判定结果的时间正序；真实接口由服务端下发或由 status 推导，#24）。 */
  records?: Array<{ itemId: string; passed: boolean }>
}

export interface TransferView {
  childAttemptId?: string | null
  stem?: string | null
  status: 'not_started' | 'active' | 'completed' | 'skipped'
}

export interface SummaryView {
  questions: string[]
  answers: string[]
  followup?: string | null
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
  selfcheck?: SelfcheckView
  transfer?: TransferView
  summary?: SummaryView
  notes: Note[]
  help: HelpState
  integrity: IntegrityView
  completion?: CompletionView
  serverTime: string
}

/** 一次输入的来源与草稿标识（openapi.yaml InputMeta；03 §1：一个落点一个 draftId）。 */
export interface InputMeta {
  provenance: InputProvenance
  draftId: string
  recogId?: string
  pasteChars?: number
}

/** 证明本卡片（openapi Notebook.cards；mock 阶段额外带 mock 键，真实接口按 attemptId 取状态）。 */
export interface NotebookCard {
  attemptId: string
  title: string
  proof?: string[]
  summary?: string[]
  definition?: string
  weakPoints?: string[]
  completedAt?: string
  /** 仅 mock：回到该题时加载哪份典型 state；真实接口用 attemptId 拉取。 */
  mock?: string
  /** 以下为「稍后重做」需要的字段（对应 openapi Notebook/AssignmentCard 子集；#24 由服务端提供）。 */
  problemId?: string
  kind?: 'main' | 'transfer'
  independence?: number | null
  revealUsed?: number
  keysTotal?: number
  redoRecommended?: boolean
  assignmentId?: string | null
  problemVersion?: number
}

export interface NotebookView {
  cards: NotebookCard[]
  toRedo?: Array<{ assignmentId?: string; title?: string; attemptId?: string | null }>
}

export interface LeanCard {
  theorems?: string[]
  steps?: Array<{ keyId?: string; label?: string; tactic?: string }>
}

export interface CompletionView {
  done: boolean
  independence?: number | null
  reviewAvailable?: boolean
  leanCard?: LeanCard | null
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

// ---------------------------------------------------------------------------
// 真实接口（issue #24）用到的契约 DTO 子集
// 真源：packages/contracts/openapi.yaml（Me / ConsentDoc / StudentHome / AssignmentCard）。
// 只镜像前端要渲染的字段；#6 的生成类型接入后可整体替换本文件。
// ---------------------------------------------------------------------------

export type ConsentKey = 'service' | 'crossBorderHosting' | 'crossBorderModel' | 'monitoring' | 'research'
export type ConsentChoices = Record<ConsentKey, boolean>

export interface MeView {
  userId: string
  role: 'student' | 'teacher' | 'admin'
  anonCode: string
  displayName: string | null
  classes: Array<{ id: string; name: string }>
  consentRequired: boolean
  features: Record<string, boolean>
}

export interface ConsentSection {
  key: ConsentKey
  title: string
  body: string
  required: boolean
}

export interface SignedConsent {
  version: string
  items: ConsentChoices
  signedAt: string
}

export interface ConsentDoc {
  version: string
  sections: ConsentSection[]
  signed: SignedConsent | null
}

/** 首页卡片（02 §4.2）：GET /student/home 的 AssignmentCard 子集。 */
export interface AssignmentCardView {
  assignmentId: string
  title: string
  chapter?: string
  mode: AttemptMode
  status: 'scheduled' | 'open' | 'closed' | 'cancelled'
  openAt?: string
  closeAt?: string | null
  attemptId?: string | null
  attemptStatus?: AttemptStatus | null
  currentLayer?: LayerId | null
  reviewPublished?: boolean
}

export interface StudentHomeView {
  inProgress: AssignmentCardView[]
  todo: AssignmentCardView[]
  done: AssignmentCardView[]
  week?: { keysOwn: number; keysTotal: number; problemsDone: number }
  notebook?: { cards: number; toRedo: number }
}

/** InputMeta：所有文本类写接口的必填元信息（openapi InputMeta）。 */
export interface InputMeta {
  provenance: InputProvenance
  draftId: string
  recogId?: string
  pasteChars?: number
}
