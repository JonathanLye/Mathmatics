<script setup lang="ts">
/**
 * 小方：原创角色。表情在 icons.ts（静态 SVG），动作全是 CSS。
 * 默认静止：调用点传 motion 才动（教师镜像等不传）。prefers-reduced-motion 和动效开关由 base.css 统一关闭。
 * 装饰性，对读屏隐藏。
 */
import { computed } from 'vue'
import { mascotSvg, type MascotExpr } from './icons'
import { mascotMotionClasses, type MascotMotion } from './uiLogic'

const props = withDefaults(
  defineProps<{ expr?: MascotExpr; motion?: MascotMotion | readonly MascotMotion[] | null; size?: number }>(),
  { expr: 'idle', motion: null, size: 72 },
)
const svg = computed(() => mascotSvg(props.expr, props.size))
const classes = computed(() => mascotMotionClasses(props.motion))
</script>

<template>
  <view class="pg-mascot" :class="classes" aria-hidden="true" :data-expr="expr" v-html="svg" />
</template>

<!-- SVG 由 v-html 注入，scoped 够不着，所以这里不加 scoped；类名都带 pgm- 前缀。 -->
<style>
.pg-mascot { display: inline-flex; flex: none; line-height: 0; }
.pg-mascot .pgm-figure,
.pg-mascot .pgm-eyes,
.pg-mascot .pgm-arm,
.pg-mascot .pgm-extra {
  transform-box: fill-box;
  transform-origin: 50% 100%;
}
.pg-mascot .pgm-eyes { transform-origin: 50% 50%; }
.pg-mascot .pgm-arm-l { transform-origin: 100% 100%; }
.pg-mascot .pgm-arm-r { transform-origin: 0% 100%; }

.pg-mascot--breathe .pgm-figure { animation: pgm-breathe 3200ms ease-in-out infinite; }
.pg-mascot--blink .pgm-eyes { animation: pgm-blink 4600ms linear infinite; }
.pg-mascot--hop .pgm-figure { animation: pgm-hop 620ms var(--ease-out) 2; }
.pg-mascot--cheer .pgm-figure { animation: pgm-hop 560ms var(--ease-out) 4; }
.pg-mascot--cheer .pgm-arm-l { animation: pgm-wave-l 280ms ease-in-out 8 alternate; }
.pg-mascot--cheer .pgm-arm-r { animation: pgm-wave-r 280ms ease-in-out 8 alternate; }
.pg-mascot--think-tilt .pgm-figure { animation: pgm-tilt 1800ms ease-in-out infinite alternate; }
.pg-mascot--droop .pgm-figure { animation: pgm-droop var(--dur-slow) var(--ease-out) both; }

@keyframes pgm-breathe {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(0.985, 1.025); }
}
@keyframes pgm-blink {
  0%, 94%, 100% { transform: scaleY(1); }
  97% { transform: scaleY(0.08); }
}
@keyframes pgm-hop {
  0% { transform: translateY(0) scale(1.04, 0.94); }
  40% { transform: translateY(-16%) scale(0.97, 1.04); }
  75% { transform: translateY(0) scale(1.05, 0.93); }
  100% { transform: translateY(0) scale(1, 1); }
}
@keyframes pgm-wave-l {
  from { transform: rotate(-10deg); }
  to { transform: rotate(14deg); }
}
@keyframes pgm-wave-r {
  from { transform: rotate(10deg); }
  to { transform: rotate(-14deg); }
}
@keyframes pgm-tilt {
  from { transform: rotate(-3deg); }
  to { transform: rotate(3deg); }
}
@keyframes pgm-droop {
  to { transform: translateY(3%) scale(1.02, 0.96) rotate(2deg); }
}
</style>
