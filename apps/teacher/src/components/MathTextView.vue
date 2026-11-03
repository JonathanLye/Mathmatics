<script setup lang="ts">
import { computed } from 'vue';
import katex from 'katex';
import { parseMathText } from '@proof-gym/ui-math/mathText';

const props = defineProps<{ text?: string }>();
const segments = computed(() => parseMathText(props.text ?? ''));

function render(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false, strict: 'ignore' });
  } catch {
    return '';
  }
}
</script>

<template>
  <span class="math-text">
    <template v-for="(seg, index) in segments" :key="index">
      <span v-if="seg.kind === 'text'">{{ seg.value }}</span>
      <span v-else class="math-tex" v-html="render(seg.value)" />
    </template>
  </span>
</template>
