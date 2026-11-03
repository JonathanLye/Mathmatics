<script setup lang="ts">
/**
 * 顶栏（02 §3.1）：返回、题名、六点层进度、当前层名。
 * 六点：已完成 ✓ / 进行中实心 / 跳过空心 / 锁定灰点；点开 = 层列表弹层。
 */
import type { LayerId, LayerStatus } from '@/types/attempt'

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

function dotClass(layer: LayerStatus): string {
  return [
    'pg-dot',
    'pg-dot--' + layer.status,
    props.currentLayer === layer.layer ? 'pg-dot--current' : '',
  ].filter(Boolean).join(' ')
}
</script>

<template>
  <view class="pg-topbar" :class="{ 'pg-topbar--dark': dark }">
    <view v-if="showBack" class="pg-topbar__back pg-tap" role="button" aria-label="返回" @tap="emit('back')">
      <text class="pg-topbar__chevron">‹</text>
    </view>
    <view class="pg-topbar__title">
      <text class="pg-topbar__name">{{ props.title }}</text>
    </view>
    <view class="pg-topbar__progress pg-tap" role="button" aria-label="层列表" @tap="emit('open-layers')">
      <view class="pg-topbar__dots">
        <view v-for="l in props.layers" :key="l.layer" :class="dotClass(l)" />
      </view>
      <text v-if="props.currentLayer" class="pg-topbar__layer pg-mono">{{ props.currentLayer }}</text>
    </view>
  </view>
</template>

<style scoped>
.pg-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 52px;
  padding: calc(var(--safe-top) + var(--sp-2)) var(--sp-3) var(--sp-2);
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule);
}
.pg-topbar__back {
  width: 44px;
  height: 44px;
  margin-left: calc(-1 * var(--sp-2));
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pg-topbar__chevron {
  font-size: 26px;
  line-height: 1;
}
.pg-topbar__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pg-topbar__name {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
.pg-topbar__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: 44px;
  padding-left: var(--sp-2);
}
.pg-topbar__dots {
  display: flex;
  gap: 5px;
}
.pg-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rule);
}
.pg-dot--done { background: var(--ok); }
.pg-dot--active { background: var(--accent); }
.pg-dot--skipped { border: 1px solid var(--ink-2); background: transparent; }
.pg-dot--disabled { background: transparent; border: 1px dashed var(--rule); }
.pg-dot--current { box-shadow: 0 0 0 3px var(--accent-soft); }
.pg-topbar__layer {
  font-size: 12px;
  color: var(--ink-2);
}
</style>
