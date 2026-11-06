<script setup lang="ts">
/**
 * 求助抽屉（issue #16，02 §4.8 / 01 §4「一个入口，三种意图」）。
 * 只渲染服务端给的 HelpState / Note，不在这里判定门槛、不自己算预算（08 §8 AI 规则 3）。
 * 契约见 components/README.md；#16 追加一个可选 prop：
 * - note：/help 返回的 note 卡片（01 §4 的位置规则：概念解释/施压拒绝/H0·H1 提示都显示在抽屉里）。
 * 关闭规则（PR #91 审计）：请求在途（busy）时遮罩/关闭按钮/ Esc 都不关抽屉，避免结果落到已关闭的抽屉上。
 */
import { computed, ref } from 'vue'
import TutorBubble from '@/components/practice/TutorBubble.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
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
    /** 自学题可以看解题思路（老师布置的题和测验没有这个入口）。 */
    solutionAvailable?: boolean
  }>(),
  { busy: false, note: null, solutionAvailable: false },
)
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'intent', i: HelpIntent): void
  (e: 'send', t: string): void
  (e: 'claim'): void
  (e: 'decline'): void
  (e: 'soft-landing', a: string): void
  (e: 'solution'): void
  (e: 'feedback', noteId: string, useful: boolean): void
}>()

const ask = ref('')

/** 测验模式：求助入口只保留「概念」（01 §4.5）。 */
const testMode = computed(() => props.mode === 'test')
const exhausted = computed(() => props.help.exhausted)
const canStuck = computed(() => !props.busy && !testMode.value && !exhausted.value && props.help.hintAvailable)

/** 「卡住了」不可用时的原因：只翻译 state 里的门槛字段（needAttempt / waitSec / exhausted）。 */
const stuckReason = computed(() => {
  if (exhausted.value) return '本题提示额度已用完，试试下面的出路。'
  if (!props.help.hintAvailable) return '现在没有可领取的提示。'
  if (props.help.needAttempt) return '先自己写完下一行，再来领取提示。'
  if ((props.help.waitSec ?? 0) > 0) return '还要再等 ' + props.help.waitSec + ' 秒。'
  return '给一条提示；从第二级起会用掉提示额度。'
})

/** 额度用完的软着陆出路（01 §4.4）：文案与预览卡共用一份（hintPreviewCopy），flag_teacher 已接通后端，是否可点由 help.canFlag 决定。 */
const softLandingItems = SOFT_LANDING_ORDER.map((id) => ({
  id,
  label: softLandingLabel(id),
  disabled: !softLandingAvailable(id),
}))

/** 「求助老师」只在服务端说可以时可点（额度用完，或卡住满一段时间），且没找过。 */
function softDisabled(id: string, disabled: boolean): boolean {
  return disabled || (id === 'flag_teacher' && props.help.canFlag !== true)
}

/** 常见问句（01 §4 线框里的两条示例；点一下填进输入框，学生再确认发送）。 */
const COMMON_QUESTIONS = ['这一行在做什么？', '什么是充分条件？']

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
  <PgSheet :open="props.open" :persistent="props.busy" class="pg-help" aria-labelledby="pg-help-title" @update:open="close">
    <view class="pg-help__head">
      <text id="pg-help-title" class="pg-help__title">你现在需要哪种帮助？</text>
      <PgButton class="pg-help__close" variant="ghost" size="sm" :disabled="props.busy" @tap="close">关闭</PgButton>
    </view>

    <view v-if="testMode" class="pg-help__notice">测验模式：只保留概念说明。</view>
    <view v-else-if="exhausted" class="pg-help__soft pg-help__soft--exhausted">
      <text class="pg-help__softtitle">本题提示额度已用完，可以试试这些出路：</text>
      <view class="pg-help__softgrid">
        <PgButton
          v-for="s in softLandingItems"
          :key="s.id"
          class="pg-help__softbtn"
          :class="'pg-help__softbtn--' + s.id"
          variant="secondary"
          size="sm"
          :disabled="props.busy || softDisabled(s.id, s.disabled)"
          @tap="softLanding(s.id)"
        >
          {{ s.label }}<text v-if="s.disabled" class="pg-help__soon">（即将上线）</text>
        </PgButton>
      </view>
    </view>
    <view v-if="props.help.flagged" class="pg-help__notice">已标记求助老师，老师会看到你在这一步的卡点。</view>

    <view class="pg-help__intents">
      <PgButton
        v-if="!testMode"
        class="pg-help__intent pg-help__intent--stuck"
        :class="{ 'pg-help__intent--disabled': !canStuck }"
        variant="secondary"
        block
        sound="tap"
        :disabled="!canStuck"
        @tap="pickIntent('stuck')"
      >
        <PgIcon class="pg-help__intenticon" name="bulb" :size="32" :tone="canStuck ? 'on' : 'off'" />
        <view class="pg-help__intenttext">
          <text class="pg-help__intenttitle">我卡住了，不知道下一步</text>
          <text class="pg-help__intentdesc">{{ stuckReason }}</text>
        </view>
      </PgButton>

      <PgButton class="pg-help__intent pg-help__intent--concept" variant="secondary" block sound="tap" :disabled="props.busy" @tap="pickIntent('concept')">
        <PgIcon class="pg-help__intenticon" name="book" :size="32" color="var(--sea-text)" />
        <view class="pg-help__intenttext">
          <text class="pg-help__intenttitle">这个概念/符号我不懂</text>
          <text class="pg-help__intentdesc">1–2 句概念解释，不占提示额度。</text>
        </view>
      </PgButton>

      <PgButton
        v-if="!testMode"
        class="pg-help__intent pg-help__intent--check_line"
        variant="secondary"
        block
        sound="tap"
        :disabled="props.busy"
        @tap="pickIntent('check_line')"
      >
        <PgIcon class="pg-help__intenticon" name="eye" :size="32" color="var(--accent-text)" />
        <view class="pg-help__intenttext">
          <text class="pg-help__intenttitle">帮我看看这一行</text>
          <text class="pg-help__intentdesc">对最新一行给一条批注，不占提示额度。</text>
        </view>
      </PgButton>

      <PgButton
        v-if="props.solutionAvailable && !testMode"
        class="pg-help__intent pg-help__intent--solution"
        variant="secondary"
        block
        sound="tap"
        data-testid="help-solution"
        :disabled="props.busy"
        @tap="emit('solution')"
      >
        <PgIcon class="pg-help__intenticon" name="bulb" :size="32" color="var(--accent-text)" />
        <view class="pg-help__intenttext">
          <text class="pg-help__intenttitle">看解题思路</text>
          <text class="pg-help__intentdesc">先看思路和关键点，再决定要不要看完整解答。</text>
        </view>
      </PgButton>
    </view>

    <view v-if="props.busy" class="pg-help__thinking" role="status" data-testid="help-thinking">
      <PgMascot expr="think" motion="think-tilt" :size="48" />
      <text class="pg-help__busy" aria-live="polite">小方在想…</text>
    </view>
    <TutorBubble v-else-if="props.note" :note="props.note" @feedback="emit('feedback', props.note!.noteId, $event)" />

    <view v-if="!testMode" class="pg-help__free">
      <text class="pg-help__freetitle">或者直接问一句</text>
      <view class="pg-help__freerow">
        <input v-model="ask" class="pg-help__input" placeholder="把卡住的地方写出来" :disabled="props.busy" />
        <PgButton class="pg-help__send" :disabled="!ask.trim() || props.busy" @tap="send">发送</PgButton>
      </view>
      <view class="pg-help__chips">
        <PgButton v-for="q in COMMON_QUESTIONS" :key="q" class="pg-help__chip" variant="ghost" size="sm" :disabled="props.busy" @tap="fill(q)">{{ q }}</PgButton>
      </view>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-help__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.pg-help__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-help__notice {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-13);
  line-height: 1.5;
}
.pg-help__soft {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--bw) solid var(--bee);
  border-radius: var(--radius-16);
  background: var(--bee-soft);
}
.pg-help__softtitle { color: var(--bee-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-help__softgrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.pg-help__soon { font-size: var(--fs-12); font-weight: var(--fw-bold); }
.pg-help__intents { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-help__intent.pg-button {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: var(--sp-3);
  min-height: 76px;
  padding: var(--sp-2) var(--sp-4);
  text-align: left;
}
.pg-help__intenticon { flex: none; }
.pg-help__intenttext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-help__intenttitle { font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.4; }
.pg-help__intentdesc { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.4; }
.pg-help__intent.pg-button[disabled] .pg-help__intentdesc { color: var(--ink-2); }
.pg-help__intent.pg-button[disabled] .pg-help__intenttitle { color: var(--ink-2); }
.pg-help__thinking { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-16); background: var(--paper-2); }
.pg-help__free { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-help__freetitle { color: var(--ink-2); font-size: var(--fs-13); }
.pg-help__freerow { display: flex; gap: var(--sp-2); }
.pg-help__input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-12);
  background: var(--paper);
  color: var(--ink);
  /* 16px：iOS 聚焦不缩放（02 §6） */
  font-size: var(--fs-16);
}
.pg-help__send { flex: none; }
.pg-help__chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.pg-help__chip.pg-button { border: var(--bw) dashed var(--rule-2); border-radius: var(--radius-pill); }
.pg-help__busy { color: var(--ink-2); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
</style>
