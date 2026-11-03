<script setup lang="ts">
/**
 * 提示预览卡（issue #16，02 §4.8 / 01 §4.1）：「花之前告知代价」。
 * 只渲染服务端下发的 HintPreview，不在前端重算门槛/预算/判定（08 §8 AI 规则 3）。
 * 契约见 components/README.md；#16 追加一个可选 prop：
 * - budget：用于文案「剩余 X」（12-分工 #16 DoD），不传则只显示本条成本。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { BudgetView, HintPreview } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    preview: HintPreview
    busy?: boolean
    /** 可选：服务端预算快照，用于显示「已用 / 剩余」；不传时只显示本条成本 */
    budget?: BudgetView | null
  }>(),
  { busy: false, budget: null },
)
const emit = defineEmits<{ (e: 'claim'): void; (e: 'decline'): void }>()

/** 0.5 显示成 0.5，1 显示成 1（与 BudgetBar 口径一致）。 */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** H0–H4 口径（00-README §5）：H2 方向 / H3 局部一步 / H4 示范一行。 */
const LEVEL_TITLE: Record<'H2' | 'H3' | 'H4', string> = {
  H2: '方向提示',
  H3: '局部一步',
  H4: '示范一行',
}

const title = computed(() => '下一条：' + LEVEL_TITLE[props.preview.level] + '（' + props.preview.level + '）')

const costLine = computed(() => {
  const cost = fmt(props.preview.cost)
  const b = props.budget
  if (!b) return '这条会计入透露 ' + cost + '。'
  const remain = Math.max(0, b.revealMax - b.revealUsed - props.preview.cost)
  return '这条会计入透露 ' + cost + '（你已用 ' + fmt(b.revealUsed) + ' / ' + fmt(b.revealMax) + '），剩余 ' + fmt(remain) + '。'
})

const allowed = computed(() => props.preview.allowed && !props.busy)

/** dwell 门槛的倒计时：只把服务端给的 waitSec 逐秒显示出来，到 0 也不会在前端放开「领取」。 */
const remain = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
watch(
  () => props.preview,
  (p) => {
    stopTimer()
    remain.value = Math.max(0, Math.floor(Number(p.waitSec ?? 0)))
    if (p.reason === 'dwell' && !p.allowed && remain.value > 0) {
      timer = setInterval(() => {
        remain.value = Math.max(0, remain.value - 1)
        if (remain.value <= 0) stopTimer()
      }, 1000)
    }
  },
  { immediate: true },
)
onUnmounted(stopTimer)

/** 不可领取的原因：只翻译服务端 reason，不自己判定。 */
const reasonText = computed(() => {
  switch (props.preview.reason) {
    case 'need_attempt':
      return '先自己写完下一行，再来领取。'
    case 'dwell':
      return remain.value > 0 ? '还要再停留 ' + remain.value + ' 秒，才能领取。' : '可以再试一次。'
    case 'rapid_lock':
      return '刚连续点了几次，先歇 60 秒再来。'
    case 'budget':
      return '本题透露额度已用完，不再升级提示。'
    case 'layer':
      return '当前层还不能领取提示。'
    case 'test_mode':
      return '测验模式不提供提示。'
    case 'complete':
      return '本题已经完成。'
    default:
      return ''
  }
})

/** 额度用完时的软着陆出路（01 §4.4 / 06 §3.4 的 softLanding）。 */
const SOFT_LANDING_LABEL: Record<string, string> = {
  back_to_definition: '回定义',
  open_lesson: '看讲解',
  park_and_next: '先做下一题',
  flag_teacher: '求助老师',
}
const softLandingText = computed(() =>
  (props.preview.softLanding ?? []).map((id) => SOFT_LANDING_LABEL[id] ?? id).join(' / '),
)
</script>

<template>
  <view class="pg-preview" role="dialog" aria-label="提示预览">
    <text class="pg-preview__title">{{ title }}</text>
    <text class="pg-preview__cost">{{ costLine }}</text>
    <text v-if="allowed" class="pg-preview__hint pg-small">领取后，下一级要等你再写一行、并停留 20 秒。</text>
    <text v-else class="pg-preview__reason pg-small">{{ reasonText }}</text>
    <text v-if="!allowed && softLandingText" class="pg-preview__soft pg-small">可以试试：{{ softLandingText }}</text>
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
/* 琥珀色 = 计透露量的代价（02 §2.2、§4.8 线框）。 */
.pg-preview {
  position: fixed;
  left: var(--sp-3);
  right: var(--sp-3);
  bottom: calc(120px + var(--safe-bottom));
  z-index: 70;
  max-width: 420px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--hint);
  border-radius: var(--radius-card);
  background: var(--hint-soft);
  box-shadow: var(--shadow-sheet);
}
.pg-preview__title {
  color: var(--hint);
  font-family: var(--font-serif);
  font-size: var(--fs-stem);
  font-weight: 600;
  line-height: 1.4;
}
.pg-preview__cost {
  color: var(--ink);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.pg-preview__hint {
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-preview__reason {
  color: var(--hint);
  font-size: var(--fs-small);
}
.pg-preview__soft {
  color: var(--ink-2);
  font-size: var(--fs-small);
}
.pg-preview__row {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.pg-preview__btn {
  flex: 1;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--ink);
  font-size: var(--fs-body);
}
.pg-preview__btn--primary {
  border-color: var(--hint);
  background: var(--hint);
  color: var(--sheet);
  font-weight: 600;
}
.pg-preview__btn:disabled {
  opacity: 0.45;
}
</style>
