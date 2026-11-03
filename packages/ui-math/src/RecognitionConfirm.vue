<script setup lang="ts">
/**
 * 识别确认面板（issue #15，03 §3.2、02 §4.6）。
 *
 * - 渲染两路识别结果（左=主识别，右=交叉识别），不一致处逐处高亮、可选左/选右；
 * - 一致与否/高亮位置**全部来自服务端 recognition.agree / recognition.diff**（03 §3.1 第 6 步），
 *   前端不做归一化、LCS 或任何文本比较（12 §1 接口边界）；
 * - 02 §4.6：服务端 agree=true 且 status=ok → 直接显示主结果、单按钮「确认」；
 * - 「改一下」进入 MathTextEditor + ProofKeyboard 编辑，确认时返回最终文本；
 * - 「确认加入 / 放弃重写 / 重新识别」按组件契约 emit；识别结果永远不替学生改正
 *   （UI 只做「请核对」，不暗示对错，也不在前端做 canon/判分）。
 *
 * 契约见 apps/student/src/components/README.md；#15 追加可选 props（都不传时保持占位契约行为）：
 * - title：面板标题；keyboardByDefault：进入编辑是否直接打开证明键盘；showRoutes：是否展示两路全文。
 * 纯逻辑在 ./recognition.ts（可单测）。
 */
import { computed, ref, watch } from 'vue'
import MathText from './MathText.vue'
import MathTextEditor from './MathTextEditor.vue'
import ProofKeyboard from './ProofKeyboard.vue'
import type { KeyboardActionId, KeyboardInsertPayload } from './keyboard'
import {
  alternativeDisplayText,
  buildRecognitionView,
  mergeRecognitionResult,
  recognitionStatusHint,
  recognitionSummary,
  toMathFragment,
  type RecognitionHighlight,
  type RecognitionRoute,
} from './recognition'
import type { Recognition } from '../../../apps/student/src/types/attempt'

/** MathTextEditor 通过 defineExpose 暴露的最小 API（避免把整组件类型引进来） */
interface MathTextEditorApi {
  insertPayload(payload: { text: string; mode?: 'math' | 'text' }): void
  applyAction(id: string): void
  focus(): void
}

const props = withDefaults(
  defineProps<{
    recognition: Recognition
    busy?: boolean
    /** 可选：面板标题 */
    title?: string
    /** 可选：进入「改一下」时直接打开证明键盘（默认 true） */
    keyboardByDefault?: boolean
    /** 可选：是否展示两路识别全文（默认 true） */
    showRoutes?: boolean
  }>(),
  { busy: false, title: '识别结果 · 请核对', keyboardByDefault: true, showRoutes: true },
)

const emit = defineEmits<{
  (e: 'confirm', text: string): void
  (e: 'rewrite'): void
  (e: 'edit-keyboard', text: string): void
  (e: 'discard'): void
}>()

type Mode = 'compare' | 'edit'

const mode = ref<Mode>('compare')
const choices = ref<RecognitionRoute[]>([])
const editText = ref('')
const keyboardOpen = ref(false)
const editorRef = ref<MathTextEditorApi | null>(null)

// 视图里的一致与否/高亮位置全部来自服务端 Recognition，组件只渲染（props 直接是 Recognition，无需断言）。
const view = computed(() => buildRecognitionView(props.recognition))
const conflicts = computed<RecognitionHighlight[]>(() => view.value.conflicts)
const simple = computed(() => view.value.simple)
const statusHint = computed(() => recognitionStatusHint(view.value.status))
const confidenceText = computed(() => {
  const confidence = props.recognition.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return ''
  return '置信度 ' + Math.round(confidence * 100) + '%'
})
const routeSummary = computed(() => recognitionSummary(view.value))
const mergedText = computed(() => mergeRecognitionResult(view.value.primary, conflicts.value, choices.value))
/** 最终会提交的文本：对比态=按选择合并，编辑态=编辑器里的文本 */
const resultText = computed(() => (mode.value === 'edit' ? editText.value : mergedText.value))

/** recognition 变化时重置面板（同一面板可复用于重写/重新识别） */
watch(
  () => props.recognition,
  () => {
    choices.value = view.value.conflicts.map(() => 'primary' as RecognitionRoute)
    mode.value = 'compare'
    editText.value = ''
    keyboardOpen.value = false
  },
  { immediate: true },
)

function conflictLeftText(conflict: RecognitionHighlight): string {
  if (!conflict.primary) return '（空）'
  return toMathFragment(view.value.primary, conflict.start, conflict.end)
}

function conflictRightText(conflict: RecognitionHighlight): string {
  if (!conflict.alternative) return '（空）'
  return alternativeDisplayText(view.value.primary, conflict)
}

function isRightChosen(conflict: RecognitionHighlight): boolean {
  return (choices.value[conflict.index] ?? 'primary') === 'alternative'
}

function chooseConflict(conflict: RecognitionHighlight, route: RecognitionRoute): void {
  if (props.busy) return
  const next = conflicts.value.map(() => 'primary' as RecognitionRoute)
  for (let index = 0; index < next.length; index += 1) {
    next[index] = choices.value[index] ?? 'primary'
  }
  next[conflict.index] = route
  choices.value = next
}

function enterEditKeyboard(): void {
  if (props.busy) return
  editText.value = mergedText.value
  mode.value = 'edit'
  keyboardOpen.value = props.keyboardByDefault
  emit('edit-keyboard', mergedText.value)
}

function backToCompare(): void {
  mode.value = 'compare'
  keyboardOpen.value = false
  editText.value = ''
}

function onInsert(payload: KeyboardInsertPayload): void {
  editorRef.value?.insertPayload(payload)
}

function onAction(action: KeyboardActionId): void {
  if (action === 'system' || action === 'done') {
    keyboardOpen.value = false
    editorRef.value?.applyAction(action)
    return
  }
  editorRef.value?.applyAction(action)
}

function onRequestSystemKeyboard(): void {
  keyboardOpen.value = false
}

function onCloseKeyboard(): void {
  keyboardOpen.value = false
}

function confirm(): void {
  if (props.busy) return
  emit('confirm', resultText.value)
}

function rewrite(): void {
  if (props.busy) return
  emit('rewrite')
}

function discard(): void {
  if (props.busy) return
  emit('discard')
}
</script>

<template>
  <view class="ui-recog-mask">
    <view
      class="ui-recog"
      role="dialog"
      aria-label="识别结果确认"
      :data-agree="view.agree === null ? 'null' : String(view.agree)"
      :data-conflicts="conflicts.length"
      :data-simple="simple ? 'true' : 'false'"
    >
      <view class="ui-recog__head">
        <view class="ui-recog__headtext">
          <text class="ui-recog__title">{{ props.title }}</text>
          <text class="ui-recog__summary pg-small">{{ routeSummary }}<template v-if="confidenceText"> · {{ confidenceText }}</template></text>
        </view>
        <button class="ui-recog__close" :disabled="props.busy" @tap="discard">关闭</button>
      </view>

      <text v-if="statusHint" class="ui-recog__statushint">{{ statusHint }}</text>

      <!-- 核对态：一致与否/高亮位置全部来自服务端 agree/diff，前端只渲染 -->
      <view v-if="mode === 'compare'" class="ui-recog__compare">
        <!-- 02 §4.6：两路一致且置信度高（服务端 status=ok）→ 直接显示、单按钮确认 -->
        <view v-if="simple" class="ui-recog__simple">
          <MathText v-if="view.primary" :text="view.primary" block />
          <text v-else class="ui-recog__routeempty pg-small">（没有识别到内容）</text>
        </view>

        <template v-else>
          <view class="ui-recog__route ui-recog__route--left">
            <text class="ui-recog__routelabel pg-small">左 · 主识别</text>
            <MathText v-if="view.primary" :text="view.primary" block />
            <text v-else class="ui-recog__routeempty pg-small">（没有识别到内容）</text>
          </view>

          <view
            v-if="props.showRoutes && conflicts.length > 0 && view.alternative !== view.primary"
            class="ui-recog__route ui-recog__route--right"
          >
            <text class="ui-recog__routelabel pg-small">右 · 交叉识别</text>
            <MathText v-if="view.alternative" :text="view.alternative" block />
            <text v-else class="ui-recog__routeempty pg-small">（空）</text>
          </view>

          <view v-if="conflicts.length > 0" class="ui-recog__conflicts">
          <view
            v-for="conflict in conflicts"
            :key="conflict.index"
            class="ui-recog__conflict"
            :class="{ 'ui-recog__conflict--right': isRightChosen(conflict) }"
            :data-conflict-index="conflict.index"
          >
            <text class="ui-recog__conflicttitle">这一处两种识别不一致，请选一个：</text>
            <view class="ui-recog__fragments">
              <button
                class="ui-recog__fragment ui-recog__fragment--left"
                :class="{ 'ui-recog__fragment--active': !isRightChosen(conflict) }"
                :aria-pressed="!isRightChosen(conflict)"
                :disabled="props.busy"
                @tap="chooseConflict(conflict, 'primary')"
              >
                <text class="ui-recog__fragmenttag">左</text>
                <MathText :text="conflictLeftText(conflict)" />
              </button>
              <text class="ui-recog__fragsep">｜</text>
              <button
                class="ui-recog__fragment ui-recog__fragment--right"
                :class="{ 'ui-recog__fragment--active': isRightChosen(conflict) }"
                :aria-pressed="isRightChosen(conflict)"
                :disabled="props.busy"
                @tap="chooseConflict(conflict, 'alternative')"
              >
                <text class="ui-recog__fragmenttag">右</text>
                <MathText :text="conflictRightText(conflict)" />
              </button>
            </view>
          </view>
        </view>

          <view class="ui-recog__mergeline">
            <text class="ui-recog__mergetag pg-small">将加入证明</text>
            <MathText v-if="mergedText" :text="mergedText" block />
            <text v-else class="ui-recog__routeempty pg-small">（空）</text>
          </view>
        </template>
      </view>

      <!-- 编辑态：MathTextEditor + 证明键盘 -->
      <view v-else class="ui-recog__edit">
        <MathTextEditor
          ref="editorRef"
          v-model="editText"
          :keyboard-open="keyboardOpen"
          :min-rows="2"
          @request-system-keyboard="onRequestSystemKeyboard"
          @close-keyboard="onCloseKeyboard"
        />
        <view class="ui-recog__keyboard">
          <ProofKeyboard :visible="keyboardOpen" :disabled="props.busy" @insert="onInsert" @action="onAction" />
        </view>
        <button class="ui-recog__back" :disabled="props.busy" @tap="backToCompare">返回两路对比</button>
      </view>

      <view class="ui-recog__actions">
        <template v-if="mode === 'compare'">
          <!-- 02 §4.6：服务端 agree=true 且 status=ok 时不摆二选一；只保留单按钮「确认」 -->
          <template v-if="!simple">
            <button class="ui-recog__btn ui-recog__discard" :disabled="props.busy" @tap="discard">放弃重写</button>
            <button class="ui-recog__btn ui-recog__rewrite" :disabled="props.busy" @tap="rewrite">重新识别</button>
            <button class="ui-recog__btn ui-recog__editbtn" :disabled="props.busy" @tap="enterEditKeyboard">改一下</button>
          </template>
        </template>
        <template v-else>
          <button class="ui-recog__btn ui-recog__backcompare" :disabled="props.busy" @tap="backToCompare">返回核对</button>
        </template>
        <button class="ui-recog__btn ui-recog__btn--primary ui-recog__confirm" :disabled="props.busy" @tap="confirm">
          {{ props.busy ? '处理中…' : simple ? '确认' : '确认加入' }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.ui-recog-mask {
  position: fixed;
  inset: 0;
  z-index: 66;
  display: flex;
  align-items: flex-end;
  background: color-mix(in srgb, var(--ink, #1d2430) 35%, transparent);
}
.ui-recog {
  width: 100%;
  max-height: 92vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2, 8px);
  padding: var(--sp-3, 12px) var(--sp-4, 16px) calc(var(--sp-4, 16px) + var(--safe-bottom, 0px));
  background: var(--sheet, #fff);
  color: var(--ink, #1d2430);
  border-radius: var(--radius-sheet, 16px) var(--radius-sheet, 16px) 0 0;
  box-shadow: var(--shadow-sheet, 0 -8px 28px rgba(29, 36, 48, 0.16));
}
.ui-recog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2, 8px);
}
.ui-recog__headtext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ui-recog__title {
  font-family: var(--font-serif, serif);
  font-size: var(--fs-stem, 17px);
  font-weight: 600;
  line-height: 1.4;
}
.ui-recog__summary {
  color: var(--ink-2, #5d6878);
  font-size: var(--fs-small, 13px);
}
.ui-recog__close {
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--sp-2, 8px);
  border: 0;
  background: transparent;
  color: var(--ink-2, #5d6878);
  font-size: var(--fs-small, 13px);
}
.ui-recog__statushint {
  padding: var(--sp-2, 8px) var(--sp-3, 12px);
  border-radius: var(--radius-input, 6px);
  background: var(--hint-soft, #fbf3e2);
  color: var(--hint, #9a6b12);
  font-size: var(--fs-small, 13px);
  line-height: 1.5;
}
.ui-recog__compare,
.ui-recog__edit {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2, 8px);
  min-width: 0;
}
/* 02 §4.6 直接显示分支（服务端 agree=true）：主结果单块，无二选一 */
.ui-recog__simple {
  padding: var(--sp-3, 12px);
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-card, 10px);
  background: var(--paper, #f7f6f2);
}
.ui-recog__route {
  padding: var(--sp-2, 8px) var(--sp-3, 12px);
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-card, 10px);
  background: var(--paper, #f7f6f2);
}
.ui-recog__route--right {
  border-style: dashed;
}
.ui-recog__routelabel {
  display: block;
  margin-bottom: 2px;
  color: var(--ink-2, #5d6878);
  font-size: var(--fs-small, 13px);
}
.ui-recog__routeempty {
  color: var(--ink-2, #5d6878);
  font-size: var(--fs-small, 13px);
}
.ui-recog__conflicts {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2, 8px);
}
/* 高亮：不一致处用琥珀色（02 §2.2：琥珀=有代价/需注意），不出现红色错误徽标 */
.ui-recog__conflict {
  padding: var(--sp-2, 8px) var(--sp-3, 12px);
  border: 1px solid var(--hint, #9a6b12);
  border-radius: var(--radius-card, 10px);
  background: var(--hint-soft, #fbf3e2);
}
.ui-recog__conflicttitle {
  display: block;
  margin-bottom: var(--sp-1, 4px);
  color: var(--hint, #9a6b12);
  font-size: var(--fs-small, 13px);
}
.ui-recog__fragments {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1, 4px);
}
.ui-recog__fragment {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1, 4px);
  min-height: 44px;
  padding: 0 var(--sp-2, 8px);
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--sheet, #fff);
  color: var(--ink, #1d2430);
  font-size: var(--fs-body, 16px);
}
.ui-recog__fragment--active {
  border-color: var(--accent, #2b4fa3);
  background: var(--accent-soft, #e8eefb);
  color: var(--accent, #2b4fa3);
}
.ui-recog__fragmenttag {
  font-size: var(--fs-small, 13px);
  color: var(--ink-2, #5d6878);
}
.ui-recog__fragment--active .ui-recog__fragmenttag {
  color: var(--accent, #2b4fa3);
}
.ui-recog__fragsep {
  color: var(--ink-2, #5d6878);
}
.ui-recog__mergeline {
  padding: var(--sp-2, 8px) var(--sp-3, 12px);
  border-left: 3px solid var(--ok, #2f7a54);
  border-radius: var(--radius-input, 6px);
  background: var(--paper, #f7f6f2);
}
.ui-recog__mergetag {
  display: block;
  margin-bottom: 2px;
  color: var(--ok, #2f7a54);
  font-size: var(--fs-small, 13px);
}
.ui-recog__keyboard {
  margin: 0 calc(-1 * var(--sp-4, 16px));
}
.ui-recog__back {
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--accent, #2b4fa3);
  font-size: var(--fs-small, 13px);
}
.ui-recog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2, 8px);
  padding-top: var(--sp-1, 4px);
}
.ui-recog__btn {
  flex: 1 1 96px;
  min-height: 44px;
  padding: 0 var(--sp-3, 12px);
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--sheet, #fff);
  color: var(--ink, #1d2430);
  font-size: var(--fs-body, 16px);
}
.ui-recog__btn--primary {
  border-color: var(--accent, #2b4fa3);
  background: var(--accent, #2b4fa3);
  color: var(--sheet, #fff);
  font-weight: 600;
}
.ui-recog__btn:disabled {
  opacity: 0.45;
}
</style>
