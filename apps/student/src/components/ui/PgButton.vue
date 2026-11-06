<script setup lang="ts">
/**
 * 按钮。class、data-testid、aria-* 和 @tap 都透传到根节点。
 * 音效默认没有：调用点传 sound 才响（教师镜像不传，保持安静）。
 */
import { computed } from 'vue'
import { playSfx, type SfxName } from '@/motion/sfx'
import { vibrate } from '@/motion/haptics'
import { buttonClasses, buttonDisabled, type ButtonSize, type ButtonVariant } from './uiLogic'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    block?: boolean
    /** 图标在上、文字在下（操作坞）。 */
    stack?: boolean
    loading?: boolean
    disabled?: boolean
    sound?: SfxName | null
  }>(),
  { variant: 'primary', size: 'md', block: false, stack: false, loading: false, disabled: false, sound: null },
)

const isDisabled = computed(() => buttonDisabled(props))
const classes = computed(() => buttonClasses(props))

function onPress(): void {
  if (isDisabled.value || !props.sound) return
  playSfx(props.sound)
  vibrate('tap')
}

/** uni-button 不是原生控件：补上键盘操作。 */
function onKey(event: KeyboardEvent): void {
  if (isDisabled.value) return
  ;(event.currentTarget as HTMLElement | null)?.click?.()
}
</script>

<template>
  <button
    class="pg-button"
    :class="classes"
    hover-class="none"
    role="button"
    :disabled="isDisabled"
    :aria-disabled="isDisabled ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    :tabindex="isDisabled ? -1 : 0"
    @tap="onPress"
    @keydown.enter.prevent="onKey"
    @keydown.space.prevent="onKey"
  >
    <view v-if="loading" class="pg-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.pg-button {
  --_face: var(--accent);
  --_ink: var(--on-accent);
  --_lip: var(--accent-lip);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 48px;
  margin-bottom: var(--lip);
  padding: 0 var(--sp-5);
  border: 0;
  border-radius: var(--radius-16);
  background: var(--_face);
  color: var(--_ink);
  box-shadow: 0 var(--lip) 0 var(--_lip);
  font-family: var(--font-sans);
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  letter-spacing: 0.3px;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-spring);
}
.pg-button:active:not([disabled]) {
  transform: translateY(var(--lip));
  box-shadow: 0 0 0 var(--_lip);
  transition-duration: var(--dur-fast);
}

/* 尺寸：触控区都 ≥ 44px */
.pg-button--sm { min-height: var(--touch); padding: 0 var(--sp-4); border-radius: var(--radius-12); font-size: var(--fs-13); }
.pg-button--lg { min-height: 52px; padding: 0 var(--sp-6); font-size: var(--fs-16); }
.pg-button--icon { min-width: var(--touch); min-height: var(--touch); padding: 0; border-radius: var(--radius-12); }
.pg-button--block { display: flex; width: 100%; }
.pg-button--stack { flex-direction: column; gap: 1px; padding: 0 var(--sp-1); font-size: var(--fs-12); }

/* 变体 */
.pg-button--secondary {
  --_face: var(--sheet);
  --_ink: var(--ink);
  --_lip: var(--rule-2);
  border: var(--bw) solid var(--rule-2);
}
.pg-button--ghost {
  --_face: transparent;
  --_ink: var(--ink-2);
  --_lip: transparent;
  margin-bottom: 0;
  box-shadow: none;
}
.pg-button--ghost:active:not([disabled]) { transform: scale(0.96); background: var(--paper-2); box-shadow: none; }
.pg-button--danger { --_face: var(--danger-face); --_ink: var(--on-danger); --_lip: var(--danger-lip); }
.pg-button--hint { --_face: var(--bee); --_ink: var(--on-bee); --_lip: var(--bee-lip); }
.pg-button--sea { --_face: var(--sea); --_ink: var(--on-sea); --_lip: var(--sea-lip); }

/* 禁用：平的，没有唇 */
.pg-button[disabled] {
  background: var(--rule);
  border-color: var(--rule);
  color: var(--ink-2);
  box-shadow: 0 var(--lip) 0 var(--rule);
  cursor: not-allowed;
}
.pg-button--ghost[disabled] { background: transparent; box-shadow: none; }

/* 加载 */
.pg-button__spinner {
  flex: none;
  width: 16px;
  height: 16px;
  border: var(--bw) solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: pg-spin 700ms linear infinite;
}
</style>
