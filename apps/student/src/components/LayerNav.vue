<script setup lang="ts">
/** 平板/桌面层导航（02 §3.2/§3.3）：六层横排/竖排，显示状态。 */
import { LAYER_STATUS_TEXT, layerName, layerNumber } from '@/copy'
import type { LayerId, LayerStatus } from '@/types/attempt'

const props = withDefaults(defineProps<{ layers?: LayerStatus[]; current?: LayerId | null; vertical?: boolean }>(), {
  layers: () => [],
  current: null,
  vertical: false,
})
const emit = defineEmits<{ (e: 'select', layer: LayerId): void }>()
</script>

<template>
  <view class="pg-layernav" :class="{ 'pg-layernav--vertical': vertical }">
    <view
      v-for="l in props.layers"
      :key="l.layer"
      class="pg-layernav__item"
      :class="['pg-layernav__item--' + l.status, current === l.layer ? 'pg-layernav__item--current' : '']"
      role="button"
      tabindex="0"
      :aria-current="current === l.layer ? 'step' : undefined"
      @tap="emit('select', l.layer)"
      @keydown.enter.prevent="emit('select', l.layer)"
    >
      <text class="pg-layernav__index">{{ layerNumber(l.layer) }}</text>
      <view class="pg-layernav__text">
        <text class="pg-layernav__title">{{ layerName(l.layer) }}</text>
        <text class="pg-layernav__status">{{ LAYER_STATUS_TEXT[l.status] }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-layernav {
  display: flex;
  gap: var(--sp-1);
  overflow-x: auto;
  padding: var(--sp-2) 0;
  border-bottom: var(--bw) solid var(--rule);
  scrollbar-width: none;
}
.pg-layernav::-webkit-scrollbar { display: none; }
.pg-layernav--vertical {
  flex-direction: column;
  overflow: visible;
  border-bottom: 0;
  padding: var(--sp-3) var(--sp-3) var(--sp-3) 0;
}
.pg-layernav__item {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--touch);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-12);
  border: var(--bw) solid transparent;
  color: var(--ink-2);
  cursor: pointer;
}
.pg-layernav__item--current {
  color: var(--accent-text);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.pg-layernav__item--locked { opacity: 0.55; }
.pg-layernav__item--disabled { opacity: 0.55; }
.pg-layernav__index {
  flex: none;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--paper-2);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
}
.pg-layernav__item--done .pg-layernav__index { background: var(--ok); color: var(--on-ok); }
.pg-layernav__text { min-width: 0; display: flex; flex-direction: column; }
.pg-layernav__title { font-size: var(--fs-13); font-weight: var(--fw-black); line-height: 1.3; white-space: nowrap; }
.pg-layernav__status { color: var(--ink-2); font-size: var(--fs-12); line-height: 1.3; white-space: nowrap; }
</style>
