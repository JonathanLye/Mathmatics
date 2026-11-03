<script setup lang="ts">
/**
 * <MathText :text="MathText 字符串" />
 * H5：KaTeX 渲染；非 H5（小程序 P2）：降级为纯文本/rich-text 预留。
 * 对外接口固定为 text: MathText（02 §9），后续小程序端替换内部实现即可。
 */
import { computed } from 'vue'
import katex from 'katex'
import { parseMathText } from './mathText'

const props = withDefaults(
  defineProps<{
    text?: string
    /** 行内(span) 还是整段(div)，默认 span */
    block?: boolean
    /** 题面等需要更宽松的行高 */
    serif?: boolean
  }>(),
  { text: '', block: false, serif: false },
)

const segments = computed(() => parseMathText(props.text ?? ''))

function renderMath(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    return ''
  }
}
</script>

<template>
  <text v-if="segments.length === 0" class="ui-math-text" />
  <text
    v-else
    class="ui-math-text"
    :class="{ 'ui-math-text--serif': serif }"
    :style="block ? 'display:block' : ''"
  >
    <template v-for="(seg, i) in segments" :key="i">
      <template v-if="seg.kind === 'text'">{{ seg.value }}</template>
      <span v-else class="ui-math-tex" v-html="renderMath(seg.value)" />
    </template>
  </text>
</template>

<style>
.ui-math-text {
  font: inherit;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}
.ui-math-text--serif {
  font-family: var(--font-serif, serif);
}
.ui-math-tex .katex {
  font-size: 1.05em;
}
</style>
