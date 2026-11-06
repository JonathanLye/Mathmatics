<script setup lang="ts">
/**
 * 顶栏（02 §3.1）：关闭、六段层进度、当前层名、题名。
 * 六段：已完成满格 / 进行中半格 / 跳过半透明 / 未到灰色；点开 = 层列表弹层。
 */
import { computed } from 'vue'
import type { LayerId, LayerStatus } from '@/types/attempt'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import { segmentFromLayerStatus } from '@/components/ui/uiLogic'
import { layerName } from '@/copy'
import MathText from '@ui-math/MathText.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    currentLayer?: LayerId | null
    layers?: LayerStatus[]
    showBack?: boolean
    dark?: boolean
  }>(),
  { title: '', currentLayer: null, layers: () => [], showBack: true, dark: false },
)
const emit = defineEmits<{ (e: 'back'): void; (e: 'open-layers'): void }>()
const segments = computed(() => props.layers.map((layer) => segmentFromLayerStatus(layer.status)))
</script>

<template>
  <view class="pg-topbar" :class="{ 'pg-topbar--dark': dark }">
    <view class="pg-topbar__row">
      <PgButton v-if="showBack" class="pg-topbar__back" variant="ghost" size="icon" aria-label="返回" @tap="emit('back')">
        <PgIcon name="close" :size="28" />
      </PgButton>
      <view class="pg-topbar__progress" role="button" tabindex="0" aria-label="层列表" @tap="emit('open-layers')" @keydown.enter.prevent="emit('open-layers')">
        <PgProgress class="pg-topbar__dots" :segments="segments" seg-class="pg-dot" label="六层进度" />
        <text v-if="props.currentLayer" class="pg-topbar__layer">{{ layerName(props.currentLayer) }}</text>
      </view>
    </view>
    <view v-if="props.title" class="pg-topbar__name"><MathText :text="props.title" /></view>
  </view>
</template>

<style scoped>
.pg-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: calc(var(--safe-top) + var(--sp-2)) 0 var(--sp-2);
  background: var(--paper);
}
.pg-topbar__row { display: flex; align-items: center; gap: var(--sp-2); }
.pg-topbar__back { color: var(--ink-2); margin-left: -8px; }
.pg-topbar__progress { flex: 1; min-width: 0; min-height: var(--touch); display: flex; align-items: center; gap: var(--sp-2); cursor: pointer; }
.pg-topbar__dots { flex: 1; min-width: 0; }
.pg-topbar__layer { flex: none; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-topbar__name { margin-top: 2px; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
