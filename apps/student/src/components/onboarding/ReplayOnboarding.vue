<script setup lang="ts">
/**
 * “重看新手引导”的一行（我的页放进手感那组列表里即可）：
 *   <ReplayOnboarding />            // 放在 <PgCard flush> 里，像其他 PgListRow 一样
 * 点一下：清掉除“欢迎页”外的已读标记，去欢迎页放开场动画，放完回首页再走一遍导览；
 * 做题页里的就地提示（第一次手写、第一次求助……）也会再出现一次。
 * 不用这一行的页面可以直接调 replayOnboarding()。
 */
import { ref } from 'vue'
import PgListRow from '@/components/ui/PgListRow.vue'
import { replayOnboarding } from '@/composables/useOnboarding'
import { REPLAY_COPY } from '@/copy/onboarding'

const busy = ref(false)

async function start(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await replayOnboarding()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PgListRow :title="REPLAY_COPY.title" :sub="REPLAY_COPY.sub" icon="help" clickable data-testid="me-replay-onboarding" @tap="start" />
</template>
