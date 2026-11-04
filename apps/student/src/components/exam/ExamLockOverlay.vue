<script setup lang="ts">
/**
 * 锁定遮罩（11 §5.2：第 3 次：服务端 attempt.lock → 遮罩「本题已锁定，请联系老师」）。
 *
 * ⚠️ 只渲染服务端 locked 状态：本组件不判断次数、不触发锁定；锁定由服务端决定。
 * 等待教师解锁：页面轮询/刷新 state（真实模式）或 mock hook 返回新 state（e2e）。
 */
import { computed } from 'vue'
import { EXAM_MAX_SWITCHES_DEFAULT, examLockedText } from './exam'

const props = withDefaults(
  defineProps<{ visible?: boolean; warnings?: number; maxWarnings?: number; retrying?: boolean }>(),
  { visible: false, warnings: 0, maxWarnings: EXAM_MAX_SWITCHES_DEFAULT, retrying: false },
)
const emit = defineEmits<{ (e: 'retry'): void }>()
const title = computed(() => examLockedText())
</script>

<template>
  <view v-if="props.visible" class="pg-locked" data-testid="exam-locked-mask" role="alertdialog" aria-modal="true">
    <view class="pg-locked__sheet">
      <text class="pg-locked__icon" aria-hidden="true">🔒</text>
      <text class="pg-locked__title" data-testid="exam-locked-title">{{ title }}</text>
      <text v-if="props.warnings > 0" class="pg-locked__text pg-small" data-testid="exam-locked-warnings">
        你已离开 {{ props.warnings }} 次（达到 {{ props.maxWarnings }} 次上限）。
      </text>
      <text class="pg-locked__text pg-small">计时与锁定由服务端维护；解锁由老师操作，解锁后会自动恢复作答。</text>
      <button class="pg-locked__btn" role="button" data-testid="exam-unlock-retry" :disabled="props.retrying" @tap="emit('retry')">
        重新检查状态
      </button>
    </view>
  </view>
</template>

<style scoped>
.pg-locked {
  position: fixed;
  inset: 0;
  z-index: 88;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.pg-locked__sheet {
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--sheet);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
  border-left: 4px solid var(--margin);
}
.pg-locked__icon { font-size: 28px; line-height: 1; }
.pg-locked__title { font-family: var(--font-serif); font-size: 19px; font-weight: 600; color: var(--ink); }
.pg-locked__text { color: var(--ink-2); line-height: 1.6; }
.pg-locked__btn {
  min-height: 44px;
  border-radius: var(--radius-input);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.pg-locked__btn:disabled { opacity: 0.45; }
</style>
