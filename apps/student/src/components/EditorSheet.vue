<script setup lang="ts">
/**
 * 行编辑器（issue #12；02 §4.4）。
 *
 * 本轮先给「这一行」+「依据」两个输入区和一条常用符号快捷条：
 * - 现在就能加行、跑通 #12 的 DoD；#13 的 <MathTextEditor> + <ProofKeyboard> 落地后，
 *   把这两个 textarea 换成 MathTextEditor 即可，提交契约（LineDraft）不变。
 * - 快捷条暂时把符号追加在文本末尾；#13 键盘会按 keyboard-layout.json 处理光标与 `$…$` 包裹。
 * - 前端不做判定：只保证「这一行」非空才可提交（02 §4.4），依据可空（服务端会追问）。
 * - provenance 本轮固定 keyboard；#15 手写/识别接入后由父级按 InputProvenance 传入。
 */
import { computed, ref, watch } from 'vue'
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
}>()

const statement = ref('')
const justification = ref('')

/** 父级 state 是唯一真源：每次打开（或换行）时把草稿灌进来，本地只做编辑缓冲。 */
function resetDraft() {
  statement.value = props.initialStatement ?? ''
  justification.value = props.initialJustification ?? ''
}

watch(
  () => props.open,
  (open) => {
    if (open) resetDraft()
  },
  { immediate: true },
)

watch(
  () => props.lineNo,
  () => {
    if (props.open) resetDraft()
  },
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
}

const canSubmit = computed(() => statement.value.trim().length > 0 && !props.busy)

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

function close() {
  if (props.busy) return
  emit('update:open', false)
}

function submit() {
  if (!canSubmit.value) return
  const draft: LineDraft = {
    statement: statement.value.trim(),
    justification: justification.value.trim(),
    // 本轮只有键盘输入；#15 识别确认后由父级换成为 ink/photo/mixed 并带 recogId。
    input: { provenance: 'keyboard' as InputProvenance, draftId: newDraftId() },
  }
  emit('submit', draft)
}
</script>

<template>
  <view v-if="props.open" class="pg-editor-mask" data-testid="editor-mask" @tap="close">
    <view class="pg-editor" data-testid="editor-sheet" @tap.stop>
      <view class="pg-editor__handle" />
      <view class="pg-editor__head">
        <text class="pg-editor__title">第 {{ props.lineNo }} 行</text>
        <text class="pg-editor__hint pg-small">一次写一行：先写「这一行」，再写「依据」。依据可以留空，服务端会追问。</text>
      </view>

      <view class="pg-editor__field">
        <text class="pg-editor__label">这一行</text>
        <textarea
          v-model="statement"
          class="pg-editor__input"
          data-testid="editor-statement"
          placeholder="这一行：写下结论或算式（公式用 $…$，例如 $\frac{5}{n+2}$）"
          :disabled="props.busy"
          :maxlength="2000"
        />
        <view class="pg-editor__symbols pg-scroll-x" data-testid="symbol-bar" aria-label="常用符号">
          <button
            v-for="symbol in SYMBOLS"
            :key="symbol.label"
            class="pg-editor__symbol"
            :disabled="props.busy"
            :aria-label="'插入 ' + symbol.label"
            @tap="insertSymbol(symbol.insert)"
          >
            {{ symbol.label }}
          </button>
        </view>
      </view>

      <view class="pg-editor__field">
        <text class="pg-editor__label">依据 <text class="pg-editor__optional pg-small">可空</text></text>
        <textarea
          v-model="justification"
          class="pg-editor__input pg-editor__input--just"
          data-testid="editor-justification"
          placeholder="依据：这一行由哪条定义或已证结论得到？"
          :disabled="props.busy"
          :maxlength="1000"
        />
      </view>

      <view class="pg-editor__actions">
        <button class="pg-editor__btn" data-testid="editor-cancel" :disabled="props.busy" @tap="close">取消</button>
        <button
          class="pg-editor__btn pg-editor__btn--primary"
          data-testid="editor-submit"
          :disabled="!canSubmit"
          @tap="submit"
        >
          {{ props.busy ? '正在加入…' : '加入证明' }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-editor-mask {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(29, 36, 48, 0.35);
}

.pg-editor {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  max-width: var(--content-max);
  max-height: 88vh;
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  background: var(--sheet);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-sheet);
  animation: pg-editor-up var(--dur-normal) ease-out;
}

.pg-editor__handle {
  width: 36px;
  height: 4px;
  margin: 0 auto;
  border-radius: 2px;
  background: var(--rule);
}

.pg-editor__head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.pg-editor__title {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.pg-editor__hint {
  color: var(--ink-2);
  line-height: 1.5;
}

.pg-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.pg-editor__label {
  font-size: var(--fs-small);
  color: var(--ink-2);
}

.pg-editor__optional {
  color: var(--ink-2);
}

/* 输入框 16px 防 iOS 聚焦缩放（02 §2.3 / §6）。 */
.pg-editor__input {
  width: 100%;
  min-height: 88px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: var(--lh-body);
  resize: vertical;
}

.pg-editor__input--just {
  min-height: 64px;
}

.pg-editor__symbols {
  display: flex;
  gap: var(--sp-1);
  overflow-x: auto;
  padding-bottom: 2px;
}

/* 触控目标 ≥ 44px（02 §2.4）。 */
.pg-editor__symbol {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
  color: var(--ink);
  font-size: 16px;
}

.pg-editor__symbol::after {
  border: 0;
}

.pg-editor__symbol:disabled {
  opacity: 0.45;
}

.pg-editor__actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.pg-editor__btn {
  flex: 1;
  min-height: 48px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: 16px;
}

.pg-editor__btn::after {
  border: 0;
}

.pg-editor__btn:disabled {
  opacity: 0.45;
}

.pg-editor__btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--paper);
}

/* 平板/桌面：同一定位方式，改成居中的卡片，不占满整屏（组件内 CSS 自适应）。 */
@media (min-width: 600px) {
  .pg-editor-mask {
    align-items: center;
    padding: var(--sp-4);
  }

  .pg-editor {
    max-width: 560px;
    max-height: 80vh;
    padding-bottom: var(--sp-4);
    border-radius: var(--radius-card);
  }
}

@keyframes pg-editor-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
