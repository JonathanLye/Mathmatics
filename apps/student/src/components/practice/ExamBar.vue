<script setup lang="ts">
/** #46 测验模式顶部计时条：倒计时以服务端 state.serverTime/截止时间为准；到点不在本地结束。 */
defineProps<{ timeUp: boolean; countdown: string; note?: string }>()
</script>

<template>
  <view class="pg-exambar" data-testid="exam-bar">
    <text class="pg-exambar__label">限时测验 · 只读计时</text>
    <text class="pg-exambar__time pg-mono" data-testid="exam-countdown">{{ timeUp ? '已到时间，等待服务端提交…' : countdown }}</text>
    <text v-if="note" class="pg-exambar__note pg-small" data-testid="exam-fullscreen-note">{{ note }}</text>
  </view>
</template>

<style scoped>
.pg-exambar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--accent-soft);
  border-bottom: 2px solid var(--accent);
  color: var(--accent-text);
}
.pg-exambar__label { font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-exambar__time { margin-left: auto; font-size: var(--fs-16); }
.pg-exambar__note { flex-basis: 100%; color: var(--bee-text); }
</style>
