import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_FILTERS,
  ZONE_PAGE_SIZE,
  filtersActive,
  loadFilters,
  mergeRefreshed,
  nextReveal,
  parseFilters,
  randomFilter,
  resultCount,
  saveFilters,
  solutionStep,
  zoneQuery,
} from '@/components/practice-zone/zoneLogic'
import type { PracticeItem, PracticeSolution } from '@/types/path'

const item = (problemId: string, status: PracticeItem['status'] = 'todo'): PracticeItem => ({
  problemId,
  title: problemId,
  stemPreview: '',
  chapter: '',
  difficulty: 'easy',
  tags: [],
  status,
  attemptId: null,
  keyCount: 1,
  autoImported: false,
})

const solution = (over: Partial<PracticeSolution> = {}): PracticeSolution => ({
  level: 'none',
  canReveal: true,
  hasApproach: true,
  hasFull: true,
  ...over,
})

describe('筛选条件', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('解析：坏数据、不认识的值都回默认', () => {
    expect(parseFilters(null)).toEqual(EMPTY_FILTERS)
    expect(parseFilters('不是 JSON')).toEqual(EMPTY_FILTERS)
    expect(parseFilters('{"difficulty":"nope","status":"x","chapter":3,"q":null}')).toEqual(EMPTY_FILTERS)
    expect(parseFilters('{"difficulty":"hard","status":"done","chapter":"第二章","q":"夹逼"}')).toEqual({ difficulty: 'hard', status: 'done', chapter: '第二章', q: '夹逼' })
  })

  it('存了能读回来；没有存储也不抛错', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    saveFilters({ ...EMPTY_FILTERS, difficulty: 'easy' })
    expect(loadFilters().difficulty).toBe('easy')
    vi.stubGlobal('sessionStorage', undefined)
    expect(loadFilters()).toEqual(EMPTY_FILTERS)
    expect(() => saveFilters(EMPTY_FILTERS)).not.toThrow()
  })

  it('有没有在筛选', () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false)
    expect(filtersActive({ ...EMPTY_FILTERS, q: '  ' })).toBe(false)
    expect(filtersActive({ ...EMPTY_FILTERS, q: '夹逼' })).toBe(true)
    expect(filtersActive({ ...EMPTY_FILTERS, chapter: '第二章' })).toBe(true)
    expect(filtersActive({ ...EMPTY_FILTERS, difficulty: 'hard' })).toBe(true)
    expect(filtersActive({ ...EMPTY_FILTERS, status: 'todo' })).toBe(true)
  })

  it('请求参数：全部就是不传，搜索去空格，游标带上', () => {
    expect(zoneQuery(EMPTY_FILTERS)).toEqual({ limit: ZONE_PAGE_SIZE })
    expect(zoneQuery({ chapter: '第二章', difficulty: 'hard', status: 'active', q: ' 夹逼 ' }, { cursor: 'c1' })).toEqual({
      chapter: '第二章',
      difficulty: 'hard',
      status: 'active',
      q: '夹逼',
      limit: ZONE_PAGE_SIZE,
      cursor: 'c1',
    })
    expect(zoneQuery(EMPTY_FILTERS, { limit: 50 }).limit).toBe(50)
  })

  it('随机只带章节和难度', () => {
    expect(randomFilter({ chapter: '第二章', difficulty: 'easy', status: 'done', q: 'x' })).toEqual({ chapter: '第二章', difficulty: 'easy' })
    expect(randomFilter(EMPTY_FILTERS)).toEqual({})
  })
})

describe('结果与刷新', () => {
  const facets = { chapters: [], difficulty: { easy: 3, medium: 2, hard: 1 } }

  it('总数来自难度分面', () => {
    expect(resultCount(facets, EMPTY_FILTERS)).toBe(6)
    expect(resultCount(facets, { ...EMPTY_FILTERS, difficulty: 'medium' })).toBe(2)
    expect(resultCount(null, EMPTY_FILTERS)).toBeNull()
  })

  it('一页装得下：整页换；装不下：只更新状态', () => {
    const current = [item('a'), item('b'), item('c')]
    expect(mergeRefreshed(current, [item('a', 'done')], true).map((i) => i.problemId)).toEqual(['a'])
    const merged = mergeRefreshed(current, [item('b', 'active')], false)
    expect(merged.map((i) => [i.problemId, i.status])).toEqual([
      ['a', 'todo'],
      ['b', 'active'],
      ['c', 'todo'],
    ])
  })
})

describe('解题思路的步骤', () => {
  it('没开始不能看，开始了能看，看过一级再看下一级', () => {
    expect(solutionStep(solution({ canReveal: false }))).toBe('locked')
    expect(solutionStep(solution())).toBe('offer')
    expect(solutionStep(solution({ level: 'approach' }))).toBe('approach')
    expect(solutionStep(solution({ level: 'full', canReveal: false }))).toBe('full')
  })

  it('既没思路也没证明：说明一句', () => {
    expect(solutionStep(solution({ hasApproach: false, hasFull: false }))).toBe('unavailable')
    expect(solutionStep(solution({ hasApproach: false, hasFull: false, canReveal: false }))).toBe('unavailable')
  })

  it('下一级：先思路后证明；没有思路时直接证明；不能看就没有', () => {
    expect(nextReveal(solution())).toBe('approach')
    expect(nextReveal(solution({ hasApproach: false }))).toBe('full')
    expect(nextReveal(solution({ hasApproach: false, hasFull: false }))).toBeNull()
    expect(nextReveal(solution({ level: 'approach' }))).toBe('full')
    expect(nextReveal(solution({ level: 'approach', hasFull: false }))).toBeNull()
    expect(nextReveal(solution({ level: 'full' }))).toBeNull()
    expect(nextReveal(solution({ canReveal: false }))).toBeNull()
  })
})
