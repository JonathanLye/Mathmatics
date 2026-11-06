<script setup lang="ts">
/** 开关。data-testid 透传到根节点；触控区 44px，视觉 28px 高。 */
import { switchNextValue } from './uiLogic'

const props = withDefaults(defineProps<{ modelValue: boolean; disabled?: boolean; label?: string }>(), { disabled: false, label: undefined })
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function toggle(): void {
  const next = switchNextValue(props.modelValue, props.disabled)
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<template>
  <view
    class="pg-switch"
    :class="{ 'pg-switch--on': modelValue, 'pg-switch--disabled': disabled }"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-disabled="disabled ? 'true' : undefined"
    :aria-label="label"
    :tabindex="disabled ? -1 : 0"
    @tap="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <view class="pg-switch__track"><view class="pg-switch__thumb" /></view>
  </view>
</template>

<style scoped>
.pg-switch {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: var(--touch);
  cursor: pointer;
  border-radius: var(--radius-pill);
}
.pg-switch__track {
  position: relative;
  width: 50px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--rule-2);
  transition: background-color var(--dur-base) ease-out;
}
.pg-switch__thumb {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--sheet);
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-switch--on .pg-switch__track { background: var(--accent); }
.pg-switch--on .pg-switch__thumb { transform: translateX(22px); }
.pg-switch--disabled { cursor: not-allowed; opacity: 0.6; }
</style>
