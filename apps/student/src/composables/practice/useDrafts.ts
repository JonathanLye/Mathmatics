/**
 * 做题页的本机草稿（#27）：打开时恢复、输入时防抖落盘、提交成功后清除。
 * 只存 text/updatedAt，不参与判定；服务端 state 永远是真源。
 */
import { ref } from 'vue'
import { backupDraft } from '@/api/client'
import { getDraftStore } from '@/storage/drafts'
import { useAttempt } from '@/stores/attempt'

export type RestoredDraft = 'def' | 'line_statement' | null

/** 服务端备份的节奏（06 putDraft）：最多 15 秒一次，切后台时马上一次。 */
export const DRAFT_BACKUP_MS = 15000

export function useDrafts() {
  const { state } = useAttempt()
  const draftStore = getDraftStore()
  /** 恢复提示：def（L1）| line_statement（L3 行）| null */
  const restoredDraft = ref<RestoredDraft>(null)
  const l1Initial = ref('')
  const lineDraftInitial = ref({ statement: '', justification: '' })

  /** 等着备份的落点：同一落点只留最新一份。 */
  const backupQueue = new Map<string, { attemptId: string; target: string; text: string }>()
  let backupTimer: ReturnType<typeof setTimeout> | null = null

  function queueBackup(attemptId: string, target: string, text: string): void {
    if (!attemptId) return
    backupQueue.set(attemptId + ':' + target, { attemptId, target, text })
    if (!backupTimer) backupTimer = setTimeout(sendBackups, DRAFT_BACKUP_MS)
  }

  function sendBackups(): void {
    if (backupTimer) clearTimeout(backupTimer)
    backupTimer = null
    const batch = [...backupQueue.values()]
    backupQueue.clear()
    // 备份是兜底：失败了本机草稿还在，下一次输入会再排队。
    for (const item of batch) void backupDraft(item.attemptId, item.target, { text: item.text }).catch(() => undefined)
  }

  function dropBackup(attemptId: string, target: string): void {
    backupQueue.delete(attemptId + ':' + target)
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') sendBackups()
  }

  /** 页面打开时调用：切后台也备份一次。 */
  function startBackup(): void {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  }

  /** 离开页面时调用：把还没发的发掉。 */
  function stopBackup(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    sendBackups()
  }

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
    queueBackup(state.value.attemptId, 'def', value)
  }

  /** L3 行编辑器输入 → 防抖写「这一行 / 依据」两个草稿。 */
  function saveLine(d: { statement: string; justification: string }): void {
    void draftStore.saveDraft(state.value.attemptId, 'line_statement', d.statement)
    void draftStore.saveDraft(state.value.attemptId, 'line_justification', d.justification)
    queueBackup(state.value.attemptId, 'line_statement', d.statement)
    queueBackup(state.value.attemptId, 'line_justification', d.justification)
  }

  /** 提交成功后清除 L1 草稿（避免下次打开又恢复旧内容）。 */
  async function clearDefinition(attemptId: string): Promise<void> {
    l1Initial.value = ''
    dropBackup(attemptId, 'def')
    await draftStore.clearDraft(attemptId, 'def')
    restoredDraft.value = null
  }

  /** 加行成功后清除这一行的本机草稿（失败时保留，便于重试）。 */
  async function clearLine(attemptId: string): Promise<void> {
    lineDraftInitial.value = { statement: '', justification: '' }
    restoredDraft.value = null
    dropBackup(attemptId, 'line_statement')
    dropBackup(attemptId, 'line_justification')
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

  return { startBackup, stopBackup, restoredDraft, l1Initial, lineDraftInitial, restoreDrafts, saveDefinition, saveLine, clearDefinition, clearLine, reset, flush }
}

export type DraftsHandle = ReturnType<typeof useDrafts>
