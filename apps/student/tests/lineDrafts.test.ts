import { describe, expect, it } from 'vitest'
import { buildLineDraft } from '@/components/lineDrafts'

// PR #90 复审第 1、2 条：
// - 依据非空要带 justificationInput（独立 provenance/draftId，03 §1）；
// - draftId 由调用方传入并复用，buildLineDraft 不生成 id（每次 submit 重新生成会破坏幂等）。

const base = {
  statement: '  $|a_n-3|=\\frac{5}{n+2}$  ',
  justification: '  通分  ',
  statementDraftId: 'draft-statement-1',
  justificationDraftId: 'draft-justification-1',
}

describe('buildLineDraft（LineDraft 构造，PR #90）', () => {
  it('这一行/依据都 trim', () => {
    const draft = buildLineDraft(base)
    expect(draft.statement).toBe('$|a_n-3|=\\frac{5}{n+2}$')
    expect(draft.justification).toBe('通分')
  })

  it('依据非空时带 justificationInput，provenance 与独立 draftId 正确', () => {
    const draft = buildLineDraft(base)
    expect(draft.input).toEqual({ provenance: 'keyboard', draftId: 'draft-statement-1' })
    expect(draft.justificationInput).toEqual({ provenance: 'keyboard', draftId: 'draft-justification-1' })
    expect(draft.justificationInput?.draftId).not.toBe(draft.input.draftId)
  })

  it('依据为空时不带 justificationInput（依据可空，02 §4.4）', () => {
    const draft = buildLineDraft({ ...base, justification: '   ' })
    expect(draft.justificationInput).toBeUndefined()
  })

  it('draftId 原样透传（重试复用；本函数不生成新 id）', () => {
    const first = buildLineDraft(base)
    const retry = buildLineDraft(base)
    expect(retry.input.draftId).toBe(first.input.draftId)
    expect(retry.input.draftId).toBe('draft-statement-1')
    expect(retry.justificationInput?.draftId).toBe('draft-justification-1')
  })

  it('输入来源可由父级指定（#15 手写/识别接入用 ink/photo/mixed）', () => {
    const draft = buildLineDraft({ ...base, provenance: 'mixed' })
    expect(draft.input.provenance).toBe('mixed')
    expect(draft.justificationInput?.provenance).toBe('mixed')
  })
})
