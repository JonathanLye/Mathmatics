<script setup lang="ts">
/**
 * 五个主标签。同一份结构靠媒体查询换形态：手机底部栏、平板图标侧栏、桌面左侧栏（带品牌）。
 * 只渲染一份，testid 不会重复；切换用 reLaunch，标签之间不堆页面栈。
 */
import { useFeedbackBox } from '@/feedbackbox/store'
import PgIcon from './PgIcon.vue'
import PgMascot from './PgMascot.vue'
import { TAB_ITEMS, tabTarget, type TabKey } from './uiLogic'

const props = defineProps<{ active?: TabKey | null }>()
// 信箱里有新回复时，「我的」标签上亮一个小圆点（金色，不用红；15 §7）。
const { hasUnread } = useFeedbackBox()

function go(key: TabKey): void {
  const url = tabTarget(props.active, key)
  if (url) uni.reLaunch({ url })
}
</script>

<template>
  <view class="pg-tabbar" role="navigation" aria-label="主导航">
    <view class="pg-tabbar__brand" aria-hidden="true">
      <PgMascot expr="idle" :size="40" />
      <text class="pg-tabbar__brandname">证明陪练场</text>
    </view>
    <view
      v-for="item in TAB_ITEMS"
      :key="item.key"
      class="pg-tabbar__item"
      :class="{ 'pg-tabbar__item--on': item.key === active }"
      role="button"
      tabindex="0"
      :aria-current="item.key === active ? 'page' : undefined"
      :data-testid="item.testid"
      @tap="go(item.key)"
      @keydown.enter.prevent="go(item.key)"
    >
      <view v-if="item.anchorTestid" class="pg-tabbar__anchor" :data-testid="item.anchorTestid" aria-hidden="true" />
      <PgIcon :name="item.icon" :size="26" />
      <view v-if="item.key === 'me' && hasUnread" class="pg-tabbar__dot" data-testid="tab-me-dot" aria-label="有新回复" />
      <text class="pg-tabbar__label">{{ item.label }}</text>
    </view>
  </view>
</template>

<style scoped>
/* 手机：底部五栏（390 宽每栏约 72px，四字以内不换行） */
.pg-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  justify-content: space-around;
  gap: var(--sp-1);
  padding: var(--sp-2) max(var(--sp-2), var(--safe-left)) calc(var(--sp-2) + var(--safe-bottom)) max(var(--sp-2), var(--safe-right));
  background: var(--paper);
  border-top: var(--bw) solid var(--rule);
}
.pg-tabbar__brand { display: none; }
.pg-tabbar__item {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: var(--bw) solid transparent;
  border-radius: var(--radius-16);
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-tabbar__item:active { transform: scale(0.95); }
.pg-tabbar__dot { position: absolute; top: 4px; left: calc(50% + 8px); width: 12px; height: 12px; border: var(--bw) solid var(--paper); border-radius: 50%; background: var(--bee); animation: pg-pop var(--dur-base) var(--ease-spring) both; }
.pg-tabbar__anchor { position: absolute; inset: 0; border-radius: inherit; }
.pg-tabbar__label { font-size: var(--fs-12); font-weight: var(--fw-black); line-height: 1; white-space: nowrap; }
.pg-tabbar__item--on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}

/* 平板：图标侧栏 */
@media (min-width: 600px) {
  .pg-tabbar {
    top: 0;
    right: auto;
    width: var(--shell-icon-rail);
    flex-direction: column;
    justify-content: flex-start;
    gap: var(--sp-2);
    padding: var(--sp-4) var(--sp-2);
    border-top: 0;
    border-right: var(--bw) solid var(--rule);
  }
  .pg-tabbar__brand { display: flex; justify-content: center; margin-bottom: var(--sp-3); }
  .pg-tabbar__brandname { display: none; }
  .pg-tabbar__item { flex: none; min-height: 64px; }
}

/* 桌面：带品牌和文字的左侧栏 */
@media (min-width: 1024px) {
  .pg-tabbar {
    width: var(--shell-side);
    padding: var(--sp-5) var(--sp-4);
  }
  .pg-tabbar__brand { align-items: center; justify-content: flex-start; gap: var(--sp-2); padding: 0 var(--sp-2); margin-bottom: var(--sp-4); }
  .pg-tabbar__brandname { display: block; color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: 1.2; white-space: nowrap; }
  .pg-tabbar__item {
    flex-direction: row;
    justify-content: flex-start;
    gap: var(--sp-3);
    min-height: 52px;
    padding: 0 var(--sp-3);
  }
  .pg-tabbar__item:not(.pg-tabbar__item--on):hover { background: var(--paper-2); }
  .pg-tabbar__label { font-size: var(--fs-15); }
}
</style>
