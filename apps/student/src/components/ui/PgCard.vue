<script setup lang="ts">
/** 卡片：2px 边；lip 给可点的卡片加硬下唇；tone 表达含义（蓝=助教、金=提示、绿=完成）。 */
withDefaults(
  defineProps<{
    tone?: 'plain' | 'soft' | 'accent' | 'sea' | 'bee' | 'ok' | 'fox'
    lip?: boolean
    flush?: boolean
  }>(),
  { tone: 'plain', lip: false, flush: false },
)
</script>

<template>
  <view class="pg-card" :class="['pg-card--' + tone, { 'pg-card--lip': lip, 'pg-card--flush': flush }]">
    <slot />
  </view>
</template>

<style scoped>
.pg-card {
  --_border: var(--rule);
  min-width: 0;
  padding: var(--sp-4);
  border: var(--bw) solid var(--_border);
  border-radius: var(--radius-16);
  background: var(--sheet);
}
.pg-card--flush { padding: 0; overflow: hidden; }
.pg-card--lip { border-bottom-width: calc(var(--bw) + var(--lip) - 2px); }
.pg-card--soft { background: var(--paper-2); }
.pg-card--accent { --_border: var(--accent); background: var(--accent-soft); }
.pg-card--sea { --_border: var(--sea); background: var(--sea-soft); }
.pg-card--bee { --_border: var(--bee); background: var(--bee-soft); }
.pg-card--ok { --_border: var(--ok); background: var(--ok-soft); }
.pg-card--fox { --_border: var(--fox); background: var(--fox-soft); }
</style>
