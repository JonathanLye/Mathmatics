<script setup lang="ts">
/**
 * 求助抽屉（issue #16，02 §4.8 / 01 §4「一个入口，三种意图」）。
 * 只渲染服务端给的 HelpState / Note，不在这里判定门槛、不自己算预算（08 §8 AI 规则 3）。
 * 契约见 components/README.md；#16 追加一个可选 prop：
 * - note：/help 返回的 note 卡片（01 §4 的位置规则：概念解释/施压拒绝/H0·H1 提示都显示在抽屉里）。
 * 关闭规则（PR #91 审计）：请求在途（busy）时遮罩/关闭按钮/ Esc 都不关抽屉，避免结果落到已关闭的抽屉上。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { AttemptMode, HelpIntent, HelpState, Note } from '@/types/attempt'
import { SOFT_LANDING_ORDER, softLandingAvailable, softLandingLabel } from './hintPreviewCopy'

const props = withDefaults(
  defineProps<{
    open: boolean
    help: HelpState
    mode: AttemptMode
    busy?: boolean
    /** 可选：/help 返回的概念说明，显示在抽屉里 */
    note?: Note | null
  }>(),
  { busy: false, note: null },
)
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'intent', i: HelpIntent): void
  (e: 'send', t: string): void
  (e: 'claim'): void
  (e: 'decline'): void
  (e: 'soft-landing', a: string): void
}>()

const ask = ref('')

/** 测验模式：求助入口只保留「概念」（01 §4.5）。 */
const testMode = computed(() => props.mode === 'test')
const exhausted = computed(() => props.help.exhausted)
const canStuck = computed(() => !props.busy && !testMode.value && !exhausted.value && props.help.hintAvailable)

/** 「卡住了」不可用时的原因：只翻译 state 里的门槛字段（needAttempt / waitSec / exhausted）。 */
const stuckReason = computed(() => {
  if (exhausted.value) return '本题透露额度已用完，试试下面的出路。'
  if (!props.help.hintAvailable) return '现在没有可领取的提示。'
  if (props.help.needAttempt) return '先自己写完下一行，再来领取提示。'
  if ((props.help.waitSec ?? 0) > 0) return '还要再等 ' + props.help.waitSec + ' 秒。'
  return '给一条阶梯提示；H2 起会计入透露量。'
})

/** 额度用完的软着陆出路（01 §4.4）：文案与预览卡共用一份（hintPreviewCopy），flag_teacher 后端未实现先禁用。 */
const softLandingItems = SOFT_LANDING_ORDER.map((id) => ({
  id,
  label: softLandingLabel(id),
  disabled: !softLandingAvailable(id),
}))

/** 常见问句（01 §4 线框里的两条示例；点一下填进输入框，学生再确认发送）。 */
const COMMON_QUESTIONS = ['这一行在做什么？', '什么是充分条件？']

const noteClass = computed(() => (props.note ? 'pg-help__note--' + props.note.kind : ''))

// ---- 可访问性：模态语义 + Esc 关闭 + 焦点归还（PR #91 审计建议项） ----
const sheetRef = ref<unknown>(null)
let previouslyFocused: HTMLElement | null = null

function resolveElement(value: unknown): HTMLElement | null {
  const wrapper = value as { $el?: unknown } | null
  const node = wrapper?.$el ?? value
  return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  close()
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      void nextTick(() => resolveElement(sheetRef.value)?.focus?.())
    } else {
      document.removeEventListener('keydown', onKeydown)
      try {
        previouslyFocused?.focus?.()
      } catch {
        /* 忽略：元素可能已卸载 */
      }
      previouslyFocused = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown)
})

/** busy 时忽略关闭：结果不会落到已关闭的抽屉上（PR #91 审计 4）。 */
function close() {
  if (props.busy) return
  emit('update:open', false)
}
function pickIntent(intent: HelpIntent) {
  if (props.busy) return
  emit('intent', intent)
}
function fill(text: string) {
  ask.value = text
}
function send() {
  const text = ask.value.trim()
  if (!text || props.busy) return
  emit('send', text)
  ask.value = ''
}
function softLanding(action: string) {
  if (props.busy) return
  emit('soft-landing', action)
}
</script>

<template>
  <view v-if="props.open" class="pg-help__mask" @tap="close">
    <view
      ref="sheetRef"
      class="pg-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pg-help-title"
      tabindex="-1"
      @tap.stop
    >
      <view class="pg-help__handle" />

      <view class="pg-help__head">
        <text id="pg-help-title" class="pg-help__title">你现在需要哪种帮助？</text>
        <button class="pg-help__close" :disabled="props.busy" @tap="close">关闭</button>
      </view>

      <view v-if="testMode" class="pg-help__notice">测验模式：只保留概念说明。</view>
      <view v-else-if="exhausted" class="pg-help__soft pg-help__soft--exhausted">
        <text class="pg-help__softtitle">本题透露额度已用完，可以试试这些出路：</text>
        <view class="pg-help__softgrid">
          <button
            v-for="s in softLandingItems"
            :key="s.id"
            class="pg-help__softbtn"
            :class="'pg-help__softbtn--' + s.id"
            :disabled="props.busy || s.disabled"
            @tap="softLanding(s.id)"
          >
            {{ s.label }}<text v-if="s.disabled" class="pg-help__soon">（即将上线）</text>
          </button>
        </view>
      </view>
      <view v-if="props.help.flagged" class="pg-help__notice">已标记求助老师，老师会看到你在这一步的卡点。</view>

      <view class="pg-help__intents">
        <button
          v-if="!testMode"
          class="pg-help__intent pg-help__intent--stuck"
          :class="{ 'pg-help__intent--disabled': !canStuck }"
          :disabled="!canStuck"
          @tap="pickIntent('stuck')"
        >
          <text class="pg-help__intenttitle">我卡住了，不知道下一步</text>
          <text class="pg-help__intentdesc pg-small">{{ stuckReason }}</text>
        </button>

        <button class="pg-help__intent pg-help__intent--concept" :disabled="props.busy" @tap="pickIntent('concept')">
          <text class="pg-help__intenttitle">这个概念/符号我不懂</text>
          <text class="pg-help__intentdesc pg-small">1–2 句概念解释，不计透露量。</text>
        </button>

        <button
          v-if="!testMode"
          class="pg-help__intent pg-help__intent--check_line"
          :disabled="props.busy"
          @tap="pickIntent('check_line')"
        >
          <text class="pg-help__intenttitle">帮我看看这一行</text>
          <text class="pg-help__intentdesc pg-small">对最新一行给一条批注，不计透露量。</text>
        </button>
      </view>

      <view v-if="props.note" class="pg-help__note" :class="noteClass" aria-live="polite">
        <text class="pg-help__notewho pg-small">{{ props.note.who }}</text>
        <MathText :text="props.note.text" block />
      </view>

      <view v-if="!testMode" class="pg-help__free">
        <text class="pg-help__freetitle pg-small">或者直接问一句</text>
        <view class="pg-help__freerow">
          <input
            v-model="ask"
            class="pg-help__input"
            placeholder="把卡住的地方写出来"
            :disabled="props.busy"
          />
          <button class="pg-help__send" :disabled="!ask.trim() || props.busy" @tap="send">发送</button>
        </view>
        <view class="pg-help__chips">
          <button
            v-for="q in COMMON_QUESTIONS"
            :key="q"
            class="pg-help__chip pg-small"
            :disabled="props.busy"
            @tap="fill(q)"
          >
            {{ q }}
          </button>
        </view>
      </view>

      <text v-if="props.busy" class="pg-help__busy pg-small" aria-live="polite">正在准备…</text>
    </view>
  </view>
</template>

<style scoped>
/* 遮罩：用 --ink 混出半透明，避免硬编码色值（02 §2）. */
.pg-help__mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: color-mix(in srgb, var(--ink) 35%, transparent);
}
.pg-help {
  width: 100%;
  /* 桌面 1280 下不铺满整屏（02 §3.3；PR #91 审计建议） */
  max-width: 560px;
  max-height: 88vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  background: var(--sheet);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-sheet);
  animation: pg-help-up var(--dur-normal) ease-out;
}
@keyframes pg-help-up {
  from {
    transform: translateY(var(--sp-8));
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
.pg-help__handle {
  width: var(--sp-8);
  height: 4px;
  margin: 0 auto;
  border-radius: 2px;
  background: var(--rule);
}
.pg-help__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pg-help__title {
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: var(--fs-stem);
  font-weight: 600;
  line-height: 1.4;
}
.pg-help__close {
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--sp-2);
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-help__notice {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-input);
  background: var(--paper);
  color: var(--ink-2);
  font-size: var(--fs-small);
  line-height: 1.5;
}
.pg-help__soft {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--hint);
  border-radius: var(--radius-card);
  background: var(--hint-soft);
}
.pg-help__softtitle {
  color: var(--hint);
  font-size: var(--fs-small);
  font-weight: 600;
  line-height: 1.5;
}
.pg-help__softgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
}
.pg-help__soon {
  font-size: var(--fs-mono);
}
.pg-help__softbtn {
  min-height: 44px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--hint);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--hint);
  font-size: var(--fs-small);
}
.pg-help__intents {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pg-help__intent {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 56px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--sheet);
  color: var(--ink);
  text-align: left;
}
.pg-help__intent--concept {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--rule));
  background: var(--accent-soft);
}
.pg-help__intenttitle {
  font-size: var(--fs-body);
  line-height: 1.4;
}
.pg-help__intentdesc {
  color: var(--ink-2);
  font-size: var(--fs-small);
  line-height: 1.4;
}
.pg-help__intent--disabled {
  opacity: 0.5;
}
.pg-help__note {
  padding: var(--sp-2) var(--sp-3);
  border-left: 3px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--paper);
}
.pg-help__note--concept {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}
.pg-help__note--annotation {
  border-left-color: var(--margin);
  background: var(--margin-soft);
}
.pg-help__note--hint {
  border-left-color: var(--hint);
  background: var(--hint-soft);
}
.pg-help__note--refusal {
  border-left-color: var(--margin);
  background: var(--margin-soft);
}
.pg-help__note--student {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}
.pg-help__note--system,
.pg-help__note--nudge,
.pg-help__note--lesson {
  border-left-color: var(--rule);
  background: var(--paper);
}
.pg-help__notewho {
  display: block;
  margin-bottom: 2px;
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-help__free {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pg-help__freetitle {
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-help__freerow {
  display: flex;
  gap: var(--sp-2);
}
.pg-help__input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  /* 16px：iOS 聚焦不缩放（02 §6） */
  font-size: var(--fs-body);
}
.pg-help__send {
  min-width: 72px;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-input);
  background: var(--accent);
  color: var(--sheet);
  font-size: var(--fs-body);
}
.pg-help__send:disabled {
  opacity: 0.45;
}
.pg-help__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.pg-help__chip {
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px dashed var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-help__busy {
  color: var(--ink-2);
  text-align: center;
}
</style>
