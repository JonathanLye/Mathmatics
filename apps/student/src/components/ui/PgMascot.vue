<script setup lang="ts">
/** ∎ 小方：原创角色。出场位置见 icons.ts 注释；装饰性，对读屏隐藏。 */
import { computed } from 'vue'
import { mascotSvg, type MascotExpr, type MascotTone } from './icons'

const props = withDefaults(defineProps<{ expr?: MascotExpr; size?: number; tone?: MascotTone }>(), {
  expr: 'idle',
  size: 72,
  tone: 'sea',
})
const svg = computed(() => mascotSvg(props.expr, props.size, props.tone))
</script>

<template>
  <view class="pg-mascot" aria-hidden="true" :data-expr="expr" v-html="svg" />
</template>

<style scoped>
.pg-mascot { display: inline-flex; flex: none; line-height: 0; }
</style>
