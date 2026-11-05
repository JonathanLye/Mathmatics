<script setup lang="ts">
/**
 * 行编辑器（issue #12；02 §4.4）。
 *
 * 布局（PR #90 复审第 6 条决策，2026-11-03）：
 * - 手机（<600px）从底部升起弹层；
 * - 平板/桌面（≥600px）用居中的对话框卡片，不做"稿纸内联展开"。
 *   决策已写进 02 §4.4 与本目录 README，组件里不再用注释代替规范。
 *
 * 输入：本轮先用 textarea + 常用符号快捷条（#13 的 MathTextEditor + ProofKeyboard 落地后替换输入区，
 * 提交契约 LineDraft / InputMeta 不变）；「依据」默认键盘，依据可空（02 §4.4）。
 *
 * 不做判定：只保证「这一行」非空才可提交；provenance 本轮固定 keyboard（#15 接入后由父级传 ink/photo/mixed）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
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

let previousFocus: HTMLElement | null = null

function onKeydown(event: KeyboardEvent) {
  // Esc 关闭（H5；小程序端不挂监听）
  if (event.key === 'Escape') close()
}

function bindKeyboard(open: boolean) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (open) {
    previousFocus = (document.activeElement as HTMLElement | null) ?? null
    window.addEventListener('keydown', onKeydown)
  } else {
    window.removeEventListener('keydown', onKeydown)
    // 焦点归还（a11y）：关闭后回到打开前的元素
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
    previousFocus = null
  }
}

watch(
  () => props.open,
  (open) => {
    // 只在 open 翻转时重置草稿；打开期间 lineNo / 409 静默刷新不清空学生输入（PR #90 复审建议）。
    if (open) resetDraft()
    bindKeyboard(open)
  },
  { immediate: true },
)

onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
})

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
  <view v-if="props.open" class="pg-editor-mask" data-testid="editor-mask" @tap="close">
    <view
      class="pg-editor"
      data-testid="editor-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="'第 ' + props.lineNo + ' 行编辑'"
      @tap.stop
    >
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
          aria-label="这一行"
          placeholder="这一行：写下结论或算式（公式用 $…$，例如 $rac{5}{n+2}$）"
          :disabled="props.busy"
          :maxlength="2000"
          @input="onStatementInput"
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
          aria-label="依据（可空）"
          placeholder="依据：这一行由哪条定义或已证结论得到？"
          :disabled="props.busy"
          :maxlength="1000"
          @input="onJustificationInput"
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
/* 遮罩：用 token 混色，不写死 rgba（README 硬规则 2）。 */
.pg-editor-mask {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  /* 手机软键盘：tokens.css 的 --keyboard-inset 由 visualViewport 写入（02 §6）。 */
  padding-bottom: var(--keyboard-inset, 0px);
  background: color-mix(in srgb, var(--ink) 35%, transparent);
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
  gap: var(--sp-2);
}

.pg-editor__title {
  font-size: 17px;
  font-weight: 900;
  color: var(--ink);
}

.pg-editor__hint {
  color: var(--ink-2);
  line-height: 1.5;
}

.pg-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
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

/* 相邻按钮间距 ≥ 8px（02 §2.4）。 */
.pg-editor__symbols {
  display: flex;
  gap: var(--sp-2);
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

/*
 * 平板/桌面（≥600px）：居中的对话框卡片（不是稿纸内联展开）。
 * 决策口径：02 §4.4 + components/README.md（PR #90 复审第 6 条选路线 ②：改文档、保留居中卡片）。
 */
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
