<script setup lang="ts">
/** 首页数字：完成题数 + 本周自己写出的关键步骤。手机在主列顶部，桌面在右栏。 */
import PgStatChip from '@/components/ui/PgStatChip.vue'
import { useCountUp } from '@/motion/useCountUp'
import { computed } from 'vue'
import type { HomeData } from '@/api/client'

const props = defineProps<{ home: HomeData }>()
const done = useCountUp(computed(() => props.home.done.length))
</script>

<template>
  <view class="pg-homestats">
    <PgStatChip icon="qed" :value="done" label="题" tone="bee" data-testid="home-done-count" />
    <PgStatChip v-if="home.week" icon="check" :value="home.week.keysOwn + '/' + home.week.keysTotal" label="本周自己写出的关键步骤" tone="accent" data-testid="home-week" />
  </view>
</template>

<style scoped>
.pg-homestats { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
</style>
