<script setup lang="ts">
/** v2 图标：name 取 icons.ts 的 IconName；bulb 用 tone。内容是静态 SVG 字符串，无用户输入。 */
import { computed } from 'vue'
import { bulbSvg, iconSvg, qedSvg, type IconName } from './icons'

const props = withDefaults(defineProps<{ name: IconName | 'bulb' | 'qed'; size?: number; tone?: 'on' | 'off' | 'ink'; color?: string }>(), {
  size: 24,
  tone: 'on',
  color: undefined,
})

const svg = computed(() => {
  if (props.name === 'bulb') return bulbSvg(props.size, props.tone)
  if (props.name === 'qed') return qedSvg(props.size, props.color ?? 'currentColor')
  return iconSvg(props.name, props.size)
})
</script>

<template>
  <view class="pg-icon" :style="{ width: size + 'px', height: size + 'px' }" v-html="svg" />
</template>

<style scoped>
.pg-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0; }
</style>
