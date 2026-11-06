<script setup lang="ts">
/** 小标签：难度、状态、AI 整理、讲评已发布。颜色表达含义，文字色都过 4.5:1。 */
withDefaults(defineProps<{ tone?: 'neutral' | 'ok' | 'sea' | 'fox' | 'bee' | 'accent' }>(), { tone: 'neutral' })
</script>

<template>
  <text class="pg-tag" :class="'pg-tag--' + tone"><slot /></text>
</template>

<style scoped>
.pg-tag {
  display: inline-flex;
  align-items: center;
  flex: none;
  min-height: 22px;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
  line-height: 1.2;
  white-space: nowrap;
}
.pg-tag--ok { background: var(--ok-soft); color: var(--ok-text); }
.pg-tag--sea { background: var(--sea-soft); color: var(--sea-text); }
.pg-tag--fox { background: var(--fox-soft); color: var(--fox-text); }
.pg-tag--bee { background: var(--bee-soft); color: var(--bee-text); }
.pg-tag--accent { background: var(--accent-soft); color: var(--accent-text); }
</style>
