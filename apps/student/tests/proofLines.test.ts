import { describe, expect, it } from 'vitest'
import { filterDismissedNotes, formatNoteTime, groupNotesByLine, mergeNotes, nextLineNoOf, notesForLine, parseNote, selectTailNotes } from '@/components/layers/proofLines'
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

// ---------------------------------------------------------------------------
// #151（#141 P2-1 A 侧）：check_line 行批注的前端纯逻辑
// ---------------------------------------------------------------------------

/** openapi Note 的正常形状（packages/contracts/openapi.yaml：noteId/kind/who/text/at 必填，lineId 可选）。 */
function openapiNote(overrides: Partial<Note> = {}): Note {
  return {
    noteId: 'annotation-1',
    kind: 'annotation',
    who: '批注',
    text: '你这一行的依据写的是哪条？',
    lineId: 'line-2',
    level: null,
    cost: null,
    lessonConceptId: null,
    at: '2026-11-04T14:30:00.000Z',
    ...overrides,
  }
}

describe('parseNote（#151：/help 的 res.note 运行时收敛）', () => {
  it('openapi Note 必填字段齐全 → 收敛为可渲染 Note', () => {
    const parsed = parseNote(openapiNote())
    expect(parsed).toMatchObject({
      noteId: 'annotation-1',
      kind: 'annotation',
      who: '批注',
      lineId: 'line-2',
      text: '你这一行的依据写的是哪条？',
    })
  })

  it('lineId/level/cost/lessonConceptId 缺省时收敛为 null（不渲染 undefined）', () => {
    const raw = { noteId: 'n', kind: 'annotation', who: '批注', text: '问一句', at: '2026-11-04T14:30:00.000Z' }
    const parsed = parseNote(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.lineId).toBeNull()
    expect(parsed?.level).toBeNull()
    expect(parsed?.cost).toBeNull()
    expect(parsed?.lessonConceptId).toBeNull()
  })

  it('忽略契约之外的未知字段（openapi Note additionalProperties:false）', () => {
    const parsed = parseNote({ ...openapiNote(), id: 'legacy-id', authorName: '老师', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(parsed?.noteId).toBe('annotation-1')
    expect(parsed?.who).toBe('批注')
  })

  it('缺必填字段 / kind 不在枚举 / at 非法 / 非对象 → null（不渲染半截卡片）', () => {
    expect(parseNote(null)).toBeNull()
    expect(parseNote(undefined)).toBeNull()
    expect(parseNote('not-a-note')).toBeNull()
    expect(parseNote([])).toBeNull()
    expect(parseNote({ ...openapiNote(), noteId: '' })).toBeNull()
    expect(parseNote({ ...openapiNote(), who: '' })).toBeNull()
    expect(parseNote({ ...openapiNote(), text: '' })).toBeNull()
    expect(parseNote({ ...openapiNote(), kind: 'unknown-kind' })).toBeNull()
    expect(parseNote({ ...openapiNote(), at: 'not-a-date' })).toBeNull()
  })
})

describe('mergeNotes（state.notes + 本次会话 res.note 按 noteId 合并）', () => {
  it('按 noteId 去重：先出现的优先（state.notes 是服务端权威版本），保持下发顺序', () => {
    const fromState = [openapiNote({ noteId: 'a' }), openapiNote({ noteId: 'b' })]
    const fromSession = [openapiNote({ noteId: 'b', text: '本地副本' }), openapiNote({ noteId: 'c' })]
    const merged = mergeNotes(fromState, fromSession)
    expect(merged.map((n) => n.noteId)).toEqual(['a', 'b', 'c'])
    expect(merged[1]?.text).toBe('你这一行的依据写的是哪条？')
  })

  it('跳过 null/undefined 组与重复 id，不修改入参', () => {
    const fromState = [openapiNote({ noteId: 'a' })]
    const merged = mergeNotes(null, fromState, undefined, [openapiNote({ noteId: 'a' }), openapiNote({ noteId: 'b' })])
    expect(merged.map((n) => n.noteId)).toEqual(['a', 'b'])
    expect(fromState.map((n) => n.noteId)).toEqual(['a'])
  })
})

describe('按 lineId 分组 + 合并后不串行（#151：另一行不串）', () => {
  it('不同 lineId 的批注各自挂到对应行：line-1 与 line-2 互不污染', () => {
    const notes = mergeNotes(
      [openapiNote({ noteId: 'state-1', lineId: 'line-1', text: '第 1 行衔接上了' })],
      [openapiNote({ noteId: 'session-2', lineId: 'line-2', text: '你这一行的依据写的是哪条？' })],
    )
    const byLine = groupNotesByLine(notes)
    expect(notesForLine(byLine, 'line-1').map((n) => n.noteId)).toEqual(['state-1'])
    expect(notesForLine(byLine, 'line-2').map((n) => n.noteId)).toEqual(['session-2'])
    expect(notesForLine(byLine, 'line-3')).toEqual([])
  })
})

describe('filterDismissedNotes（#151：可关闭）', () => {
  it('关闭的 noteId 从渲染列表去掉，其余批注保留', () => {
    const notes = [openapiNote({ noteId: 'a' }), openapiNote({ noteId: 'b' })]
    const visible = filterDismissedNotes(notes, new Set(['a']))
    expect(visible.map((n) => n.noteId)).toEqual(['b'])
  })

  it('空集合返回等值副本（不改入参，模板可直接用）', () => {
    const notes = [openapiNote({ noteId: 'a' })]
    const visible = filterDismissedNotes(notes, new Set())
    expect(visible.map((n) => n.noteId)).toEqual(['a'])
    expect(visible).not.toBe(notes)
  })
})

describe('formatNoteTime（#151：批注时间显示 MM-DD HH:mm）', () => {
  it('UTC 下输出确定（单测不依赖本机时区）', () => {
    expect(formatNoteTime('2026-11-04T14:30:00.000Z', 'UTC')).toBe('11-04 14:30')
  })

  it('按 IANA 时区换算（Asia/Shanghai）', () => {
    expect(formatNoteTime('2026-11-04T14:30:00.000Z', 'Asia/Shanghai')).toBe('11-04 22:30')
  })

  it('空/非法时间返回空串（调用方隐藏时间行，不显示 Invalid Date）', () => {
    expect(formatNoteTime('')).toBe('')
    expect(formatNoteTime('not-a-date')).toBe('')
  })
})
