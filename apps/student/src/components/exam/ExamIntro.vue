<script setup lang="ts">
/**
 * 严格测验说明页（11 §5.2：开始前：说明页（规则 + 剩余时间 + "切出 3 次将锁定，需要老师解锁"）→ 学生点「开始」）。
 *
 * 只展示服务端给出的剩余时间/次数（缺省文案说「以老师设置为准」，不自造数值）。
 */
const props = withDefaults(
  defineProps<{
    /** 格式化后的剩余时间，例如 "14:59"；null/— 表示服务端未给截止时间。 */
    remainingText?: string
    /** 切出锁定阈值（服务端/mock 下发；缺省 3，仅用于文案）。 */
    maxWarnings?: number
    /** 请求全屏失败/不支持时的说明（开始后由页面传入；说明页阶段通常为 null）。 */
    fullscreenNote?: string | null
    busy?: boolean
  }>(),
  { remainingText: '—', maxWarnings: 3, fullscreenNote: null, busy: false },
)
const emit = defineEmits<{ (e: 'start'): void }>()
</script>

<template>
  <view class="pg-examgate" data-testid="exam-intro" role="dialog" aria-modal="true" aria-labelledby="pg-examgate-title">
    <view class="pg-examgate__sheet">
      <text id="pg-examgate-title" class="pg-examgate__title">严格测验</text>
      <text class="pg-examgate__sub pg-small">这是老师设置的限时测验，过程和离开次数会记录给老师。</text>
      <view class="pg-examgate__time">
        <text class="pg-examgate__timelabel pg-small">剩余时间</text>
        <text class="pg-examgate__timevalue pg-mono" data-testid="exam-intro-remaining">{{ props.remainingText }}</text>
      </view>
      <view class="pg-examgate__rules">
        <text class="pg-examgate__rule pg-small">· 开始后请求全屏；不支持全屏时自动开启水印模式。</text>
        <text class="pg-examgate__rule pg-small">· 离开页面会累计切出次数；第 {{ props.maxWarnings }} 次将锁定本题，需要老师解锁。</text>
        <text class="pg-examgate__rule pg-small">· 作答中关闭提示与拍照，拦截复制粘贴，题面不可选中复制。</text>
        <text class="pg-examgate__rule pg-small">· 页面上有你匿名码 + 时间的水印；截图外传可溯源。</text>
        <text class="pg-examgate__rule pg-small">· 倒计时以服务端时间为准，到点由服务端自动提交。</text>
      </view>
      <text v-if="props.fullscreenNote" class="pg-examgate__fs pg-small" data-testid="exam-fullscreen-note">{{ props.fullscreenNote }}</text>
      <button class="pg-examgate__btn" role="button" data-testid="exam-start" :disabled="props.busy" @tap="emit('start')">
        开始作答
      </button>
      <text class="pg-examgate__fine pg-small">点击开始即表示你已了解上述规则；遇到问题请联系老师。</text>
    </view>
  </view>
</template>

<style scoped>
.pg-examgate {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: var(--mask);
}
.pg-examgate__sheet {
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--sheet);
  border-radius: var(--radius-24);
  box-shadow: var(--shadow-sheet);
}
.pg-examgate__title { font-size: var(--fs-22); font-weight: var(--fw-black); color: var(--ink); }
.pg-examgate__sub { color: var(--ink-2); line-height: 1.6; }
.pg-examgate__time { display: flex; align-items: baseline; gap: var(--sp-2); }
.pg-examgate__timelabel { color: var(--ink-2); }
.pg-examgate__timevalue { font-size: var(--fs-22); color: var(--accent-text); }
.pg-examgate__rules { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-examgate__rule { color: var(--ink-2); line-height: 1.6; }
.pg-examgate__fs { color: var(--bee-text); }
.pg-examgate__btn {
  min-height: 48px;
  border-radius: var(--radius-12);
  border: var(--bw) solid var(--accent);
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--fs-16);
}
.pg-examgate__btn:disabled { opacity: 0.45; }
.pg-examgate__fine { color: var(--ink-2); }
</style>
