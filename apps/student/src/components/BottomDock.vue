<script setup lang="ts">
/** 底部操作坞（02 §3.1）：输入方式 + 求助；固定底部，随键盘上移。 */
const emit = defineEmits<{
  (e: 'ink'): void
  (e: 'keyboard'): void
  (e: 'photo'): void
  (e: 'help'): void
}>()
defineProps<{ inkActive?: boolean; helpBusy?: boolean }>()
</script>

<template>
  <view class="pg-dock">
    <button class="pg-dock__btn" :class="{ 'pg-dock__btn--active': inkActive }" @tap="emit('ink')">
      <text class="pg-dock__icon">✍</text>
      <text class="pg-dock__label">手写</text>
    </button>
    <button class="pg-dock__btn" @tap="emit('keyboard')">
      <text class="pg-dock__icon">⌨</text>
      <text class="pg-dock__label">键盘</text>
    </button>
    <button class="pg-dock__btn pg-dock__btn--photo" @tap="emit('photo')">
      <text class="pg-dock__icon">📷</text>
      <text class="pg-dock__label">拍照</text>
    </button>
    <button class="pg-dock__btn pg-dock__btn--help" :disabled="helpBusy" @tap="emit('help')">
      <text class="pg-dock__icon">?</text>
      <text class="pg-dock__label">求助</text>
    </button>
  </view>
</template>

<style scoped>
.pg-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  gap: var(--sp-1);
  justify-content: space-around;
  padding: var(--sp-1) max(var(--sp-3), var(--safe-left)) calc(var(--sp-1) + var(--safe-bottom)) max(var(--sp-3), var(--safe-right));
  background: var(--sheet);
  border-top: 1px solid var(--rule);
  box-shadow: var(--shadow-dock);
  transform: translateY(calc(-1 * var(--keyboard-inset, 0px)));
  transition: transform var(--dur-fast) ease-out;
}
.pg-dock__btn {
  flex: 1;
  min-height: 48px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  border-radius: var(--radius-input);
}
.pg-dock__btn--active { color: var(--accent); background: var(--accent-soft); }
.pg-dock__btn--help { color: var(--accent); }
.pg-dock__icon { font-size: 18px; line-height: 1; }
.pg-dock__label { font-size: 12px; line-height: 1.2; }
</style>
