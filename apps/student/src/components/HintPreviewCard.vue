<script setup lang="ts">
// #8 占位：正式提示预览卡在 #16 实现。
import type { HintPreview } from '@/types/attempt'
const props = withDefaults(defineProps<{ preview?: HintPreview | null; busy?: boolean }>(), { preview: null, busy: false })
const emit = defineEmits<{ (e: 'claim'): void; (e: 'decline'): void }>()
</script>
<template>
  <view v-if="props.preview" class="pg-preview">
    <text class="pg-preview__title">下一条：{{ props.preview.level }} · 透露 {{ props.preview.cost }}</text>
    <text class="pg-preview__text pg-small">正式预览卡在 #16 实现。</text>
    <view class="pg-preview__row">
      <button class="pg-preview__btn" @tap="emit('decline')">先不要</button>
      <button class="pg-preview__btn pg-preview__btn--primary" @tap="emit('claim')">领取</button>
    </view>
  </view>
</template>
<style scoped>
.pg-preview { position: fixed; left: var(--sp-3); right: var(--sp-3); bottom: calc(120px + var(--safe-bottom)); z-index: 70; border: 1px solid var(--hint); background: var(--hint-soft); border-radius: var(--radius-card); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-preview__title { font-weight: 600; color: var(--hint); }
.pg-preview__text { color: var(--ink); }
.pg-preview__row { display: flex; gap: var(--sp-2); }
.pg-preview__btn { flex: 1; min-height: 44px; border: 1px solid var(--rule); border-radius: var(--radius-input); background: var(--sheet); color: var(--ink); }
.pg-preview__btn--primary { border-color: var(--hint); color: var(--hint); }
</style>
