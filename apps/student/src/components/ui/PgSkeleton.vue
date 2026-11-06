<script setup lang="ts">
/** 加载骨架：line（文字行）、block（卡片）、circle（节点）。 */
withDefaults(
  defineProps<{ variant?: 'line' | 'block' | 'circle'; count?: number; width?: string; height?: string }>(),
  { variant: 'line', count: 1, width: undefined, height: undefined },
)
</script>

<template>
  <view class="pg-skeleton" :class="'pg-skeleton--' + variant" aria-hidden="true">
    <view v-for="i in count" :key="i" class="pg-skeleton__item" :style="{ width, height }" />
  </view>
</template>

<style scoped>
.pg-skeleton { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-skeleton__item {
  position: relative;
  overflow: hidden;
  background: var(--rule);
}
.pg-skeleton__item::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--shine), transparent);
  animation: pg-shine-sweep 1400ms ease-in-out infinite;
}
.pg-skeleton--line .pg-skeleton__item { height: 14px; border-radius: var(--radius-pill); }
.pg-skeleton--line .pg-skeleton__item:last-child:not(:first-child) { width: 64%; }
.pg-skeleton--block .pg-skeleton__item { height: 88px; border-radius: var(--radius-16); }
.pg-skeleton--circle { align-items: center; }
.pg-skeleton--circle .pg-skeleton__item { width: 72px; height: 72px; border-radius: 50%; }
</style>
