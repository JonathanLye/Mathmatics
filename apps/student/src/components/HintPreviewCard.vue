<script setup lang="ts">
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
/**
 * 提示预览卡（issue #16，02 §4.8 / 01 §4.1）：「花之前告知代价」。
 * 只渲染服务端下发的 HintPreview，不在前端重算门槛/预算/判定（08 §8 AI 规则 3）。
 * 契约见 components/README.md；#16 追加的可选项：
 * - budget：用于文案「（你已用 0.5 / 2），剩余 1。」；不传只显示本条成本；
 * - emits retry / soft-landing（blocked 时「重新获取预览」、额度用完的四个出路按钮）。
 * HintPreview 字段全部可选：blocked preview 只有 allowed/reason/waitSec，缺 level 时只渲染原因行。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { BudgetView, HintPreview } from '@/types/attempt'
import {
  PREVIEW_ALLOWED_GUIDANCE,
  formatRevealAmount,
  previewAllowed,
  previewCanRetry,
  previewCostLine,
  previewDwellSeconds,
  previewReasonText,
  previewSoftLandingItems,
  previewTitle,
} from './hintPreviewCopy'

const props = withDefaults(
  defineProps<{
    preview: HintPreview
    busy?: boolean
    /** 可选：服务端预算快照，用于显示「已用 / 剩余」；不传时只显示本条成本 */
    budget?: BudgetView | null
  }>(),
  { busy: false, budget: null },
)
const emit = defineEmits<{
  (e: 'claim'): void
  (e: 'decline'): void
  /** blocked 时「重新获取预览」：页面重新 /help（建议项，见 PR #91 审计） */
  (e: 'retry'): void
  /** 额度用完/被门槛挡住时的软着陆出路 */
  (e: 'soft-landing', action: string): void
}>()

const title = computed(() => previewTitle(props.preview))
const costLine = computed(() => previewCostLine(props.preview, props.budget))
const reasonText = computed(() => previewReasonText(props.preview, remain.value))
const allowed = computed(() => previewAllowed(props.preview) && !props.busy)
const canRetry = computed(() => previewCanRetry(props.preview) && !props.busy)
const softItems = computed(() => previewSoftLandingItems(props.preview.softLanding))
const guidance = PREVIEW_ALLOWED_GUIDANCE

/** dwell 门槛的倒计时：只把服务端 waitSec 逐秒显示，到 0 也不在前端放开「领取」。 */
const remain = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let autoRetried = false
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
watch(
  () => props.preview,
  (preview) => {
    stopTimer()
    autoRetried = false
    remain.value = previewDwellSeconds(preview) ?? 0
    if (remain.value > 0) {
      timer = setInterval(() => {
        remain.value = Math.max(0, remain.value - 1)
        if (remain.value <= 0) {
          stopTimer()
          // 归零只说明服务端给的等待时间到了；是否可领仍由服务端决定 —— 自动重新取一次预览。
          if (!autoRetried && !props.busy) {
            autoRetried = true
            emit('retry')
          }
        }
      }, 1000)
    }
  },
  { immediate: true },
)
onUnmounted(stopTimer)
</script>

<template>
  <PgSheet open :persistent="props.busy" :z-index="70" class="pg-preview" aria-label="提示预览" aria-live="polite" @update:open="emit('decline')">
    <view class="pg-preview__head">
      <PgMascot expr="think" motion="think-tilt" :size="60" />
      <text v-if="title" class="pg-preview__title">{{ title }}</text>
    </view>
    <view v-if="costLine" class="pg-preview__costbox">
      <PgIcon name="bulb" :size="24" />
      <text class="pg-preview__cost">{{ costLine }}</text>
    </view>
    <text v-if="allowed" class="pg-preview__hint">{{ guidance }}</text>
    <text v-else class="pg-preview__reason">{{ reasonText }}</text>

    <!-- 额度用完/被门槛挡住时：服务端 softLanding 渲染成按钮（02 §4.8「卡片换成四个出路按钮」） -->
    <view v-if="!allowed && softItems.length > 0" class="pg-preview__softgrid">
      <PgButton
        v-for="item in softItems"
        :key="item.id"
        :class="'pg-preview__softbtn pg-preview__softbtn--' + item.id"
        variant="secondary"
        size="sm"
        :disabled="!!props.busy || item.disabled"
        @tap="emit('soft-landing', item.id)"
      >
        {{ item.label }}<text v-if="item.disabled" class="pg-preview__soon">（即将上线）</text>
      </PgButton>
    </view>

    <PgButton v-if="canRetry" class="pg-preview__retry" variant="ghost" block :disabled="!!props.busy" @tap="emit('retry')">重新获取预览</PgButton>

    <view class="pg-layer__row">
      <PgButton class="pg-preview__decline" variant="secondary" :disabled="!!props.busy" @tap="emit('decline')">先不要</PgButton>
      <PgButton class="pg-preview__claim" variant="hint" sound="hint" :loading="props.busy" :disabled="!allowed" @tap="emit('claim')">
        {{ props.busy ? '领取中…' : '领取' }}
      </PgButton>
    </view>
  </PgSheet>
</template>

<style scoped>
/* 金色 = 用提示的代价（02 §2.2、§4.8）。 */
.pg-preview__head { display: flex; align-items: center; gap: var(--sp-3); }
.pg-preview__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-preview__costbox {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: var(--bw) solid var(--bee);
  border-radius: var(--radius-16);
  background: var(--bee-soft);
}
.pg-preview__cost { flex: 1; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); line-height: 1.45; }
.pg-preview__hint { color: var(--ink-2); font-size: var(--fs-13); }
.pg-preview__reason { color: var(--bee-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-preview__softgrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.pg-preview__soon { font-size: var(--fs-12); font-weight: var(--fw-bold); }
</style>
