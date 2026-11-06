<script setup lang="ts">
/** 层列表弹层：六层逐项（已完成 / 进行中 / 跳过 / 未解锁），可跳的层可点（02 §3.1）。 */
import { computed } from 'vue'
import { frontierLayer } from '@/components/practice/practiceProgress'
import PgButton from '@/components/ui/PgButton.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { LAYER_STATUS_TEXT, layerName, layerNumber } from '@/copy'
import type { LayerId, LayerStatus } from '@/types/attempt'

const props = withDefaults(defineProps<{ open: boolean; layers?: LayerStatus[]; current?: LayerId | null }>(), {
  layers: () => [],
  current: null,
})
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'select', layer: LayerId): void }>()

/** 回看旧层时，正在做的那一层在服务端状态里是 locked，但可以回去。 */
const frontier = computed(() => frontierLayer(props.layers))

function canSelect(l: LayerStatus): boolean {
  return (l.status === 'done' || l.status === 'active' || l.status === 'skipped' || l.layer === frontier.value) && l.enabled
}

function statusText(l: LayerStatus): string {
  return l.layer === frontier.value ? LAYER_STATUS_TEXT.active : LAYER_STATUS_TEXT[l.status]
}
</script>

<template>
  <PgSheet :open="props.open" class="pg-layersheet" aria-label="层导航" @update:open="emit('update:open', false)">
    <text class="pg-layersheet__title">层导航</text>
    <view class="pg-layersheet__list">
      <view
        v-for="l in props.layers"
        :key="l.layer"
        class="pg-layersheet__row"
        :class="{ 'pg-layersheet__row--disabled': !canSelect(l), 'pg-layersheet__row--current': l.layer === props.current }"
        role="button"
        :tabindex="canSelect(l) ? 0 : -1"
        :aria-disabled="canSelect(l) ? undefined : 'true'"
        @tap="canSelect(l) && emit('select', l.layer)"
        @keydown.enter.prevent="canSelect(l) && emit('select', l.layer)"
      >
        <text class="pg-layersheet__idx">{{ layerNumber(l.layer) }}</text>
        <text class="pg-layersheet__name">{{ layerName(l.layer) }}</text>
        <text class="pg-layersheet__status">{{ statusText(l) }}</text>
      </view>
    </view>
    <PgButton class="pg-layersheet__close" variant="secondary" block @tap="emit('update:open', false)">关闭</PgButton>
  </PgSheet>
</template>

<style scoped>
.pg-layersheet__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-layersheet__list { display: flex; flex-direction: column; }
.pg-layersheet__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 52px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-12);
  cursor: pointer;
}
.pg-layersheet__row + .pg-layersheet__row { border-top: var(--bw) solid var(--rule); }
.pg-layersheet__row--current { background: var(--accent-soft); color: var(--accent-text); border-top-color: transparent; }
.pg-layersheet__row--disabled { cursor: default; opacity: 0.55; }
.pg-layersheet__idx {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-13);
  font-weight: var(--fw-black);
}
.pg-layersheet__name { flex: 1; min-width: 0; font-size: var(--fs-15); font-weight: var(--fw-heavy); }
.pg-layersheet__status { color: var(--ink-2); font-size: var(--fs-13); }
</style>
