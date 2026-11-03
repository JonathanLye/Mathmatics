import { describe, expect, it } from 'vitest'
import { groupNotesByLine, nextLineNoOf, notesForLine, selectTailNotes } from '@/components/layers/proofLines'
import type { Note, ProofLine } from '@/types/attempt'

// PR #90 复审第 5 条：把「批注按 lineId 挂载 / 尾部孤儿批注」抽成纯函数并进 CI 单测。
// 口径见 components/README.md：红笔批注按 note.lineId 挂对应行下方，找不到行则挂列表末尾。

function note(id: string, lineId: string | null, kind: Note['kind'] = 'annotation'): Note {
  return {
    noteId: id,
    kind,
    who: kind === 'annotation' ? '批注' : '助教',
    text: '第 ' + id + ' 条',
    lineId,
    level: null,
    cost: null,
    lessonConceptId: null,
    at: '2026-11-03T00:30:00.000Z',
  }
}

function line(n: number): ProofLine {
  return { lineId: 'line-' + n, n, statement: 'statement-' + n, provenance: 'keyboard' }
}

describe('groupNotesByLine（批注按 lineId 挂载）', () => {
  it('按 lineId 分组并保持服务端下发顺序', () => {
    const map = groupNotesByLine([note('a', 'line-1'), note('b', 'line-1'), note('c', 'line-2')])
    expect([...map.keys()]).toEqual(['line-1', 'line-2'])
    expect(map.get('line-1')?.map((n) => n.noteId)).toEqual(['a', 'b'])
    expect(map.get('line-2')?.map((n) => n.noteId)).toEqual(['c'])
  })

  it('lineId 为空的批注不进入任何行（由 selectTailNotes 处理）', () => {
    const map = groupNotesByLine([note('a', null), note('b', null)])
    expect(map.size).toBe(0)
  })

  it('不会修改传入的批注数组', () => {
    const notes = [note('a', 'line-1')]
    groupNotesByLine(notes)
    expect(notes.map((n) => n.noteId)).toEqual(['a'])
  })
})

describe('selectTailNotes（找不到行的批注挂列表末尾）', () => {
  const lines = [line(1), line(2)]

  it('lineId 为空 → 尾部', () => {
    expect(selectTailNotes(lines, [note('a', null)]).map((n) => n.noteId)).toEqual(['a'])
  })

  it('lineId 指向不存在的行（例如软删）→ 尾部', () => {
    expect(selectTailNotes(lines, [note('b', 'line-9')]).map((n) => n.noteId)).toEqual(['b'])
  })

  it('lineId 命中现存行 → 不进尾部', () => {
    expect(selectTailNotes(lines, [note('c', 'line-2')])).toEqual([])
  })

  it('保持原顺序，并保留所有尾部批注', () => {
    const notes = [note('a', null), note('b', 'line-2'), note('c', 'line-9'), note('d', 'line-1')]
    expect(selectTailNotes(lines, notes).map((n) => n.noteId)).toEqual(['a', 'c'])
  })

  it('列表为空时所有批注都是尾部批注', () => {
    expect(selectTailNotes([], [note('a', 'line-1')]).map((n) => n.noteId)).toEqual(['a'])
  })
})

describe('notesForLine', () => {
  it('有批注返回该行数组，没有返回空数组（不返回 undefined，模板可直接 v-for）', () => {
    const map = groupNotesByLine([note('a', 'line-1')])
    expect(notesForLine(map, 'line-1').map((n) => n.noteId)).toEqual(['a'])
    expect(notesForLine(map, 'line-2')).toEqual([])
  })
})

describe('nextLineNoOf（行号取 max(n)+1，不用数组长度）', () => {
  it('没有行时是 1', () => {
    expect(nextLineNoOf([])).toBe(1)
  })

  it('连续行 1、2 → 3', () => {
    expect(nextLineNoOf([line(1), line(2)])).toBe(3)
  })

  it('软删后不连续（剩 1、3）→ 4', () => {
    expect(nextLineNoOf([line(1), line(3)])).toBe(4)
  })

  it('乱序输入也按最大 n 计算', () => {
    expect(nextLineNoOf([line(3), line(1), line(2)])).toBe(4)
  })
})
