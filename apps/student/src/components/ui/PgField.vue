<script setup lang="ts">
/** 表单项：标签 + 输入（默认插槽）+ 提示或错误。错误用橙色提醒，不用红色判决。 */
defineProps<{ label?: string; hint?: string; error?: string; optional?: string }>()
</script>

<template>
  <view class="pg-field" :class="{ 'pg-field--error': Boolean(error) }">
    <view v-if="label" class="pg-field__labelrow">
      <text class="pg-field__label">{{ label }}</text>
      <text v-if="optional" class="pg-field__optional">{{ optional }}</text>
    </view>
    <slot />
    <text v-if="error" class="pg-field__error" role="alert">{{ error }}</text>
    <text v-else-if="hint" class="pg-field__hint">{{ hint }}</text>
  </view>
</template>

<style scoped>
.pg-field { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.pg-field__labelrow { display: flex; align-items: baseline; gap: var(--sp-2); }
.pg-field__label { color: var(--ink); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-field__optional { color: var(--ink-2); font-size: var(--fs-12); }
.pg-field__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-field__error { color: var(--fox-text); font-size: var(--fs-13); line-height: 1.5; }
.pg-field--error :deep(.pg-input-area) { border-color: var(--fox); }
</style>
