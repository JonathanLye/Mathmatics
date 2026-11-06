<script setup lang="ts">
/** 提交后的反馈面板：从底部滑上来，不挡上面的证明。+经验飘字跟着绿色面板走。 */
import MathText from '@ui-math/MathText.vue'
import PgFeedbackPanel from '@/components/ui/PgFeedbackPanel.vue'
import type { FeedbackView } from './feedback'

defineProps<{ view: FeedbackView | null }>()
defineEmits<{ (e: 'continue'): void }>()
</script>

<template>
  <PgFeedbackPanel
    :open="Boolean(view)"
    :tone="view?.tone ?? 'sea'"
    :title="view?.title ?? ''"
    action-text="继续"
    action-testid="feedback-continue"
    :data-feedback-tone="view?.tone"
    @action="$emit('continue')"
  >
    <MathText v-if="view" :text="view.body" block />
    <text v-if="view && view.xp > 0" :key="view.lineId ?? view.body" class="pg-feedback-xp" data-testid="feedback-xp">+{{ view.xp }} 经验</text>
  </PgFeedbackPanel>
</template>

<style scoped>
.pg-feedback-xp {
  display: inline-block;
  margin-top: var(--sp-1);
  color: var(--bee-text);
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  animation: pg-xp-float 900ms var(--ease-out) both;
}
@keyframes pg-xp-float {
  0% { opacity: 0; transform: translateY(12px) scale(0.9); }
  40% { opacity: 1; transform: translateY(-4px) scale(1.08); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .pg-feedback-xp { animation: none; }
}
</style>
