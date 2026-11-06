/**
 * 学习路径与练习区的渲染用类型。
 * 真源：openapi.yaml 的 StudentPath / PathItem / PracticeList / PracticeItem / PracticeSolution。
 * 前端只渲染服务端给的状态，不判定完成、锁定或难度。
 */
import type { AssignmentCardView, LayerId } from './attempt'

/** 入门 / 进阶 / 挑战。题目包 difficulty 1–2 / 3 / 4–5。 */
export type DifficultyBand = 'easy' | 'medium' | 'hard'
export type NodeState = 'todo' | 'active' | 'done'
export type SolutionLevel = 'none' | 'approach' | 'full'

export const DIFFICULTY_LABEL: Record<DifficultyBand, string> = {
  easy: '入门',
  medium: '进阶',
  hard: '挑战',
}

export interface PathItem {
  problemId: string
  title: string
  /** 截断的题面（MathText），不会把 $…$ 切成两半。 */
  stemPreview: string
  difficulty: DifficultyBand
  state: NodeState
  currentLayer: LayerId | null
  layersDone: number
  /** 本题启用的层数；导入题只有写证明与总结两层。 */
  layersTotal: number
  attemptId: string | null
  /** 可以看讲评：自学作答完成即可；教师布置要教师发布。 */
  reviewPublished: boolean
  /** 批量导入、AI 整理：显示小标签。 */
  autoImported: boolean
  /** 排在第一道未完成题之后：只提示，确认后可跳过去。 */
  softLocked: boolean
  lessonAvailable: boolean
}

export interface PathUnitSummary {
  id: string
  chapterNo: number
  unitNo: number
  title: string
  summary: string
  total: number
  done: number
  state: NodeState
  /** 上一个单元完成不到 60%。软锁。 */
  locked: boolean
}

export interface PathUnitDetail extends PathUnitSummary {
  items: PathItem[]
  conceptIds: string[]
  concepts: { id: string; title: string }[]
}

export interface PathChapter {
  chapterNo: number
  chapter: string
  firstUnitId: string
  unitCount: number
  total: number
  done: number
}

export interface StudentPath {
  course: { id: string; title: string } | null
  units: PathUnitSummary[]
  current: PathUnitDetail | null
  /** 置顶的老师布置：开放中、没做完的，截止早的在前。 */
  teacherAssignments: AssignmentCardView[]
  chapters: PathChapter[]
}

export interface PracticeItem {
  problemId: string
  title: string
  stemPreview: string
  chapter: string
  section?: string
  difficulty: DifficultyBand
  tags: string[]
  status: NodeState
  attemptId: string | null
  keyCount: number
  autoImported: boolean
}

export interface PracticeFacets {
  chapters: { chapter: string; total: number; done: number }[]
  difficulty: Record<DifficultyBand, number>
}

export interface PracticeList {
  items: PracticeItem[]
  facets: PracticeFacets
  nextCursor: string | null
}

export interface PracticeQuery {
  chapter?: string
  difficulty?: DifficultyBand
  status?: NodeState
  q?: string
  cursor?: string
  limit?: number
}

export interface PracticeSolution {
  level: SolutionLevel
  /** 有一份进行中的自学作答，且还能再看一级。 */
  canReveal: boolean
  hasApproach: boolean
  hasFull: boolean
  approach?: string
  keyIdeas?: string[]
  pitfalls?: string[]
  referenceProof?: string
}

/** GET /attempts/{attemptId}/review */
export interface PublishedReview {
  proofs: string[]
  note?: string
}
