/**
 * 做题页的本机草稿（#27）：打开时恢复、输入时防抖落盘、提交成功后清除。
 * 只存 text/updatedAt，不参与判定；服务端 state 永远是真源。
 */
import { ref } from 'vue'
import { getDraftStore } from '@/storage/drafts'
import { useAttempt } from '@/stores/attempt'

export type RestoredDraft = 'def' | 'line_statement' | null

export function useDrafts() {
  const { state } = useAttempt()
  const draftStore = getDraftStore()
  /** 恢复提示：def（L1）| line_statement（L3 行）| null */
  const restoredDraft = ref<RestoredDraft>(null)
  const l1Initial = ref('')
  const lineDraftInitial = ref({ statement: '', justification: '' })

  /** 打开做题页时恢复本机草稿（#27）：只恢复当前 attempt/layer 的必要字段。 */
  async function restoreDrafts(): Promise<void> {
    const attemptId = state.value.attemptId
    if (!attemptId) return
    if (state.value.currentLayer === 'L1') {
      const text = await draftStore.loadDraft(attemptId, 'def')
      if (text) {
        l1Initial.value = text
        restoredDraft.value = 'def'
      }
      return
    }
    if (state.value.currentLayer === 'L3') {
      const statement = await draftStore.loadDraft(attemptId, 'line_statement')
      const justification = await draftStore.loadDraft(attemptId, 'line_justification')
      if (statement || justification) {
        lineDraftInitial.value = { statement: statement ?? '', justification: justification ?? '' }
        restoredDraft.value = 'line_statement'
      }
    }
  }

  /** L1 输入 → 500ms 防抖写 IndexedDB（只存 text/updatedAt）。 */
  function saveDefinition(value: string): void {
    void draftStore.saveDraft(state.value.attemptId, 'def', value)
  }

  /** L3 行编辑器输入 → 防抖写「这一行 / 依据」两个草稿。 */
  function saveLine(d: { statement: string; justification: string }): void {
    void draftStore.saveDraft(state.value.attemptId, 'line_statement', d.statement)
    void draftStore.saveDraft(state.value.attemptId, 'line_justification', d.justification)
  }

  /** 提交成功后清除 L1 草稿（避免下次打开又恢复旧内容）。 */
  async function clearDefinition(attemptId: string): Promise<void> {
    l1Initial.value = ''
    await draftStore.clearDraft(attemptId, 'def')
    restoredDraft.value = null
  }

  /** 加行成功后清除这一行的本机草稿（失败时保留，便于重试）。 */
  async function clearLine(attemptId: string): Promise<void> {
    lineDraftInitial.value = { statement: '', justification: '' }
    restoredDraft.value = null
    await Promise.all([
      draftStore.clearDraft(attemptId, 'line_statement'),
      draftStore.clearDraft(attemptId, 'line_justification'),
    ])
  }

  function reset(): void {
    restoredDraft.value = null
    l1Initial.value = ''
    lineDraftInitial.value = { statement: '', justification: '' }
  }

  function flush(): void {
    draftStore.flush()
  }

  return { restoredDraft, l1Initial, lineDraftInitial, restoreDrafts, saveDefinition, saveLine, clearDefinition, clearLine, reset, flush }
}

export type DraftsHandle = ReturnType<typeof useDrafts>
