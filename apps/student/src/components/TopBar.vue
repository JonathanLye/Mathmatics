<script setup lang="ts">
/**
 * 做题页顶栏：关闭、一条连续的进度条（每层一个刻度）、求助灯泡。点进度条看层列表。
 * 层名不在这里重复：内容区只有一个标题。
 */
import { computed } from 'vue'
import type { LayerStatus } from '@/types/attempt'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import { layersProgress } from '@/components/practice/practiceProgress'

const props = withDefaults(
  defineProps<{
    layers?: LayerStatus[]
    completed?: boolean
    /** 求助灯泡：helpDisabled 时禁用（请求在途、测验关闭提示）。 */
    helpDisabled?: boolean
  }>(),
  { layers: () => [], completed: false, helpDisabled: false },
)
const emit = defineEmits<{ (e: 'back'): void; (e: 'open-layers'): void; (e: 'help'): void }>()
const progress = computed(() => layersProgress(props.layers, props.completed))
</script>

<template>
  <view class="pg-topbar" data-testid="practice-topbar">
    <view class="pg-topbar__row">
      <PgButton class="pg-topbar__back" variant="ghost" size="icon" aria-label="返回" @tap="emit('back')">
        <PgIcon name="close" :size="26" />
      </PgButton>
      <view
        class="pg-topbar__progress"
        data-testid="practice-progress"
        role="button"
        tabindex="0"
        aria-label="查看层列表"
        @tap="emit('open-layers')"
        @keydown.enter.prevent="emit('open-layers')"
      >
        <PgProgress :value="progress.value" label="这道题的进度" />
        <view class="pg-topbar__ticks" aria-hidden="true">
          <view v-for="at in progress.ticks" :key="at" class="pg-topbar__tick" :style="{ left: at * 100 + '%' }" />
        </view>
      </view>
      <PgButton
        class="pg-topbar__help"
        variant="ghost"
        size="icon"
        aria-label="求助"
        data-testid="dock-help"
        :disabled="props.helpDisabled"
        sound="tap"
        @tap="emit('help')"
      >
        <PgIcon name="bulb" :size="28" :tone="props.helpDisabled ? 'off' : 'on'" />
      </PgButton>
    </view>
  </view>
</template>

<style scoped>
.pg-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: calc(var(--safe-top) + var(--sp-1)) 0 var(--sp-1);
  background: var(--paper);
}
.pg-topbar__row { display: flex; align-items: center; gap: var(--sp-1); }
.pg-topbar__back { color: var(--ink-2); margin-left: -8px; }
.pg-topbar__help { margin-right: -8px; }
.pg-topbar__progress { position: relative; flex: 1; min-width: 0; min-height: var(--touch); display: flex; align-items: center; cursor: pointer; }
/* 刻度：压在进度条上的细缝，能看出还有几层，不抢进度本身的注意力。 */
.pg-topbar__ticks { position: absolute; left: 0; right: 0; top: 50%; height: 14px; transform: translateY(-50%); pointer-events: none; }
.pg-topbar__tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--paper); }
</style>
