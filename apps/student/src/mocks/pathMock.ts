/**
 * 学习路径与练习区的 mock 后端：按服务端同一套规则（单元 60% 开放下一单元、软锁、难度档、分面、游标分页、
 * 查看解答分级）从 pathBank 算出响应。只在 mock 模式用；真实模式的规则都在服务端。
 */
import type { AssignmentCardView, NotebookCard } from '@/types/attempt'
import type {
  NodeState,
  PathChapter,
  PathItem,
  PathUnitSummary,
  PracticeFacets,
  PracticeItem,
  PracticeList,
  PracticeQuery,
  PracticeSolution,
  PublishedReview,
  SolutionLevel,
  StudentPath,
} from '@/types/path'
import { mockNotebook } from './laterLayers'
import { BANK, MOCK_COURSE, UNITS, bandOf, type BankProblem } from './pathBank'

interface Progress {
  state: 'active' | 'done'
  attemptId: string
  layersDone: number
}

interface Store {
  progress: Map<string, Progress>
  reveals: Map<string, SolutionLevel>
  counter: number
}

function freshStore(): Store {
  const store: Store = { progress: new Map(), reveals: new Map(), counter: 0 }
  // 演示数据：第二章前两道已完成，第三道进行中。
  for (const id of ['seq-1', 'seq-2']) store.progress.set(id, { state: 'done', attemptId: mockAttemptId(store), layersDone: 6 })
  store.progress.set('seq-3', { state: 'active', attemptId: mockAttemptId(store), layersDone: 2 })
  return store
}

function mockAttemptId(store: Store): string {
  store.counter += 1
  return `00000000-0000-4000-9000-${String(store.counter).padStart(12, '0')}`
}

/**
 * 演示构建（build:mock）里像一位学到一半的同学：前两个单元写完，第三个单元写到第三道。
 * 单元测试不走这里（没有 VITE_ENABLE_MOCK），还是上面那份最小种子。
 */
function demoStore(): Store {
  const seeded = freshStore()
  for (const id of ['sup-1', 'sup-2', 'sup-3', 'fn-1', 'fn-2', 'fn-3']) {
    seeded.progress.set(id, { state: 'done', attemptId: mockAttemptId(seeded), layersDone: 6 })
  }
  return seeded
}

let store = import.meta.env?.VITE_ENABLE_MOCK === '1' ? demoStore() : freshStore()

/** 测试隔离。 */
export function __resetPathMockForTests(): void {
  store = freshStore()
}

export const MOCK_TEACHER_ASSIGNMENT: AssignmentCardView = {
  assignmentId: '00000000-0000-4000-a000-000000000001',
  title: '数列极限 · ε-N',
  chapter: '第二章 数列极限',
  mode: 'practice',
  status: 'open',
  openAt: '2026-11-02T08:00:00.000Z',
  closeAt: '2026-11-12T15:59:00.000Z',
  attemptId: null,
  attemptStatus: null,
  currentLayer: null,
  reviewPublished: false,
}

/** 与服务端 stemPreview 同口径：不把 $…$ 公式切成两半。 */
export function stemPreview(stem: string, max = 120): string {
  const text = stem.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  let cut = max
  while (cut > 0 && text[cut - 1] === '\\') cut -= 1
  let open = -1
  for (let i = 0; i < cut; i += 1) {
    if (text[i] === '\\') {
      i += 1
      continue
    }
    if (text[i] === '$') open = open === -1 ? i : -1
  }
  if (open !== -1) cut = open
  const head = text.slice(0, cut).trimEnd()
  return head === '' ? '…' : `${head}…`
}

const stateOf = (id: string): NodeState => store.progress.get(id)?.state ?? 'todo'
const byUnit = (unitIndex: number): BankProblem[] => BANK.filter((p) => p.unit === unitIndex)
const problemOf = (id: string): BankProblem | undefined => BANK.find((p) => p.id === id)

function unitSummaries(): PathUnitSummary[] {
  let prev: { total: number; done: number } | null = null
  return UNITS.map((unit, index) => {
    const items = byUnit(index)
    const done = items.filter((p) => stateOf(p.id) === 'done').length
    const started = items.some((p) => store.progress.has(p.id))
    const locked = prev !== null && prev.total > 0 && prev.done < prev.total * 0.6
    prev = { total: items.length, done }
    return {
      id: unit.id,
      chapterNo: unit.chapterNo,
      unitNo: unit.unitNo,
      title: unit.title,
      summary: unit.summary,
      total: items.length,
      done,
      state: done === items.length ? 'done' : started ? 'active' : 'todo',
      locked,
    }
  })
}

function pathItem(problem: BankProblem, index: number, frontier: number): PathItem {
  const progress = store.progress.get(problem.id)
  const state = stateOf(problem.id)
  const layersTotal = problem.layers ?? 6
  return {
    problemId: problem.id,
    title: problem.title,
    stemPreview: stemPreview(problem.stem),
    difficulty: bandOf(problem.difficulty),
    state,
    currentLayer: progress ? (state === 'done' ? 'L6' : 'L3') : null,
    layersDone: progress ? Math.min(progress.layersDone, layersTotal) : 0,
    layersTotal,
    attemptId: progress?.attemptId ?? null,
    reviewPublished: state === 'done',
    autoImported: problem.autoImported === true,
    softLocked: state === 'todo' && frontier !== -1 && index > frontier,
    lessonAvailable: !problem.autoImported,
  }
}

export function mockStudentPath(unitId?: string): StudentPath {
  const units = unitSummaries()
  const summary = unitId ? units.find((u) => u.id === unitId) : (units.find((u) => u.state !== 'done') ?? units.at(-1))
  if (!summary) throw Object.assign(new Error('找不到这个单元'), { status: 404, code: 'NOT_FOUND' })
  const index = UNITS.findIndex((u) => u.id === summary.id)
  const problems = byUnit(index)
  const frontier = problems.findIndex((p) => stateOf(p.id) !== 'done')
  const chapters: PathChapter[] = []
  for (const unit of units) {
    let chapter = chapters.find((c) => c.chapterNo === unit.chapterNo)
    if (!chapter) {
      chapter = {
        chapterNo: unit.chapterNo,
        chapter: UNITS.find((u) => u.id === unit.id)?.chapter ?? `第 ${unit.chapterNo} 章`,
        firstUnitId: unit.id,
        unitCount: 0,
        total: 0,
        done: 0,
      }
      chapters.push(chapter)
    }
    chapter.unitCount += 1
    chapter.total += unit.total
    chapter.done += unit.done
  }
  return {
    course: { ...MOCK_COURSE },
    units,
    current: {
      ...summary,
      conceptIds: UNITS[index]?.concepts.map((c) => c.id) ?? [],
      concepts: UNITS[index]?.concepts ?? [],
      items: problems.map((p, i) => pathItem(p, i, frontier)),
    },
    teacherAssignments: [{ ...MOCK_TEACHER_ASSIGNMENT }],
    chapters,
  }
}

function practiceItem(problem: BankProblem): PracticeItem {
  const unit = UNITS[problem.unit]
  return {
    problemId: problem.id,
    title: problem.title,
    stemPreview: stemPreview(problem.stem),
    chapter: unit?.chapter ?? '',
    section: unit?.title,
    difficulty: bandOf(problem.difficulty),
    tags: problem.tags,
    status: stateOf(problem.id),
    attemptId: store.progress.get(problem.id)?.attemptId ?? null,
    keyCount: problem.keyCount,
    autoImported: problem.autoImported === true,
  }
}

// 章 → 难度 → ID，与服务端排序一致。
function sortedBank(): BankProblem[] {
  return [...BANK].sort(
    (a, b) =>
      (UNITS[a.unit]?.chapterNo ?? 0) - (UNITS[b.unit]?.chapterNo ?? 0) ||
      a.difficulty - b.difficulty ||
      a.id.localeCompare(b.id),
  )
}

export function mockListPractice(query: PracticeQuery = {}): PracticeList {
  const needle = query.q?.trim().toLowerCase() ?? ''
  const all = sortedBank().map(practiceItem).filter((item) => {
    if (needle === '') return true
    const problem = problemOf(item.problemId)
    return `${item.title} ${item.chapter} ${problem?.stem ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(needle)
  })
  const pass = (item: PracticeItem, skip: 'chapter' | 'difficulty' | null): boolean =>
    (skip === 'chapter' || query.chapter === undefined || item.chapter === query.chapter) &&
    (skip === 'difficulty' || query.difficulty === undefined || item.difficulty === query.difficulty) &&
    (query.status === undefined || item.status === query.status)

  const chapters: PracticeFacets['chapters'] = []
  for (const item of all.filter((i) => pass(i, 'chapter'))) {
    let entry = chapters.find((c) => c.chapter === item.chapter)
    if (!entry) {
      entry = { chapter: item.chapter, total: 0, done: 0 }
      chapters.push(entry)
    }
    entry.total += 1
    if (item.status === 'done') entry.done += 1
  }
  const difficulty = { easy: 0, medium: 0, hard: 0 }
  for (const item of all.filter((i) => pass(i, 'difficulty'))) difficulty[item.difficulty] += 1

  const filtered = all.filter((i) => pass(i, null))
  const start = query.cursor ? Math.max(0, filtered.findIndex((i) => i.problemId === query.cursor) + 1) : 0
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50)
  const items = filtered.slice(start, start + limit)
  const nextCursor = start + limit < filtered.length ? (items.at(-1)?.problemId ?? null) : null
  return { items, facets: { chapters, difficulty }, nextCursor }
}

export function mockRandomPractice(filter: { chapter?: string; difficulty?: 'easy' | 'medium' | 'hard' } = {}): PracticeItem {
  const candidates = sortedBank()
    .map(practiceItem)
    .filter(
      (i) =>
        i.status !== 'done' &&
        (filter.chapter === undefined || i.chapter === filter.chapter) &&
        (filter.difficulty === undefined || i.difficulty === filter.difficulty),
    )
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  if (!pick) throw Object.assign(new Error('这个范围里的题你都做过了，换个章节或难度试试'), { status: 404, code: 'NOT_FOUND' })
  return pick
}

/** 开始或继续：已做完返回只读回看，其余置为进行中。 */
export function mockStartProblem(problemId: string): { problem: BankProblem; attemptId: string; done: boolean } {
  const problem = problemOf(problemId)
  if (!problem) throw Object.assign(new Error('这道题现在不能练习'), { status: 404, code: 'NOT_FOUND' })
  let progress = store.progress.get(problemId)
  if (!progress) {
    progress = { state: 'active', attemptId: mockAttemptId(store), layersDone: 0 }
    store.progress.set(problemId, progress)
  }
  return { problem, attemptId: progress.attemptId, done: progress.state === 'done' }
}

export function problemForAttempt(attemptId: string): BankProblem | undefined {
  for (const [id, progress] of store.progress) if (progress.attemptId === attemptId) return problemOf(id)
  return undefined
}

/** 路径上做完的题也进证明本：回看时能打开。 */
export function mockPathNotebookCards(): NotebookCard[] {
  const cards: NotebookCard[] = []
  let days = 3
  for (const [id, progress] of store.progress) {
    if (progress.state !== 'done') continue
    const problem = problemOf(id)
    if (!problem) continue
    days += 1
    cards.push({
      attemptId: progress.attemptId,
      problemId: problem.id,
      problemVersion: 1,
      kind: 'main',
      title: problem.title,
      chapter: UNITS[problem.unit]?.chapter,
      proof: splitProof(problem.solution.referenceProof),
      lines: splitProof(problem.solution.referenceProof).map((statement, i) => ({ n: i + 1, statement })),
      summary: [problem.solution.approach],
      weakPoints: problem.solution.pitfalls.slice(0, 1),
      independence: 0.9,
      revealUsed: 0,
      keysTotal: problem.keyCount,
      redoRecommended: false,
      reviewPublished: false,
      canRedo: true,
      completedAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    })
  }
  return cards
}

/** 按句号拆行，不拆公式里的标点。 */
function splitProof(text: string): string[] {
  const out: string[] = []
  let buffer = ''
  let inMath = false
  for (const ch of text) {
    if (ch === '$') inMath = !inMath
    buffer += ch
    if (!inMath && ch === '。') {
      out.push(buffer)
      buffer = ''
    }
  }
  if (buffer.trim()) out.push(buffer)
  return out
}

function solutionOf(problem: BankProblem): PracticeSolution {
  const level: SolutionLevel = stateOf(problem.id) === 'done' ? 'full' : (store.reveals.get(problem.id) ?? 'none')
  const dto: PracticeSolution = {
    level,
    canReveal: stateOf(problem.id) === 'active' && level !== 'full',
    hasApproach: true,
    hasFull: true,
  }
  if (level !== 'none') {
    dto.approach = problem.solution.approach
    dto.keyIdeas = problem.solution.keyIdeas
  }
  if (level === 'full') {
    dto.pitfalls = problem.solution.pitfalls
    dto.referenceProof = problem.solution.referenceProof
  }
  return dto
}

export function mockSolution(problemId: string): PracticeSolution {
  const problem = problemOf(problemId)
  if (!problem) throw Object.assign(new Error('这道题现在不能练习'), { status: 404, code: 'NOT_FOUND' })
  return solutionOf(problem)
}

export function mockReveal(problemId: string, level: 'approach' | 'full'): PracticeSolution {
  const problem = problemOf(problemId)
  if (!problem) throw Object.assign(new Error('这道题现在不能练习'), { status: 404, code: 'NOT_FOUND' })
  if (!store.progress.has(problemId)) {
    throw Object.assign(new Error('先开始做这道题，再来看思路'), { status: 409, code: 'VALIDATION_FAILED' })
  }
  const current = store.reveals.get(problemId) ?? 'none'
  if (current !== 'full' && !(current === 'approach' && level === 'approach')) store.reveals.set(problemId, level)
  return solutionOf(problem)
}

export function mockReview(attemptId: string): PublishedReview {
  const seeded = mockNotebook.cards.find((card) => card.attemptId === attemptId)
  if (seeded?.reviewPublished) {
    return { proofs: seeded.proof ?? [], note: seeded.teacherNote }
  }
  const problem = problemForAttempt(attemptId)
  if (!problem || stateOf(problem.id) !== 'done') {
    throw Object.assign(new Error('讲评现在还不能看'), { status: 403, code: 'FORBIDDEN' })
  }
  return { proofs: [problem.solution.referenceProof] }
}

/** 测试与演示：把某题标记为已完成。 */
export function __completeMockProblem(problemId: string): void {
  const progress = store.progress.get(problemId)
  if (progress) store.progress.set(problemId, { ...progress, state: 'done', layersDone: 6 })
  else store.progress.set(problemId, { state: 'done', attemptId: mockAttemptId(store), layersDone: 6 })
}
