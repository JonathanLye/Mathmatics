<script setup lang="ts">
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
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
  <view class="pg-preview" role="dialog" aria-label="提示预览" aria-live="polite">
    <view class="pg-preview__grab" aria-hidden="true" />
    <view class="pg-preview__head">
      <PgMascot expr="think" :size="60" />
      <text v-if="title" class="pg-preview__title">{{ title }}</text>
    </view>
    <view v-if="costLine" class="pg-preview__costbox">
      <PgIcon name="bulb" :size="24" />
      <text class="pg-preview__cost">{{ costLine }}</text>
    </view>
    <text v-if="allowed" class="pg-preview__hint pg-small">{{ guidance }}</text>
    <text v-else class="pg-preview__reason pg-small">{{ reasonText }}</text>

    <!-- 额度用完/被门槛挡住时：服务端 softLanding 渲染成按钮（02 §4.8「卡片换成四个出路按钮」） -->
    <view v-if="!allowed && softItems.length > 0" class="pg-preview__softgrid">
      <button
        v-for="item in softItems"
        :key="item.id"
        :class="'pg-preview__softbtn pg-preview__softbtn--' + item.id"
        :disabled="!!props.busy || item.disabled"
        @tap="emit('soft-landing', item.id)"
      >
        {{ item.label }}<text v-if="item.disabled" class="pg-preview__soon">（即将上线）</text>
      </button>
    </view>

    <button v-if="canRetry" class="pg-preview__retry" :disabled="!!props.busy" @tap="emit('retry')">
      重新获取预览
    </button>

    <view class="pg-preview__row">
      <button class="pg-preview__btn pg-preview__decline" :disabled="!!props.busy" @tap="emit('decline')">
        先不要
      </button>
      <button class="pg-preview__btn pg-preview__btn--primary pg-preview__claim" :disabled="!allowed" @tap="emit('claim')">
        {{ props.busy ? '领取中…' : '领取' }}
      </button>
    </view>
  </view>
</template>

<style scoped>
/* 黄 = 计透露量的代价（02 §2.2、§4.8）。底部抽屉 + 自带遮罩（box-shadow 外扩，不额外加元素）。 */
.pg-preview {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 70;
  max-width: 560px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--sheet);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5);
  clip-path: inset(-100vmax -100vmax 0 -100vmax);
  animation: pg-sheet-up 320ms var(--ease-pop) both;
}
.pg-preview__grab { align-self: center; width: 44px; height: 5px; border-radius: 3px; background: var(--rule); }
.pg-preview__head { display: flex; align-items: center; gap: var(--sp-3); }
.pg-preview__title { flex: 1; min-width: 0; color: var(--ink); font-size: 20px; font-weight: 900; line-height: 1.3; }
.pg-preview__costbox {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 2px solid var(--hint-fill);
  border-bottom: var(--lip) solid var(--hint-lip);
  border-radius: var(--radius-card);
  background: var(--hint-soft);
}
.pg-preview__cost { flex: 1; color: var(--ink); font-size: 15px; font-weight: 800; line-height: 1.45; }
.pg-preview__hint { color: var(--ink-2); font-size: var(--fs-small); font-weight: 700; }
.pg-preview__reason { color: var(--hint); font-size: var(--fs-small); font-weight: 800; }
.pg-preview__softgrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
.pg-preview__softbtn {
  min-height: 48px;
  padding: 0 var(--sp-2);
  border: 2px solid var(--rule);
  border-bottom-width: var(--lip);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--margin-text);
  font-size: var(--fs-small);
  font-weight: 900;
}
.pg-preview__softbtn::after,
.pg-preview__retry::after,
.pg-preview__btn::after { display: none; }
.pg-preview__softbtn:disabled { opacity: 0.45; }
.pg-preview__soon { font-size: var(--fs-mono); }
.pg-preview__retry { min-height: 44px; border: 2px dashed var(--hint-fill); border-radius: var(--radius-input); background: transparent; color: var(--hint); font-size: var(--fs-small); font-weight: 800; }
.pg-preview__row { display: flex; gap: var(--sp-3); margin-top: var(--sp-1); }
.pg-preview__btn {
  flex: 1;
  min-height: 52px;
  padding: 0 var(--sp-3);
  border: 2px solid var(--rule);
  border-radius: var(--radius-card);
  box-shadow: 0 2px 0 var(--rule);
  background: var(--sheet);
  color: var(--margin-text);
  font-size: 16px;
  font-weight: 900;
}
.pg-preview__btn--primary { border: 0; background: var(--hint-fill); box-shadow: 0 var(--lip) 0 var(--hint-lip); color: var(--on-hint); }
.pg-preview__btn:active { transform: translateY(2px); }
.pg-preview__btn:disabled { opacity: 0.45; }
</style>
