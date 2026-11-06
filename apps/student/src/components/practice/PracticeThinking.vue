<script setup lang="ts">
/** 请求超过 300 毫秒才出现的小方：快的请求不闪，慢的请求让人知道页面没卡住。不挡操作。 */
import { onBeforeUnmount, ref, watch } from 'vue'
import PgMascot from '@/components/ui/PgMascot.vue'

const THINKING_DELAY_MS = 300
const props = defineProps<{ busy: boolean }>()
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.busy,
  (busy) => {
    if (timer) clearTimeout(timer)
    timer = null
    if (busy) {
      timer = setTimeout(() => {
        visible.value = true
      }, THINKING_DELAY_MS)
    } else {
      visible.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <view v-if="visible" class="pg-thinking" role="status" aria-label="正在处理" data-testid="practice-thinking">
    <PgMascot expr="think" motion="think-tilt" :size="36" />
    <text class="pg-thinking__text">小方在看…</text>
  </view>
</template>

<style scoped>
.pg-thinking {
  position: fixed;
  top: calc(var(--safe-top) + 60px);
  left: 50%;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3) var(--sp-1) var(--sp-2);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-pill);
  background: var(--sheet);
  transform: translateX(-50%);
  animation: pg-item-in var(--dur-base) var(--ease-out) both;
  pointer-events: none;
}
.pg-thinking__text { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); white-space: nowrap; }
</style>
