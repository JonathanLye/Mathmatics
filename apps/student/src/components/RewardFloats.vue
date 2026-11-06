<script setup lang="ts">
/** “+10 经验”飘字：做题页放一个就行，内容来自 useRewards。纯装饰，读屏看轻提示。 */
import { useRewards } from '@/motion/useRewards'

const { floats } = useRewards()
</script>

<template>
  <view class="pg-floats" aria-hidden="true" data-testid="reward-floats">
    <text v-for="item in floats" :key="item.id" class="pg-floats__item">{{ item.text }}</text>
  </view>
</template>

<style scoped>
.pg-floats { position: fixed; left: 50%; top: 22%; z-index: 90; width: 0; height: 0; pointer-events: none; }
.pg-floats__item {
  position: absolute;
  left: 0;
  transform: translateX(-50%);
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--radius-pill);
  background: var(--bee);
  box-shadow: 0 3px 0 var(--bee-lip);
  color: var(--on-bee);
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  white-space: nowrap;
  animation: pg-float-up 1400ms var(--ease-out) both;
}
@keyframes pg-float-up {
  0% { transform: translate(-50%, 18px) scale(0.8); opacity: 0; }
  18% { transform: translate(-50%, 0) scale(1.05); opacity: 1; }
  70% { transform: translate(-50%, -22px) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -44px) scale(1); opacity: 0; }
}
</style>
