<script setup lang="ts">
/** 单元终点的宝箱：单元复习入口，跳到错题并按这一章筛选。单元写完后变成金色、打开。 */
import { PATH_COPY } from '@/copy'
import { playSfx } from '@/motion/sfx'

defineProps<{ done: boolean; side: 'left' | 'right'; index: number }>()
const emit = defineEmits<{ (e: 'open'): void }>()

function open(): void {
  playSfx('tap')
  emit('open')
}
</script>

<template>
  <view class="pg-chest" :class="['pg-chest--' + side, { 'pg-chest--done': done }]" :style="{ '--i': index }">
    <view class="pg-chest__inner">
      <view class="pg-chest__btn" role="button" tabindex="0" data-testid="home-unit-review" :aria-label="PATH_COPY.chestTitle" @tap="open" @keydown.enter.prevent="open">
        <svg class="pg-chest__svg" width="84" height="78" viewBox="0 0 84 78" aria-hidden="true" focusable="false">
          <!-- 打开时盖子上掀，露出里面的 ∎ -->
          <g v-if="done">
            <path class="pg-chest__lid" d="M12 26c0-12 8-22 20-22h20c12 0 20 10 20 22z" transform="translate(0 -3)" />
            <rect class="pg-chest__glow" x="15" y="22" width="54" height="16" rx="4" />
            <rect class="pg-chest__qed" x="34" y="17" width="16" height="16" rx="4.5" />
          </g>
          <rect class="pg-chest__body-lip" x="8" y="38" width="68" height="38" rx="12" />
          <rect class="pg-chest__body" x="8" y="32" width="68" height="38" rx="12" />
          <path v-if="!done" class="pg-chest__lid" d="M8 38c0-16 10-30 26-30h16c16 0 26 14 26 30z" />
          <rect class="pg-chest__latch" x="35" :y="done ? 38 : 30" width="14" height="18" rx="5" />
        </svg>
      </view>
      <view class="pg-chest__label">
        <text class="pg-chest__title">{{ PATH_COPY.chestTitle }}</text>
        <text class="pg-chest__sub">{{ done ? PATH_COPY.chestDone : PATH_COPY.chestTodo }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-chest { position: absolute; width: 0; height: 0; }
.pg-chest__inner { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.pg-chest__btn {
  position: absolute;
  left: -42px;
  top: -40px;
  width: 84px;
  height: 78px;
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-spring);
  -webkit-user-select: none;
  user-select: none;
}
.pg-chest__btn:active { transform: translateY(4px) scale(0.98); transition-duration: var(--dur-fast); }
.pg-chest__svg { display: block; overflow: visible; }

.pg-chest__body { fill: var(--rule); }
.pg-chest__body-lip { fill: var(--rule-2); }
.pg-chest__lid { fill: var(--rule-2); }
.pg-chest__latch { fill: var(--ink-3); }
.pg-chest--done .pg-chest__body { fill: var(--bee); }
.pg-chest--done .pg-chest__body-lip { fill: var(--bee-lip); }
.pg-chest--done .pg-chest__lid { fill: var(--bee-lip); }
.pg-chest--done .pg-chest__latch { fill: var(--bee-lip); }
.pg-chest__glow { fill: var(--on-bee); }
.pg-chest__qed { fill: var(--bee); }
.pg-chest--done .pg-chest__qed { animation: pg-chest-rise var(--dur-slow) var(--ease-spring) both; transform-box: fill-box; transform-origin: center; }
@keyframes pg-chest-rise {
  from { transform: translateY(12px) scale(0.6); }
  to { transform: none; }
}

.pg-chest__label {
  position: absolute;
  top: -30px;
  width: 104px;
  width: min(124px, 34cqw);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pg-chest--right .pg-chest__label { left: 54px; }
.pg-chest--left .pg-chest__label { right: 54px; text-align: right; }
.pg-chest__title { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.25; }
.pg-chest__sub { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-bold); line-height: 1.35; }

.pg-pathmap--enter .pg-chest__inner { animation: pg-chest-in var(--dur-slow) var(--ease-spring) both; animation-delay: calc(var(--i) * 50ms); }
@keyframes pg-chest-in {
  from { transform: scale(0.4); opacity: 0; }
  to { transform: none; opacity: 1; }
}
</style>
