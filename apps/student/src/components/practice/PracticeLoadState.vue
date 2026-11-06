<script setup lang="ts">
/** 打开做题页时的两个过渡屏：加载骨架，和加载失败的错误屏（重试 / 回首页）。绝不留白屏。 */
import PgButton from '@/components/ui/PgButton.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'

defineProps<{ phase: 'loading' | 'error'; message?: string }>()
defineEmits<{ (e: 'retry'): void; (e: 'home'): void }>()
</script>

<template>
  <view class="pg-page pg-loadstate">
    <view v-if="phase === 'loading'" class="pg-loadstate__skeleton" data-testid="practice-loading" role="status" aria-label="正在打开这道题">
      <PgSkeleton variant="line" width="100%" height="14px" />
      <PgSkeleton variant="block" width="100%" height="120px" />
      <PgSkeleton variant="line" :count="3" />
      <PgSkeleton variant="block" width="100%" height="160px" />
    </view>
    <view v-else class="pg-loadstate__error" data-testid="practice-load-error">
      <PgEmpty title="这道题没打开" :body="message" expr="oops" :motion="null">
        <template #action>
          <view class="pg-loadstate__actions">
            <PgButton block size="lg" data-testid="practice-load-retry" sound="tap" @tap="$emit('retry')">再试一次</PgButton>
            <PgButton block variant="ghost" data-testid="practice-load-home" @tap="$emit('home')">回首页</PgButton>
          </view>
        </template>
      </PgEmpty>
    </view>
  </view>
</template>

<style scoped>
.pg-loadstate { display: flex; justify-content: center; }
.pg-loadstate__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
  max-width: var(--form-max);
  padding: calc(var(--safe-top) + var(--sp-4)) 0;
}
.pg-loadstate__error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: var(--form-max);
  min-height: 100vh;
  min-height: 100dvh;
}
.pg-loadstate__actions { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; margin-top: var(--sp-3); }
</style>
