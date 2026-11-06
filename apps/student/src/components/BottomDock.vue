<script setup lang="ts">
/** 底部操作坞（02 §3.1）：输入方式 + 求助；固定底部，随键盘上移。 */
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'

const emit = defineEmits<{
  (e: 'ink'): void
  (e: 'keyboard'): void
  (e: 'photo'): void
  (e: 'help'): void
}>()
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
    <PgButton class="pg-dock__ink" :class="{ 'pg-dock__ink--active': inkActive }" size="lg" data-testid="dock-ink" @tap="emit('ink')">
      <PgIcon name="pen" :size="22" /><text>手写这一行</text>
    </PgButton>
    <PgButton class="pg-dock__btn" variant="secondary" stack data-testid="dock-keyboard" @tap="emit('keyboard')">
      <PgIcon name="keys" :size="26" /><text class="pg-dock__label">键盘</text>
    </PgButton>
    <PgButton
      class="pg-dock__btn pg-dock__btn--photo"
      :class="{ 'pg-dock__btn--disabled': photoDisabled }"
      variant="secondary"
      stack
      data-testid="dock-photo"
      :disabled="photoDisabled"
      @tap="emit('photo')"
    >
      <PgIcon name="camera" :size="26" /><text class="pg-dock__label">拍照</text>
    </PgButton>
    <PgButton
      class="pg-dock__btn pg-dock__btn--help"
      :class="{ 'pg-dock__btn--disabled': helpBusy || helpDisabled }"
      variant="hint"
      stack
      data-testid="dock-help"
      :disabled="helpBusy || helpDisabled"
      @tap="emit('help')"
    >
      <PgIcon name="bulb" :size="26" :tone="helpBusy || helpDisabled ? 'off' : 'ink'" /><text class="pg-dock__label">求助</text>
    </PgButton>
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
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3) max(var(--sp-4), var(--safe-left)) calc(var(--sp-3) + var(--safe-bottom)) max(var(--sp-4), var(--safe-right));
  background: var(--paper);
  border-top: var(--bw) solid var(--rule);
  transform: translateY(calc(-1 * var(--keyboard-inset)));
  transition: transform var(--dur-fast) ease-out;
}
.pg-dock__ink.pg-button { flex: 1; min-width: 0; min-height: 56px; }
.pg-dock__ink--active { outline: 3px solid var(--accent-soft); outline-offset: 2px; }
.pg-dock__btn.pg-button { flex: none; width: 58px; min-height: 56px; }
.pg-dock__label { font-size: var(--fs-12); font-weight: var(--fw-black); line-height: 1; }
</style>
