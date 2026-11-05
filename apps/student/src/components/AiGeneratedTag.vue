<script setup lang="ts">
/**
 * AIGC 显式标识小标签（12 §7 / 13 合规 / 02 §7）。
 *
 * - 只在调用方确认内容由 AI 生成时渲染（如 LessonView.generated 非空）；组件自身不判定、不生成内容；
 * - 非交互元素（无点击），因此不占 44px 触控区；读屏通过 role="note" + aria-label 识别；
 * - 颜色/字号全部走 styles/tokens.css 的 CSS 变量（--ink-2 / --fs-small），深色模式自动跟随。
 */
import { AI_GENERATED_TAG_ARIA_LABEL, AI_GENERATED_TAG_TEXT } from './aigc'
</script>

<template>
  <text
    class="pg-aigc"
    role="note"
    :aria-label="AI_GENERATED_TAG_ARIA_LABEL"
    data-testid="aigc-tag"
  >
    {{ AI_GENERATED_TAG_TEXT }}
  </text>
</template>

<style scoped>
.pg-aigc {
  display: inline-block;
  margin-top: var(--sp-1);
  color: var(--ink-2);
  font-size: var(--fs-small);
  line-height: 1.5;
}
</style>
