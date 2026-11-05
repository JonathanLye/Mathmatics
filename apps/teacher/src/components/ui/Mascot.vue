<script setup lang="ts">
/** ∎ 小方：原创角色，装饰性。教师端只在 品牌位 / 班级卡 / 指标建议 / 空状态 出场。 */
import { computed } from 'vue';
import { mascotSvg, type MascotExpr, type MascotTone } from '@proof-gym/ui-math/design/icons.ts';

const props = withDefaults(defineProps<{ expr?: MascotExpr; size?: number; tone?: MascotTone }>(), { expr: 'idle', size: 72, tone: 'sea' });
const svg = computed(() => mascotSvg(props.expr, props.size, props.tone));
</script>

<template>
  <span class="pg-mascot" aria-hidden="true" v-html="svg" />
</template>

<style scoped>
.pg-mascot { display: inline-flex; flex: none; line-height: 0; }
</style>
