<script setup lang="ts" generic="T extends string">
/** 分段选择：单选一组里的一个（外观、输入来源）。方向键可切换。 */
import { computed } from 'vue'
import { nextSegmentIndex } from './uiLogic'

const props = withDefaults(
  defineProps<{
    modelValue: T
    options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; testid?: string }>
    label?: string
  }>(),
  { label: undefined },
)
const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>()

const activeIndex = computed(() => Math.max(0, props.options.findIndex((o) => o.value === props.modelValue)))
const thumbStyle = computed(() => ({
  width: 100 / Math.max(1, props.options.length) + '%',
  transform: 'translateX(' + activeIndex.value * 100 + '%)',
}))

function select(index: number): void {
  const option = props.options[index]
  if (!option || option.disabled || option.value === props.modelValue) return
  emit('update:modelValue', option.value)
}

function move(delta: 1 | -1): void {
  select(nextSegmentIndex(activeIndex.value, delta, props.options.map((o) => Boolean(o.disabled))))
}
</script>

<template>
  <view class="pg-segmented" role="radiogroup" :aria-label="label" @keydown.left.prevent="move(-1)" @keydown.right.prevent="move(1)">
    <view class="pg-segmented__thumb" :style="thumbStyle" aria-hidden="true" />
    <view
      v-for="(option, i) in options"
      :key="option.value"
      class="pg-segmented__option"
      :class="{ 'pg-segmented__option--on': i === activeIndex, 'pg-segmented__option--off': option.disabled }"
      role="radio"
      :aria-checked="i === activeIndex ? 'true' : 'false'"
      :aria-disabled="option.disabled ? 'true' : undefined"
      :tabindex="i === activeIndex ? 0 : -1"
      :data-testid="option.testid"
      @tap="select(i)"
    >
      {{ option.label }}
    </view>
  </view>
</template>

<style scoped>
.pg-segmented {
  position: relative;
  display: flex;
  min-height: var(--touch);
  padding: 0;
  border-radius: var(--radius-12);
  background: var(--paper-2);
  box-shadow: inset 0 0 0 var(--bw) var(--rule);
}
.pg-segmented__thumb {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border: var(--bw) solid var(--accent);
  border-radius: var(--radius-12);
  background: var(--accent-soft);
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-segmented__option {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--sp-2);
  color: var(--ink-2);
  font-size: var(--fs-13);
  font-weight: var(--fw-black);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: color var(--dur-fast) ease-out;
}
.pg-segmented__option--on { color: var(--accent-text); }
.pg-segmented__option--off { opacity: 0.45; cursor: not-allowed; }
</style>
