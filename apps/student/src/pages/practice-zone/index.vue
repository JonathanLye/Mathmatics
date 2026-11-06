<script setup lang="ts">
/** 练习（占位）：内容在后续任务；先把入口立住，不假装有题。pages/practice 是写证明的工作台，所以这里叫 practice-zone。 */
import AppShell from '@/components/AppShell.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'

function goHome(): void {
  uni.reLaunch({ url: '/pages/home/index' })
}
</script>

<template>
  <AppShell active="practice">
    <view class="pg-zone" data-testid="practice-zone-page">
      <text class="pg-zone__title">练习</text>
      <PgEmpty
        title="练习区还在准备"
        body="这里会放可以自己挑着练的题。现在可以先沿着路径往前走。"
        expr="think"
        :motion="['think-tilt', 'blink']"
        action="回到路径"
        action-testid="practice-zone-to-home"
        @action="goHome"
      />
    </view>
  </AppShell>
</template>

<style scoped>
.pg-zone__title { display: block; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
</style>
