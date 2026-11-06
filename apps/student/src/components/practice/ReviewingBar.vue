<script setup lang="ts">
/** 回看已完成的层时的提示条：告诉学生现在在哪儿，一键回到正在做的那一层。 */
import PgButton from '@/components/ui/PgButton.vue'
import { layerName } from '@/copy'
import type { LayerId } from '@/types/attempt'

defineProps<{ current: LayerId; frontier: LayerId; busy?: boolean }>()
defineEmits<{ (e: 'return'): void }>()
</script>

<template>
  <view class="pg-reviewing" data-testid="reviewing-bar" role="status">
    <text class="pg-reviewing__text">在回看「{{ layerName(current) }}」</text>
    <PgButton variant="secondary" size="sm" data-testid="reviewing-return" :disabled="busy" @tap="$emit('return')">回到「{{ layerName(frontier) }}」</PgButton>
  </view>
</template>

<style scoped>
.pg-reviewing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-16);
  background: var(--paper-2);
}
.pg-reviewing__text { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
</style>
