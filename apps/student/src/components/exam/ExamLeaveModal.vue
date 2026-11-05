<script setup lang="ts">
/**
 * 切出警告弹窗（11 §5.2：第 1、2 次：弹窗「你已离开 N 次（第 3 次将锁定本题）」）。
 *
 * 次数来自服务端 state；本组件只展示，不做阈值判定。
 */
import { computed } from 'vue'
import { EXAM_MAX_SWITCHES_DEFAULT, leaveWarningText } from './exam'

const props = withDefaults(
  defineProps<{ visible?: boolean; count?: number; maxWarnings?: number }>(),
  { visible: false, count: 1, maxWarnings: EXAM_MAX_SWITCHES_DEFAULT },
)
const emit = defineEmits<{ (e: 'dismiss'): void }>()
const text = computed(() => leaveWarningText(props.count, props.maxWarnings))
</script>

<template>
  <view v-if="props.visible" class="pg-leavewarn" data-testid="exam-leave-warning" role="alertdialog" aria-modal="true">
    <view class="pg-leavewarn__sheet">
      <text class="pg-leavewarn__title">离开提醒</text>
      <text class="pg-leavewarn__text" data-testid="exam-leave-warning-text">{{ text }}</text>
      <text class="pg-leavewarn__note pg-small">离开次数由服务端累计；继续切出会锁定本题，需要老师解锁。</text>
      <button class="pg-leavewarn__btn" role="button" data-testid="exam-warn-dismiss" @tap="emit('dismiss')">知道了</button>
    </view>
  </view>
</template>

<style scoped>
.pg-leavewarn {
  position: fixed;
  inset: 0;
  z-index: 86;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: color-mix(in srgb, var(--ink) 38%, transparent);
}
.pg-leavewarn__sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--sheet);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
  border-left: 4px solid var(--hint);
}
.pg-leavewarn__title { font-size: 18px; font-weight: 900; color: var(--ink); }
.pg-leavewarn__text { color: var(--margin-text); font-size: 16px; }
.pg-leavewarn__note { color: var(--ink-2); line-height: 1.6; }
.pg-leavewarn__btn {
  min-height: 44px;
  border-radius: var(--radius-input);
  border: 1px solid var(--rule);
  background: var(--sheet);
  color: var(--ink);
}
</style>
