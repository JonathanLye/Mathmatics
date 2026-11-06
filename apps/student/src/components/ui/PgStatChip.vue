<script setup lang="ts">
/** 数字小标：图标 + 数值 + 说明（完成数、连胜、经验）。tone 表达含义：金=完成/经验，橙=连胜。 */
import PgIcon from './PgIcon.vue'
import type { IconName } from './icons'

withDefaults(
  defineProps<{ icon?: IconName | 'qed' | 'bulb' | null; value: string | number; label?: string; tone?: 'neutral' | 'accent' | 'bee' | 'fox' | 'sea' }>(),
  { icon: null, label: '', tone: 'neutral' },
)
</script>

<template>
  <view class="pg-stat" :class="'pg-stat--' + tone">
    <PgIcon v-if="icon" :name="icon" :size="20" color="currentColor" class="pg-stat__icon" />
    <text class="pg-stat__value">{{ value }}</text>
    <text v-if="label" class="pg-stat__label">{{ label }}</text>
    <slot />
  </view>
</template>

<style scoped>
.pg-stat {
  --_ink: var(--ink-2);
  --_icon: var(--ink-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 var(--sp-3) 0 var(--sp-2);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-pill);
  background: var(--sheet);
  color: var(--_ink);
  font-variant-numeric: tabular-nums;
}
.pg-stat__icon { color: var(--_icon); }
.pg-stat__value { font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1; }
.pg-stat__label { font-size: var(--fs-12); font-weight: var(--fw-heavy); line-height: 1.2; }
.pg-stat--accent { --_ink: var(--accent-text); --_icon: var(--accent); }
.pg-stat--bee { --_ink: var(--bee-text); --_icon: var(--bee); }
.pg-stat--fox { --_ink: var(--fox-text); --_icon: var(--fox); }
.pg-stat--sea { --_ink: var(--sea-text); --_icon: var(--sea); }
</style>
