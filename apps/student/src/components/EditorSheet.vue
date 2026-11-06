<script setup lang="ts">
/**
 * 行编辑器（issue #12；02 §4.4）。
 *
 * 布局（PR #90 复审第 6 条决策，2026-11-03）：
 * - 手机从底部升起弹层，宽屏是居中的对话框卡片（都由 PgSheet 负责），不做"稿纸内联展开"。
 *   决策已写进 02 §4.4 与本目录 README。
 *
 * 输入：本轮先用 textarea + 常用符号快捷条（#13 的 MathTextEditor + ProofKeyboard 落地后替换输入区，
 * 提交契约 LineDraft / InputMeta 不变）；「依据」默认键盘，依据可空（02 §4.4）。
 *
 * 不做判定：只保证「这一行」非空才可提交；provenance 本轮固定 keyboard（#15 接入后由父级传 ink/photo/mixed）。
 */
import { computed, ref, watch } from 'vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgField from '@/components/ui/PgField.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { buildLineDraft } from './lineDrafts'
import type { InputProvenance, LineDraft } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    open?: boolean
    lineNo?: number
    initialStatement?: string
    initialJustification?: string
    busy?: boolean
  }>(),
  { open: false, lineNo: 1, initialStatement: '', initialJustification: '', busy: false },
)
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', draft: LineDraft): void
  (e: 'request-recognition'): void
  /** #27：输入变化上抛给父级，由父级防抖写 IndexedDB 草稿（不改变提交语义）。 */
  (e: 'update:draft', d: { statement: string; justification: string }): void
}>()

const statement = ref('')
const justification = ref('')
/** 用户是否改过这个字段：用于 #15/#16 识别确认回灌 initial* 时不覆盖学生已输入的内容。 */
const statementDirty = ref(false)
const justificationDirty = ref(false)

/**
 * draftId 生命周期（PR #90 复审第 2 条）：
 * - 打开编辑器时生成一次：「这一行」「依据」各一个独立 id（03 §1 一个落点一个 draftId）；
 * - 打开期间的重试/超时重发复用同一对 id；只有重新打开（或提交成功后再次打开）才换新 id。
 */
const statementDraftId = ref('')
const justificationDraftId = ref('')

/** draftId 只用于本地草稿/幂等标识（03 §1），不参与判定。 */
function newDraftId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 父级 state 是唯一真源：只在打开编辑器时把草稿灌进来，并生成这一轮草稿的 draftId。 */
function resetDraft() {
  statement.value = props.initialStatement ?? ''
  justification.value = props.initialJustification ?? ''
  statementDirty.value = false
  justificationDirty.value = false
  statementDraftId.value = newDraftId()
  justificationDraftId.value = newDraftId()
}

/**
 * #15/#16 识别确认后回灌 initial*：打开期间父级更新草稿时同步，但只用没被学生改过的字段，
 * 避免把学生正在编辑的内容清掉（02 §5：保留未提交输入）。
 */
watch(
  () => props.initialStatement,
  (value) => {
    if (props.open && !statementDirty.value) statement.value = value ?? ''
  },
)
watch(
  () => props.initialJustification,
  (value) => {
    if (props.open && !justificationDirty.value) justification.value = value ?? ''
  },
)

/**
 * #27 草稿接线：只在打开期间把「这一行 / 依据」的当前值上抛（父级做 500ms 防抖落 IndexedDB）。
 * 不触碰 dirty 状态、draftId 与提交流程，保证 main（#90/#12）语义不变。
 */
watch([statement, justification], ([nextStatement, nextJustification]) => {
  if (props.open) emit('update:draft', { statement: nextStatement, justification: nextJustification })
})

watch(
  () => props.open,
  (open) => {
    // 只在 open 翻转时重置草稿；打开期间 lineNo / 409 静默刷新不清空学生输入（PR #90 复审建议）。
    if (open) resetDraft()
  },
  { immediate: true },
)

/** 常用符号（临时）：#13 的证明键盘落地后由 ProofKeyboard 替换。 */
const SYMBOLS: Array<{ label: string; insert: string }> = [
  { label: '∀', insert: '∀' },
  { label: '∃', insert: '∃' },
  { label: 'ε', insert: 'ε' },
  { label: 'δ', insert: 'δ' },
  { label: '≤', insert: '≤' },
  { label: '≥', insert: '≥' },
  { label: '≠', insert: '≠' },
  { label: '→', insert: '→' },
  { label: '⇒', insert: '⇒' },
  { label: '∞', insert: '∞' },
  { label: '⌈', insert: '⌈' },
  { label: '⌉', insert: '⌉' },
  { label: '（', insert: '（' },
  { label: '）', insert: '）' },
  { label: '$', insert: '$' },
]

function insertSymbol(text: string) {
  if (props.busy) return
  statement.value = statement.value + text
  statementDirty.value = true
}

function onStatementInput() {
  statementDirty.value = true
}

function onJustificationInput() {
  justificationDirty.value = true
}

const canSubmit = computed(() => statement.value.trim().length > 0 && !props.busy)

function close() {
  if (props.busy) return
  emit('update:open', false)
}

/**
 * 提交时只读取打开时生成的那一对 draftId，绝不在这里生成新 id：
 * 重试/超时重发/409 后重点都复用同一个 draftId（PR #90 复审第 2 条）。
 */
function submit() {
  if (!canSubmit.value) return
  const draft = buildLineDraft({
    statement: statement.value,
    justification: justification.value,
    statementDraftId: statementDraftId.value,
    justificationDraftId: justificationDraftId.value,
    provenance: 'keyboard' as InputProvenance,
  })
  emit('submit', draft)
}
</script>

<template>
  <PgSheet
    :open="props.open"
    :persistent="props.busy"
    :z-index="65"
    mask-testid="editor-mask"
    class="pg-editor"
    data-testid="editor-sheet"
    :aria-label="'第 ' + props.lineNo + ' 行编辑'"
    @update:open="close"
  >
    <view class="pg-editor__head">
      <text class="pg-editor__title">第 {{ props.lineNo }} 行</text>
      <text class="pg-editor__hint">一次写一行：先写「这一行」，再写「依据」。依据可以留空，助教会追问。</text>
    </view>

    <PgField label="这一行">
      <textarea
        v-model="statement"
        class="pg-input-area pg-input-area--md"
        data-testid="editor-statement"
        aria-label="这一行"
        placeholder="这一行：写下结论或算式（公式用 $…$，例如 $\frac{5}{n+2}$）"
        :disabled="props.busy"
        :maxlength="2000"
        @input="onStatementInput"
      />
      <view class="pg-editor__symbols pg-scroll-x" data-testid="symbol-bar" aria-label="常用符号">
        <PgButton
          v-for="symbol in SYMBOLS"
          :key="symbol.label"
          class="pg-editor__symbol"
          variant="secondary"
          size="icon"
          :disabled="props.busy"
          :aria-label="'插入 ' + symbol.label"
          @tap="insertSymbol(symbol.insert)"
        >
          {{ symbol.label }}
        </PgButton>
      </view>
    </PgField>

    <PgField label="依据" optional="可空">
      <textarea
        v-model="justification"
        class="pg-input-area pg-input-area--xs"
        data-testid="editor-justification"
        aria-label="依据（可空）"
        placeholder="依据：这一行由哪条定义或已证结论得到？"
        :disabled="props.busy"
        :maxlength="1000"
        @input="onJustificationInput"
      />
    </PgField>

    <view class="pg-layer__row">
      <PgButton variant="secondary" data-testid="editor-cancel" :disabled="props.busy" @tap="close">取消</PgButton>
      <PgButton data-testid="editor-submit" :loading="props.busy" :disabled="!canSubmit" sound="tap" @tap="submit">
        {{ props.busy ? '正在加入…' : '加入证明' }}
      </PgButton>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-editor__head { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-editor__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-editor__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-editor__symbols { display: flex; gap: var(--sp-2); padding-bottom: var(--lip); }
.pg-editor__symbol.pg-button { flex: none; font-size: var(--fs-16); }
</style>
