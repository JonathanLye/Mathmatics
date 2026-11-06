<script setup lang="ts">
/** 证明本摘要：手机在路径末尾，桌面在右栏。notebook 是契约可选字段，缺省时降级。 */
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import type { HomeData } from '@/api/client'

defineProps<{ home: HomeData }>()
</script>

<template>
  <PgCard class="pg-homebook" data-testid="home-notebook">
    <view class="pg-homebook__icon"><PgIcon name="book" :size="24" /></view>
    <view class="pg-homebook__main">
      <text class="pg-homebook__title">证明本</text>
      <text v-if="home.notebook" class="pg-homebook__sub" data-testid="home-notebook-summary">
        已收录 {{ home.notebook.cards }} 份证明 · {{ home.notebook.toRedo }} 题待重做
      </text>
      <text v-else class="pg-homebook__sub" data-testid="home-notebook-empty">写完的证明会收进证明本，随时可以回看。</text>
    </view>
  </PgCard>
</template>

<style scoped>
.pg-homebook { display: flex; align-items: flex-start; gap: var(--sp-3); }
.pg-homebook__icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--sea-soft);
  color: var(--sea-text);
}
.pg-homebook__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-homebook__title { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-homebook__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
</style>
