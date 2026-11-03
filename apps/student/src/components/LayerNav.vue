<script setup lang="ts">
/** 平板/桌面层导航（02 §3.2/§3.3）：六层横排/竖排，显示状态。 */
import type { LayerId, LayerStatus } from '@/types/attempt'

const props = withDefaults(defineProps<{ layers?: LayerStatus[]; current?: LayerId | null; vertical?: boolean }>(), {
  layers: () => [],
  current: null,
  vertical: false,
})
const emit = defineEmits<{ (e: 'select', layer: LayerId): void }>()

const STATUS_TEXT: Record<string, string> = { locked: '未解锁', active: '进行中', done: '已完成', skipped: '已跳过', disabled: '不启用' }
</script>

<template>
  <view class="pg-layernav" :class="{ 'pg-layernav--vertical': vertical }">
    <view
      v-for="l in props.layers"
      :key="l.layer"
      class="pg-layernav__item"
      :class="['pg-layernav__item--' + l.status, current === l.layer ? 'pg-layernav__item--current' : '']"
      role="button"
      @tap="emit('select', l.layer)"
    >
      <text class="pg-layernav__index pg-mono">{{ l.layer }}</text>
      <text class="pg-layernav__title">{{ l.title }}</text>
      <text class="pg-layernav__status pg-small">{{ STATUS_TEXT[l.status] }}</text>
    </view>
  </view>
</template>

<style scoped>
.pg-layernav {
  display: flex;
  gap: var(--sp-1);
  overflow-x: auto;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--rule);
  scrollbar-width: none;
}
.pg-layernav::-webkit-scrollbar { display: none; }
.pg-layernav--vertical {
  flex-direction: column;
  overflow: visible;
  border-bottom: 0;
  border-right: 1px solid var(--rule);
  padding: var(--sp-3);
}
.pg-layernav__item {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 4px 10px;
  border-radius: var(--radius-input);
  border: 1px solid transparent;
  color: var(--ink-2);
  background: transparent;
}
.pg-layernav__item--current {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.pg-layernav__item--done .pg-layernav__index { color: var(--ok); }
.pg-layernav__item--locked { opacity: 0.55; }
.pg-layernav__index { font-size: 12px; }
.pg-layernav__title { font-size: 14px; color: inherit; white-space: nowrap; }
.pg-layernav__status { color: var(--ink-2); white-space: nowrap; }
</style>
