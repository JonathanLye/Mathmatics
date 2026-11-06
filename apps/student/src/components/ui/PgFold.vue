<script setup lang="ts">
/** 折叠块：次要内容收起来，点标题展开（mathlib 对照收在“延伸”下面）。 */
import { ref } from 'vue'
import PgIcon from './PgIcon.vue'

defineProps<{ title: string }>()
const open = ref(false)
</script>

<template>
  <view class="pg-fold" :class="{ 'pg-fold--open': open }">
    <view class="pg-fold__head" role="button" tabindex="0" :aria-expanded="open ? 'true' : 'false'" @tap="open = !open" @keydown.enter.prevent="open = !open">
      <text class="pg-fold__title">{{ title }}</text>
      <PgIcon name="chevron" :size="16" class="pg-fold__chevron" />
    </view>
    <view v-if="open" class="pg-fold__body"><slot /></view>
  </view>
</template>

<style scoped>
.pg-fold { width: 100%; }
.pg-fold__head {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: var(--touch);
  color: inherit;
  font-size: var(--fs-13);
  font-weight: var(--fw-black);
  cursor: pointer;
}
.pg-fold__chevron { transition: transform var(--dur-base) var(--ease-out); }
.pg-fold--open .pg-fold__chevron { transform: rotate(90deg); }
.pg-fold__body { padding-bottom: var(--sp-2); font-size: var(--fs-13); line-height: var(--lh-body); }
</style>
