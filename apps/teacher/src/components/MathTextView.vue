<script setup lang="ts">
import { computed } from 'vue';
import { parseMathText } from '@proof-gym/ui-math/mathText';
import { MATH_RENDER_FAILED_HINT, renderMath } from '@proof-gym/ui-math/mathRender';

const props = defineProps<{ text?: string }>();

type ViewSegment = { kind: 'text' | 'failed'; value: string } | { kind: 'math'; html: string; display: boolean };

const segments = computed<ViewSegment[]>(() =>
  parseMathText(props.text ?? '').map((seg): ViewSegment => {
    if (seg.kind === 'text') return seg;
    const display = seg.display === true;
    const rendered = renderMath(seg.value, { display });
    return rendered.ok ? { kind: 'math', html: rendered.html, display } : { kind: 'failed', value: seg.value };
  }),
);
</script>

<template>
  <span class="math-text">
    <template v-for="(seg, index) in segments" :key="index">
      <span v-if="seg.kind === 'text'">{{ seg.value }}</span>
      <span v-else-if="seg.kind === 'failed'" class="math-raw" :title="MATH_RENDER_FAILED_HINT">{{ seg.value }}</span>
      <span v-else :class="seg.display ? 'math-display' : 'math-tex'" v-html="seg.html" />
    </template>
  </span>
</template>

<style scoped>
.math-raw {
  font-family: var(--font-mono);
  border-bottom: 2px dotted var(--rule-2);
}
.math-display {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
</style>
