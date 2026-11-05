<script setup lang="ts">
/** v2 图标（静态 SVG 字符串，无用户输入，可 v-html）。图标源与学生端共用：packages/ui-math/src/design/icons.ts */
import { computed } from 'vue';
import { bulbSvg, iconSvg, qedSvg, type IconName } from '@proof-gym/ui-math/design/icons.ts';

const props = withDefaults(defineProps<{ name: IconName | 'bulb' | 'qed'; size?: number; tone?: 'on' | 'off' | 'ink'; color?: string }>(), {
  size: 24,
  tone: 'on',
  color: undefined,
});
const svg = computed(() => {
  if (props.name === 'bulb') return bulbSvg(props.size, props.tone);
  if (props.name === 'qed') return qedSvg(props.size, props.color ?? 'currentColor');
  return iconSvg(props.name, props.size);
});
</script>

<template>
  <span class="pg-icon" :style="{ width: size + 'px', height: size + 'px' }" v-html="svg" />
</template>

<style scoped>
.pg-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0; }
</style>
