/**
 * 行提交草稿（LineDraft）的纯构造函数（PR #90 复审第 1、2 条）。
 *
 * - 依据是独立输入落点（03 §1）：依据非空时必须带 justificationInput（自己的 provenance/draftId），
 *   否则服务端诚信/no_provenance 判定拿不到依据的输入来源；
 * - draftId 由调用方（useComposer 打开输入器时生成一次、重试复用）传入，这里不生成任何 id；
 *   每次 submit 重新生成 uuid 会破坏 #19 的幂等（服务端会当成新草稿）。
 */
import type { InputMeta, InputProvenance, LineDraft } from '@/types/attempt'

export interface LineDraftInput {
  statement: string
  justification: string
  /** 「这一行」落点的 draftId（打开编辑器时生成，重试复用）。 */
  statementDraftId: string
  /** 「依据」落点的 draftId（独立生成；依据为空时不会使用）。 */
  justificationDraftId: string
  /** 本轮只有键盘；#15 手写/识别接入后由父级传入 ink/photo/mixed 与 recogId。 */
  provenance?: InputProvenance
}

/** 构造一次 LineDraft 提交；不做内容判定（非空校验在组件上，空依据只是不带 justificationInput）。 */
export function buildLineDraft(params: LineDraftInput): LineDraft {
  const provenance: InputProvenance = params.provenance ?? 'keyboard'
  const statement = params.statement.trim()
  const justification = params.justification.trim()
  const input: InputMeta = { provenance, draftId: params.statementDraftId }
  const draft: LineDraft = { statement, justification, input }
  if (justification) {
    draft.justificationInput = { provenance, draftId: params.justificationDraftId }
  }
  return draft
}
