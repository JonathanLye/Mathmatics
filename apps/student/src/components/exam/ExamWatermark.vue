<script setup lang="ts">
/**
 * 测验水印覆盖层（11 §5.3）：6% 不透明度、斜向平铺、内容「匿名码 · 日期 时:分」、每分钟更新。
 * - CSS/SVG data URI（不渲染 DOM 文字，截图时也能平铺）；
 * - pointer-events:none / user-select:none：不影响任何点击与输入；
 * - 只接收已格式化的文本（不在组件里读身份/时间，便于单测与复用）。
 */
import { computed } from 'vue'
import { WATERMARK_UPDATE_MS, cachedWatermarkBackground } from './exam'

const props = withDefaults(defineProps<{ text: string; updateMs?: number }>(), {
  updateMs: WATERMARK_UPDATE_MS,
})
const cache = new Map<string, string>()
const backgroundImage = computed(() => cachedWatermarkBackground(props.text, cache))
const style = computed<Record<string, string>>(() => ({
  backgroundImage: backgroundImage.value,
  backgroundRepeat: 'repeat',
  backgroundSize: '280px 140px',
  pointerEvents: 'none',
  userSelect: 'none',
  webkitUserSelect: 'none',
}))
</script>

<template>
  <view class="pg-watermark" data-testid="exam-watermark" aria-hidden="true" :style="style" />
</template>

<style scoped>
.pg-watermark {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
</style>
