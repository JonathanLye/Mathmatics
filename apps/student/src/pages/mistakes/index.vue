<script setup lang="ts">
/** 错题（占位）：数据接口在后续任务；先把入口立住，不假装有数据。 */
import AppShell from '@/components/AppShell.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'

function goProofbook(): void {
  uni.reLaunch({ url: '/pages/proofbook/index' })
}
</script>

<template>
  <AppShell active="mistakes">
    <view class="pg-mistakes" data-testid="mistakes-page">
      <text class="pg-mistakes__title">错题</text>
      <PgEmpty
        title="错题本还在准备"
        body="做过的题里，值得再练一遍的会收在这里。现在可以先去证明本看看「稍后重做」。"
        expr="think"
        :motion="['think-tilt', 'blink']"
        action="去证明本"
        action-testid="mistakes-to-proofbook"
        @action="goProofbook"
      />
    </view>
  </AppShell>
</template>

<style scoped>
.pg-mistakes__title { display: block; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
</style>
