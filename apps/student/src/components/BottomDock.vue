<script setup lang="ts">
/** 底部操作坞（02 §3.1）：输入方式 + 求助；固定底部，随键盘上移。 */
const emit = defineEmits<{
  (e: 'ink'): void
  (e: 'keyboard'): void
  (e: 'photo'): void
  (e: 'help'): void
}>()
import PgIcon from '@/components/ui/PgIcon.vue'
defineProps<{
  inkActive?: boolean
  helpBusy?: boolean
  /** #46 测验模式：拍照关闭（disabled，点击不会触发识别）。 */
  photoDisabled?: boolean
  /** #46 测验模式：求助入口关闭（布置配置 allowedHelp=off 时）。 */
  helpDisabled?: boolean
}>()
</script>

<template>
  <view class="pg-dock">
    <button class="pg-dock__ink pg-btn" :class="{ 'pg-dock__ink--active': inkActive }" data-testid="dock-ink" @tap="emit('ink')">
      <PgIcon name="pen" :size="22" /><text>手写这一行</text>
    </button>
    <button class="pg-dock__btn" data-testid="dock-keyboard" @tap="emit('keyboard')">
      <PgIcon name="keys" :size="26" /><text class="pg-dock__label">键盘</text>
    </button>
    <button
      class="pg-dock__btn pg-dock__btn--photo"
      :class="{ 'pg-dock__btn--disabled': photoDisabled }"
      data-testid="dock-photo"
      :disabled="photoDisabled"
      @tap="emit('photo')"
    >
      <PgIcon name="camera" :size="26" /><text class="pg-dock__label">拍照</text>
    </button>
    <button
      class="pg-dock__btn pg-dock__btn--help"
      :class="{ 'pg-dock__btn--disabled': helpBusy || helpDisabled }"
      data-testid="dock-help"
      :disabled="helpBusy || helpDisabled"
      @tap="emit('help')"
    >
      <PgIcon name="bulb" :size="26" :tone="helpBusy || helpDisabled ? 'off' : 'on'" /><text class="pg-dock__label">求助</text>
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
  align-items: stretch;
  gap: var(--sp-2);
  padding: var(--sp-3) max(var(--sp-4), var(--safe-left)) calc(var(--sp-3) + var(--safe-bottom)) max(var(--sp-4), var(--safe-right));
  background: var(--paper);
  border-top: 2px solid var(--rule);
  transform: translateY(calc(-1 * var(--keyboard-inset, 0px)));
  transition: transform var(--dur-fast) ease-out;
}
.pg-dock__ink { flex: 1; min-width: 0; }
.pg-dock__ink--active { outline: 3px solid var(--accent-soft); outline-offset: 2px; }
.pg-dock__btn {
  flex: none;
  width: 58px;
  min-height: 52px;
  padding: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border: 2px solid var(--rule);
  border-bottom-width: 4px;
  border-radius: var(--radius-card);
  background: var(--sheet);
  color: var(--ink-2);
}
.pg-dock__btn::after { display: none; }
.pg-dock__btn:active { transform: translateY(2px); border-bottom-width: 2px; }
.pg-dock__btn--help { border-color: var(--hint-fill); border-bottom-color: var(--hint-lip); background: var(--hint-soft); color: var(--hint); }
.pg-dock__btn--disabled { opacity: 0.45; }
.pg-dock__label { font-size: 10px; font-weight: 900; letter-spacing: 0.5px; line-height: 1; }
</style>
