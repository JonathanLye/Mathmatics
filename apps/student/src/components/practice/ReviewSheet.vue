<script setup lang="ts">
/**
 * 讲评（GET /attempts/{id}/review）。入口只在 completion.reviewAvailable 时出现；能不能看由服务端决定。
 * 拿不到时说一句人话并给重试，不露原始报错。参考证明和讲评都是 MathText。
 */
import { ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import { fetchReview } from '@/api/client'
import PgButton from '@/components/ui/PgButton.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import type { PublishedReview } from '@/types/attempt'

const props = defineProps<{ open: boolean; attemptId: string }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

/** 完成页是全屏庆祝（z-index 88），讲评要盖在它上面。 */
const ABOVE_CELEBRATION = 95

const review = ref<PublishedReview | null>(null)
const loading = ref(false)
const failed = ref(false)

async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    review.value = await fetchReview(props.attemptId)
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open && !review.value) void load()
  },
)
</script>

<template>
  <PgSheet :open="open" :z-index="ABOVE_CELEBRATION" aria-label="讲评" data-testid="review-sheet" @update:open="emit('update:open', $event)">
    <view class="pg-review">
      <text class="pg-review__title">讲评</text>
      <view v-if="loading" class="pg-review__state" role="status" data-testid="review-loading">
        <PgMascot expr="think" motion="think-tilt" :size="48" />
        <text class="pg-review__hint">小方在翻讲评…</text>
      </view>
      <view v-else-if="failed" class="pg-review__state" data-testid="review-failed">
        <text class="pg-review__hint">讲评这会儿打不开，稍后再试一次。</text>
        <PgButton variant="secondary" size="sm" data-testid="review-retry" @tap="load">再试一次</PgButton>
      </view>
      <template v-else-if="review">
        <view v-for="(proof, index) in review.proofs" :key="index" class="pg-review__proof" data-testid="review-proof">
          <MathText :text="proof" block />
        </view>
        <view v-if="review.note" class="pg-review__note" data-testid="review-note">
          <MathText :text="review.note" block />
        </view>
      </template>
      <PgButton block variant="secondary" data-testid="review-close" @tap="emit('update:open', false)">关闭</PgButton>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-review { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-review__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-review__state { display: flex; flex-direction: column; align-items: center; gap: var(--sp-2); padding: var(--sp-4) 0; }
.pg-review__hint { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-review__proof { padding: var(--sp-3); border-radius: var(--radius-16); background: var(--paper-2); color: var(--ink); overflow-wrap: anywhere; }
.pg-review__note { padding: var(--sp-3); border-radius: var(--radius-16); background: var(--sea-soft); color: var(--ink); overflow-wrap: anywhere; }
</style>
