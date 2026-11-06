<script setup lang="ts">
/** “我的”子页面的顶栏：返回 + 标题。直接打开链接没有上一页时回到“我的”。 */
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'

defineProps<{ title: string; testid?: string }>()

function back(): void {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
</script>

<template>
  <view class="pg-mesub">
    <PgButton variant="ghost" size="icon" aria-label="返回" :data-testid="testid ?? 'me-sub-back'" @tap="back"><PgIcon name="back" :size="26" /></PgButton>
    <text class="pg-mesub__title">{{ title }}</text>
  </view>
</template>

<style scoped>
.pg-mesub { display: flex; align-items: center; gap: var(--sp-1); min-height: var(--touch); }
.pg-mesub__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
</style>
