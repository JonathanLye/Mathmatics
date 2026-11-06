<script setup lang="ts">
/** 列表行：图标 + 标题/副标题 + 右侧内容。clickable 时带箭头和按压反馈；@tap 透传。 */
import PgIcon from './PgIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{ title: string; sub?: string; icon?: IconName | null; clickable?: boolean }>(),
  { sub: '', icon: null, clickable: false },
)
</script>

<template>
  <view class="pg-listrow" :class="{ 'pg-listrow--click': clickable }" :role="clickable ? 'button' : undefined" :tabindex="clickable ? 0 : undefined">
    <view v-if="icon" class="pg-listrow__icon"><PgIcon :name="icon" :size="22" /></view>
    <view class="pg-listrow__main">
      <text class="pg-listrow__title">{{ title }}</text>
      <text v-if="sub" class="pg-listrow__sub">{{ sub }}</text>
    </view>
    <view class="pg-listrow__right">
      <slot name="right" />
      <PgIcon v-if="clickable" name="chevron" :size="18" class="pg-listrow__chevron" />
    </view>
  </view>
</template>

<style scoped>
.pg-listrow {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-2) var(--sp-4);
}
.pg-listrow + .pg-listrow { border-top: var(--bw) solid var(--rule); }
.pg-listrow--click { cursor: pointer; }
.pg-listrow--click:active { background: var(--paper-2); }
.pg-listrow__icon {
  flex: none;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--paper-2);
  color: var(--ink-2);
}
.pg-listrow__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-listrow__title { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); line-height: 1.35; }
.pg-listrow__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.4; }
.pg-listrow__right { flex: none; display: flex; align-items: center; gap: var(--sp-2); color: var(--ink-2); }
.pg-listrow__chevron { color: var(--ink-2); }
</style>
