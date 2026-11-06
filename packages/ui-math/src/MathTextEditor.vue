<script setup lang="ts">
/**
 * MathText 编辑器（#13，03-手写键盘与识别.md §4.3 P0：源码 + 实时预览）。
 *
 * 受控约定：
 * - 文本：v-model（modelValue）或 v-model:text 均可；同时传时 text 优先。
 *   每次变化两个事件都会发（update:modelValue / update:text），父级按需监听。
 * - 证明键盘：keyboardOpen=true 时 textarea 设 inputmode="none"，屏蔽系统键盘；
 *   父级把 keyboardOpen 置 false 且收到「中」（request-system-keyboard）后，编辑器自动聚焦并恢复系统键盘。
 *
 * 供键盘调用的 API（defineExpose）：
 *   insert(text, mode?)      直接插入符号/模板文本（mode 默认 math，会自动补 $…$）
 *   insertKey(key, variant?) 按 keyboard-layout 归一化后的键插入（含长按变体）
 *   insertPayload(payload)   ProofKeyboard 的 insert 事件载荷
 *   applyAction(id)          右侧动作列：left/right/next/backspace/system/ink/done
 *   enterSystemKeyboard()    「中」：emit request-system-keyboard 后切系统键盘
 *   focus() / blur() / setCaret(pos, end?) / getState()
 *
 * 推荐接线（父级在一个弹层里同时放编辑器和键盘）：
 *   <MathTextEditor ref="editor" v-model="text" :keyboard-open="kbOpen"
 *     @request-system-keyboard="kbOpen = false" @close-keyboard="kbOpen = false" />
 *   <ProofKeyboard :visible="kbOpen"
 *     @insert="editor?.insertPayload($event)"
 *     @action="editor?.applyAction($event)" />
 *
 * H5 用原生 DOM 读写光标；小程序端（P2）只维护状态，无法直接定位原生光标。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MathText from './MathText.vue'
import {
  applyEditorAction,
  buildPreviewText,
  createEditorState,
  findNextPlaceholder,
  insertKey as insertKeyState,
  keyboardInsert,
  reconcileText,
  type EditorState,
  type KeyboardActionId,
  type KeyboardKeyMode,
  type KeyboardLayoutKey,
} from './keyboard'

// showPreview 默认 true：Vue 的布尔 prop 缺省会被转换成 false，必须显式给默认值
const props = withDefaults(
  defineProps<{
    /** MathText 文本（v-model） */
    modelValue?: string
    /** MathText 文本（v-model:text），优先于 modelValue */
    text?: string
    placeholder?: string
    autofocus?: boolean
    /** 由父级控制：证明键盘是否展示（true 时屏蔽系统键盘） */
    keyboardOpen?: boolean
    disabled?: boolean
    minRows?: number
    /** 是否显示 KaTeX 预览（默认 true） */
    showPreview?: boolean
    /** 是否显示输入框下方的键盘状态行（默认 true；内嵌在表单里时可以关掉） */
    showMeta?: boolean
    maxlength?: number
  }>(),
  { showPreview: true, showMeta: true },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:text', value: string): void
  (e: 'request-system-keyboard'): void
  (e: 'close-keyboard'): void
  (e: 'ink'): void
  (e: 'focus'): void
  (e: 'blur'): void
}>()

/** 当前文本：text 优先于 modelValue */
function currentText(): string {
  if (props.text !== undefined) return String(props.text ?? '')
  return String(props.modelValue ?? '')
}

const textareaRef = ref<unknown>(null)
const state = ref<EditorState>(createEditorState(currentText()))
const wantFocus = ref(false)
const focused = ref(false)
const pendingSystemFocus = ref(false)

const minRows = computed(() => Math.max(2, Math.min(12, props.minRows ?? 3)))
const inputHeight = computed(() => Math.round(minRows.value * 1.65 * 16 + 20) + 'px')
const placeholderText = computed(() => props.placeholder || '答案会显示在这里')
const inputModeValue = computed<'none' | 'text'>(() =>
  props.disabled ? 'none' : props.keyboardOpen ? 'none' : 'text',
)
const activeAnchor = computed<number | undefined>(() =>
  state.value.anchors.includes(state.value.caret) ? state.value.caret : undefined,
)
const previewText = computed(() =>
  buildPreviewText(state.value.text, state.value.anchors, { activeAnchor: activeAnchor.value }),
)
const placeholderHint = computed(() => {
  const anchors = state.value.anchors
  if (anchors.length === 0) return ''
  const next = findNextPlaceholder(state.value)
  if (next === null) return ''
  return '占位 ' + (anchors.indexOf(next) + 1) + '/' + anchors.length + ' · ⇥ 下一个'
})

// ---------------------------------------------------------------------------
// 文本 / 光标同步
// ---------------------------------------------------------------------------

function emitText(value: string): void {
  emit('update:modelValue', value)
  emit('update:text', value)
}

/** 提交一次新的编辑状态：文本变化才 emit（光标/占位变化只影响预览） */
function commit(next: EditorState): void {
  const previous = state.value.text
  state.value = next
  if (next.text !== previous) emitText(next.text)
  scheduleDomSync()
}

/** 系统键盘/父级已改好的文本：只同步镜像，不再 emit（父级是源头） */
function syncFromExternal(nextText: string): void {
  if (nextText === state.value.text) return
  state.value = reconcileText(state.value, nextText, state.value.caret, state.value.selectionEnd)
  scheduleDomSync()
}

function onInput(event: unknown): void {
  const detail = (event as { detail?: { value?: unknown; cursor?: unknown } }).detail ?? {}
  const value = typeof detail.value === 'string' ? detail.value : state.value.text
  const cursor = typeof detail.cursor === 'number' && Number.isFinite(detail.cursor) ? detail.cursor : value.length
  const element = resolveNativeTextarea()
  const selectionEnd = element && typeof element.selectionEnd === 'number' ? element.selectionEnd : cursor
  state.value = reconcileText(state.value, value, cursor, selectionEnd)
  emitText(value)
  // 输入来自系统键盘时 DOM 已是正确的，不做回写，避免打断中文输入法
}

function onFocus(): void {
  focused.value = true
  wantFocus.value = true
  const element = resolveNativeTextarea()
  if (element && typeof element.selectionStart === 'number' && element.selectionStart >= 0) {
    const start = element.selectionStart
    const end = typeof element.selectionEnd === 'number' ? element.selectionEnd : start
    state.value = { ...state.value, caret: start, selectionEnd: end }
  }
  emit('focus')
}

function onBlur(): void {
  focused.value = false
  wantFocus.value = false
  emit('blur')
}

/** H5 原生 textarea（uni-app 的 textarea 内部节点）；小程序端返回 null */
function resolveNativeTextarea(): HTMLTextAreaElement | null {
  try {
    const raw = textareaRef.value
    if (!raw) return null
    const wrapper = raw as unknown as { $el?: unknown }
    const node = (wrapper.$el ?? raw) as unknown
    if (!node || typeof node !== 'object') return null
    const element = node as { tagName?: string; querySelector?: (selector: string) => Element | null }
    if (typeof element.tagName === 'string' && element.tagName.toLowerCase() === 'textarea') {
      return node as HTMLTextAreaElement
    }
    if (typeof element.querySelector === 'function') {
      const found = element.querySelector('textarea')
      if (found) return found as HTMLTextAreaElement
    }
  } catch {
    /* 非 H5 平台没有 DOM */
  }
  return null
}

function syncInputModeToDom(element = resolveNativeTextarea()): void {
  if (!element) return
  try {
    element.setAttribute('inputmode', inputModeValue.value)
    element.setAttribute('autocomplete', 'off')
    element.setAttribute('autocorrect', 'off')
    element.setAttribute('spellcheck', 'false')
  } catch {
    /* 忽略：属性不可写时由模板上的 inputmode 兜底 */
  }
}

function applyDomState(): void {
  const element = resolveNativeTextarea()
  if (!element) return
  if (element.value !== state.value.text) element.value = state.value.text
  syncInputModeToDom(element)
  const length = state.value.text.length
  const start = Math.max(0, Math.min(state.value.caret, length))
  const end = Math.max(start, Math.min(state.value.selectionEnd, length))
  try {
    element.setSelectionRange(start, end)
  } catch {
    /* 忽略 */
  }
}

function scheduleDomSync(): void {
  void nextTick(() => applyDomState())
}

/** 非法式补 $…$ 的插入（ProofKeyboard 的 insert 事件） */
function insert(text: string, mode: KeyboardKeyMode = 'math'): void {
  if (props.disabled) return
  commit(keyboardInsert(state.value, { insert: text, mode }))
}

/** 按归一化后的键盘键插入（长按变体传 variantIndex） */
function insertKey(key: KeyboardLayoutKey, variantIndex?: number): void {
  if (props.disabled) return
  commit(insertKeyState(state.value, key, variantIndex === undefined ? {} : { variantIndex }))
}

/** 直接转发 ProofKeyboard 的 insert 载荷 */
function insertPayload(payload: { text: string; mode?: KeyboardKeyMode }): void {
  insert(payload.text, payload.mode ?? 'math')
}

/** 右侧动作列 */
function applyAction(action: KeyboardActionId | string): void {
  if (action === 'system') {
    enterSystemKeyboard()
    return
  }
  if (action === 'done') {
    blurEditor()
    emit('close-keyboard')
    return
  }
  if (action === 'ink') {
    emit('ink')
    return
  }
  if (props.disabled) return
  commit(applyEditorAction(state.value, action))
}

/** 「中」：切到系统键盘写中文（父级收到后把 keyboardOpen 置 false） */
function enterSystemKeyboard(): void {
  if (props.disabled) return
  pendingSystemFocus.value = true
  emit('request-system-keyboard')
  if (!props.keyboardOpen) {
    pendingSystemFocus.value = false
    focusEditor()
  }
}

function focusEditor(): void {
  wantFocus.value = true
  void nextTick(() => {
    const element = resolveNativeTextarea()
    if (!element) return
    try {
      element.focus()
    } catch {
      /* 忽略 */
    }
    syncInputModeToDom(element)
  })
}

function blurEditor(): void {
  wantFocus.value = false
  const element = resolveNativeTextarea()
  if (element) {
    try {
      element.blur()
    } catch {
      /* 忽略 */
    }
  }
}

function setCaret(position: number, selectionEnd = position): void {
  const length = state.value.text.length
  const caret = Math.max(0, Math.min(position, length))
  const end = Math.max(0, Math.min(selectionEnd, length))
  state.value = { ...state.value, caret, selectionEnd: end }
  scheduleDomSync()
}

function getState(): EditorState {
  return { ...state.value, anchors: [...state.value.anchors] }
}

defineExpose({ insert, insertKey, insertPayload, applyAction, enterSystemKeyboard, focus: focusEditor, blur: blurEditor, setCaret, getState, state })

// ---------------------------------------------------------------------------
// 外部状态 / 生命周期
// ---------------------------------------------------------------------------

watch(
  () => [props.modelValue, props.text] as const,
  () => syncFromExternal(currentText()),
)

watch(
  () => props.keyboardOpen,
  (open) => {
    void nextTick(() => {
      syncInputModeToDom()
      if (open) {
        // 证明键盘接管：收起系统键盘，文本与光标状态保留
        pendingSystemFocus.value = false
        blurEditor()
      } else if (pendingSystemFocus.value) {
        pendingSystemFocus.value = false
        focusEditor()
      }
    })
  },
)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) blurEditor()
  },
)

/** 光标移动（点选/拖选）时同步状态，保证键盘插入落在正确位置 */
function onSelectionChange(): void {
  const element = resolveNativeTextarea()
  if (!element) return
  if (typeof document !== 'undefined' && document.activeElement !== element) return
  const start = element.selectionStart
  const end = element.selectionEnd
  if (typeof start !== 'number' || start < 0) return
  const caret = start
  const selectionEnd = typeof end === 'number' && end >= 0 ? end : start
  if (caret === state.value.caret && selectionEnd === state.value.selectionEnd) return
  state.value = { ...state.value, caret, selectionEnd }
}

onMounted(() => {
  scheduleDomSync()
  if (props.autofocus && !props.disabled) focusEditor()
  if (typeof document !== 'undefined') document.addEventListener('selectionchange', onSelectionChange)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('selectionchange', onSelectionChange)
})
</script>

<template>
  <view class="ui-mte" :class="{ 'ui-mte--disabled': props.disabled }">
    <view v-if="props.showPreview !== false" class="ui-mte__preview">
      <MathText v-if="previewText" :text="previewText" block />
      <text v-else class="ui-mte__placeholder">{{ placeholderText }}</text>
    </view>

    <view class="ui-mte__inputwrap" :class="{ 'ui-mte__inputwrap--focus': focused }">
      <textarea
        ref="textareaRef"
        class="ui-mte__input"
        :style="{ height: inputHeight, minHeight: inputHeight }"
        :value="state.text"
        :placeholder="props.placeholder"
        :disabled="props.disabled"
        :maxlength="props.maxlength ?? -1"
        :focus="wantFocus"
        :auto-focus="props.autofocus"
        :inputmode="inputModeValue"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
      />
    </view>

    <view v-if="props.showMeta || placeholderHint" class="ui-mte__meta">
      <text v-if="props.showMeta" class="ui-mte__keyboard">{{ inputModeValue === 'none' ? '证明键盘' : '系统键盘' }}</text>
      <text v-if="placeholderHint" class="ui-mte__placeholders">{{ placeholderHint }}</text>
    </view>
  </view>
</template>

<style>
.ui-mte {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: 100%;
  box-sizing: border-box;
}
.ui-mte--disabled {
  opacity: 0.6;
}
.ui-mte__preview {
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-16);
  line-height: var(--lh-body);
  overflow-wrap: anywhere;
}
.ui-mte__placeholder {
  color: var(--ink-2);
  font-size: var(--fs-13);
}
.ui-mte__inputwrap {
  overflow: hidden;
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-12);
  background: var(--sheet);
  transition: border-color var(--dur-fast) ease-out, box-shadow var(--dur-fast) ease-out;
}
.ui-mte__inputwrap--focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.ui-mte__input {
  display: block;
  width: 100%;
  color: var(--ink);
  background: transparent;
  font-size: var(--fs-16); /* 02 §2.3：16px 防 iOS 聚焦缩放 */
  line-height: 1.65;
  font-family: var(--font-mono);
}
.ui-mte__input textarea,
.ui-mte__input .uni-textarea-textarea {
  padding: var(--sp-2) var(--sp-3);
  box-sizing: border-box;
}
.ui-mte__input .uni-textarea-placeholder {
  padding: var(--sp-2) var(--sp-3);
  color: var(--ink-3);
  font-family: var(--font-sans);
  font-weight: var(--fw-bold);
}
.ui-mte__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  min-height: 18px;
  color: var(--ink-2);
  font-size: var(--fs-13);
}
.ui-mte__keyboard {
  font-family: var(--font-mono);
}
</style>
