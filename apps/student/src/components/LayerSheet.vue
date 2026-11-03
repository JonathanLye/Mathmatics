<script setup lang="ts">
/** 层列表弹层：六层逐项（已完成 ✓ / 进行中 / 跳过 / 未解锁），可跳的层可点（02 §3.1）。 */
import type { LayerId, LayerStatus } from '@/types/attempt'

const props = withDefaults(defineProps<{ open: boolean; layers?: LayerStatus[]; current?: LayerId | null }>(), {
  layers: () => [],
  current: null,
})
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'select', layer: LayerId): void }>()

const STATUS_TEXT: Record<string, string> = { locked: '未解锁', active: '进行中', done: '已完成', skipped: '已跳过', disabled: '不启用' }
function canSelect(l: LayerStatus): boolean {
  return (l.status === 'done' || l.status === 'active' || l.status === 'skipped') && l.enabled
}
</script>

<template>
  <view v-if="props.open" class="pg-sheet-mask" @tap="emit('update:open', false)">
    <view class="pg-layersheet" @tap.stop>
      <view class="pg-layersheet__handle" />
      <text class="pg-layersheet__title">层导航</text>
      <view
        v-for="l in props.layers"
        :key="l.layer"
        class="pg-layersheet__row"
        :class="{ 'pg-layersheet__row--disabled': !canSelect(l) }"
        @tap="canSelect(l) && emit('select', l.layer)"
      >
        <text class="pg-layersheet__idx pg-mono">{{ l.layer }}</text>
        <text class="pg-layersheet__name">{{ l.title }}</text>
        <text class="pg-layersheet__status pg-small">{{ STATUS_TEXT[l.status] }}</text>
      </view>
      <button class="pg-layersheet__close pg-tap" @tap="emit('update:open', false)">关闭</button>
    </view>
  </view>
</template>

<style scoped>
.pg-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(29, 36, 48, 0.35);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.pg-layersheet {
  width: 100%;
  max-width: var(--content-max);
  max-height: 70vh;
  overflow-y: auto;
  background: var(--sheet);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  box-shadow: var(--shadow-sheet);
}
.pg-layersheet__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--rule);
  margin: var(--sp-1) auto var(--sp-2);
}
.pg-layersheet__title { font-family: var(--font-serif); font-size: 16px; font-weight: 600; }
.pg-layersheet__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  border-bottom: 1px solid var(--rule);
}
.pg-layersheet__row--disabled { opacity: 0.5; }
.pg-layersheet__idx { width: 32px; color: var(--ink-2); font-size: 12px; }
.pg-layersheet__name { flex: 1; font-size: 15px; }
.pg-layersheet__status { color: var(--ink-2); }
.pg-layersheet__close { margin-top: var(--sp-3); min-height: 44px; }
</style>
