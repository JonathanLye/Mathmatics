<script setup lang="ts">
/**
 * 外壳：手机底部五栏；平板图标侧栏；桌面左侧栏 + 600px 主列 + 右栏。
 * 形态全靠 CSS，首帧就是对的，不等 JS 量宽度。右栏默认是学习进度（ProgressRail），只在桌面挂载，手机不多发请求；页面也可以用 #rail 换掉。
 * 做题页不用这个外壳：它隐藏标签栏，顶部是进度条。
 */
import { computed, onMounted, useSlots } from 'vue'
import OfflineBar from '@/components/OfflineBar.vue'
import ProgressRail from '@/components/ProgressRail.vue'
import WechatHint from '@/components/WechatHint.vue'
import PgTabBar from '@/components/ui/PgTabBar.vue'
import type { TabKey } from '@/components/ui/uiLogic'
import { ensureSettingsLoaded } from '@/composables/useSettingsSync'
import { useViewport } from '@/composables/useViewport'
import FeedbackHost from '@/feedbackbox/FeedbackHost.vue'
import { initIntegrity } from '@/integrity/sdk'

defineProps<{ active: TabKey }>()

const slots = useSlots()
const { mode } = useViewport()
const showRail = computed(() => Boolean(slots.rail) || mode.value === 'desktop')

onMounted(() => {
  // 每次进主标签页都对一下账号里的设置（外观、手感）；同一位同学只拉一次。
  void ensureSettingsLoaded()
})

/** 离线条的重试：事件队列立刻补发一次。 */
async function handleOfflineRetry(): Promise<void> {
  await initIntegrity().flush('manual')
}
</script>

<template>
  <view class="pg-shell" :class="{ 'pg-shell--has-rail': showRail }">
    <PgTabBar :active="active" />
    <view class="pg-shell__body">
      <OfflineBar class="pg-shell__offline" @retry="handleOfflineRetry" />
      <WechatHint />
      <view class="pg-shell__columns">
        <view class="pg-shell__main pg-enter"><slot /></view>
        <view v-if="showRail" class="pg-shell__rail"><slot name="rail"><ProgressRail /></slot></view>
      </view>
    </view>
    <!-- 小方信箱：悬浮入口 + 反馈弹层（15 号文档） -->
    <FeedbackHost />
  </view>
</template>

<style scoped>
.pg-shell {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--paper);
}
.pg-shell__body { min-width: 0; }
.pg-shell__columns { display: flex; justify-content: center; }

/* 手机：单列，给底部标签栏留位置 */
.pg-shell__main {
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: var(--shell-main);
  padding: calc(var(--safe-top) + var(--sp-4)) max(var(--sp-4), var(--safe-right)) calc(var(--tabbar-h) + var(--sp-8) + var(--safe-bottom)) max(var(--sp-4), var(--safe-left));
}
.pg-shell__rail { display: none; }

/* 平板：图标侧栏，主列居中 */
@media (min-width: 600px) {
  .pg-shell__body { margin-left: var(--shell-icon-rail); }
  .pg-shell__main { padding: var(--sp-6) var(--sp-6) var(--sp-10); }
}

/* 桌面：左侧栏 + 主列 + 右栏 */
@media (min-width: 1024px) {
  .pg-shell__body { margin-left: var(--shell-side); }
  .pg-shell__columns { gap: var(--sp-8); padding: 0 var(--sp-8); }
  .pg-shell__main { flex: 0 1 var(--shell-main); padding: var(--sp-8) 0 var(--sp-10); }
  .pg-shell__rail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    flex: 0 0 var(--shell-rail);
    position: sticky;
    top: 0;
    align-self: flex-start;
    max-height: 100vh;
    overflow-y: auto;
    padding: var(--sp-8) 0 var(--sp-6);
  }
}
</style>
