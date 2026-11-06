<script setup lang="ts">
/**
 * 顶栏（02 §3.1）：返回、题名、六点层进度、当前层名。
 * 六点：已完成 ✓ / 进行中实心 / 跳过空心 / 锁定灰点；点开 = 层列表弹层。
 */
import type { LayerId, LayerStatus } from '@/types/attempt'
import PgIcon from '@/components/ui/PgIcon.vue'

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
    <view class="pg-topbar__row">
      <view v-if="showBack" class="pg-topbar__back pg-tap" role="button" aria-label="返回" @tap="emit('back')">
        <PgIcon name="close" :size="28" />
      </view>
      <view class="pg-topbar__progress" role="button" aria-label="层列表" @tap="emit('open-layers')">
        <view class="pg-topbar__dots">
          <view v-for="l in props.layers" :key="l.layer" :class="dotClass(l)"><view class="pg-dot__fill" /></view>
        </view>
        <text v-if="props.currentLayer" class="pg-topbar__layer">{{ props.currentLayer }}</text>
      </view>
    </view>
    <text v-if="props.title" class="pg-topbar__name">{{ props.title }}</text>
  </view>
</template>

<style scoped>
.pg-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: calc(var(--safe-top) + var(--sp-3)) var(--sp-4) var(--sp-2);
  background: var(--paper);
}
.pg-topbar__row { display: flex; align-items: center; gap: var(--sp-3); }
.pg-topbar__back { color: var(--ink-3); margin-left: -8px; }
.pg-topbar__progress { flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: var(--sp-2); }
.pg-topbar__dots { flex: 1; display: flex; gap: 4px; }
/* 六段进度条：16px 高、全圆角；完成=绿，当前=绿 50% + 顶部高光，跳过=虚线，锁定=灰 */
.pg-dot { position: relative; flex: 1; height: 16px; border-radius: 8px; background: var(--rule); overflow: hidden; }
.pg-dot__fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 8px; background: var(--accent); }
.pg-dot__fill::after { content: ''; position: absolute; left: 6px; right: 6px; top: 4px; height: 4px; border-radius: 2px; background: #fff; opacity: 0.35; }
.pg-dot--done .pg-dot__fill { width: 100%; }
.pg-dot--active .pg-dot__fill { width: 50%; }
.pg-dot--skipped { background: transparent; border: 2px dashed var(--ink-3); }
.pg-dot--disabled { background: var(--rule); opacity: 0.6; }
.pg-topbar__layer { font-size: 13px; font-weight: 900; color: var(--ink-2); letter-spacing: 0.5px; }
.pg-topbar__name { display: block; margin-top: 2px; font-size: 13px; font-weight: 800; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
