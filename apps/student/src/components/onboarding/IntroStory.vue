<script setup lang="ts">
/**
 * 开场动画：4 幕，小方讲清“这是什么、六步怎么走、写不出来就问、每天一点点”。
 * - 全屏覆盖，随时能“跳过”；按钮、左右滑动、方向键都能翻页，Esc 等于跳过；
 * - 动画全是 CSS（只动 transform / opacity / 颜色），不自动翻页，每一幕停在有意义的最后一帧：
 *   系统“减少动态效果”和我的页动效开关会把它们收成静态，内容依然完整；
 * - 播完或跳过都只发一次 done，由调用方决定记在哪里（登录前记本机，登录后记 onboarding.seen.intro）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PathIllustration from './PathIllustration.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { INTRO_SCENES, INTRO_UI } from '@/copy/onboarding'
import { introStepFrom, shouldSwipe } from './introLogic'

const emit = defineEmits<{ (e: 'done', payload: { skipped: boolean }): void }>()

const total = INTRO_SCENES.length
const index = ref(0)
const direction = ref<'fwd' | 'back'>('fwd')
const finished = ref(false)
const scene = computed(() => INTRO_SCENES[index.value]!)
const isLast = computed(() => index.value === total - 1)
const root = ref<unknown>(null)

function finish(skipped: boolean): void {
  if (finished.value) return
  finished.value = true
  emit('done', { skipped })
}

function go(delta: 1 | -1): void {
  const step = introStepFrom(index.value, delta, total)
  if (step.finish) {
    finish(false)
    return
  }
  direction.value = delta === 1 ? 'fwd' : 'back'
  index.value = step.index
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight') go(1)
  else if (event.key === 'ArrowLeft') go(-1)
  else if (event.key === 'Escape') finish(true)
}

let startX = 0
let startY = 0
function onTouchStart(event: TouchEvent): void {
  const touch = event.touches[0]
  startX = touch?.clientX ?? 0
  startY = touch?.clientY ?? 0
}
function onTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (!touch) return
  const swipe = shouldSwipe(touch.clientX - startX, touch.clientY - startY)
  if (swipe === 'next') go(1)
  else if (swipe === 'prev') go(-1)
}

onMounted(() => {
  if (typeof window === 'undefined') return
  window.addEventListener('keydown', onKey)
  const node = (root.value as { $el?: unknown } | null)?.$el ?? root.value
  if (node instanceof HTMLElement) node.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey)
})

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <view
    ref="root"
    class="pgs"
    role="dialog"
    aria-modal="true"
    :aria-label="INTRO_UI.label"
    tabindex="-1"
    data-testid="intro-story"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <view class="pgs__top">
      <view class="pgs__dots" role="img" :aria-label="INTRO_UI.progress(index + 1, total)">
        <view v-for="(s, i) in INTRO_SCENES" :key="s.id" class="pgs__dot" :class="{ 'pgs__dot--on': i === index, 'pgs__dot--past': i < index }" />
      </view>
      <PgButton variant="ghost" size="sm" data-testid="intro-skip" @tap="finish(true)">{{ INTRO_UI.skip }}</PgButton>
    </view>

    <view :key="index" class="pgs__scene" :class="'pgs__scene--' + direction" :data-scene="scene.id" data-testid="intro-scene">
      <view class="pgs__art">
        <!-- 1 这是什么：三行证明一行一行写出来，最后盖上 ∎ -->
        <view v-if="scene.id === 'what'" class="pgs-a1">
          <view class="pgs-a1__paper">
            <text class="pgs-a1__line pgs-a1__line--1">设 ε &gt; 0，取 N = ⌈1/ε⌉</text>
            <text class="pgs-a1__line pgs-a1__line--2">当 n &gt; N 时，1/n &lt; 1/N ≤ ε</text>
            <text class="pgs-a1__line pgs-a1__line--3">所以 1/n 趋于 0</text>
            <text class="pgs-a1__qed">∎</text>
          </view>
          <view class="pgs-a1__mascot"><PgMascot expr="happy" :motion="['cheer', 'blink']" :size="104" /></view>
        </view>

        <!-- 2 六步路径 -->
        <PathIllustration v-else-if="scene.id === 'path'" mode="once" />

        <!-- 3 写不出来就问：小方只提问，不代写 -->
        <view v-else-if="scene.id === 'ask'" class="pgs-a3">
          <view class="pgs-a3__paper">
            <text class="pgs-a3__line">设 ε &gt; 0，取 N = ⌈1/ε⌉</text>
            <view class="pgs-a3__empty"><text class="pgs-a3__ph">写不出来……</text><view class="pgs-a3__caret" /></view>
          </view>
          <view class="pgs-a3__bubble"><text>这一步的依据是什么？</text></view>
          <view class="pgs-a3__mascot"><PgMascot expr="think" :motion="['think-tilt', 'blink']" :size="96" /></view>
          <view class="pgs-a3__quota">
            <text class="pgs-a3__quotalabel">提示额度</text>
            <view class="pgs-a3__pips"><view class="pgs-a3__pip" /><view class="pgs-a3__pip" /><view class="pgs-a3__pip pgs-a3__pip--used" /></view>
          </view>
        </view>

        <!-- 4 每天一点点：一周打卡 + 连续天数 + 证明本 -->
        <view v-else class="pgs-a4">
          <view class="pgs-a4__flame"><view class="pgs-a4__flameicon"><PgIcon name="flame" :size="44" /></view><text class="pgs-a4__days">3 天</text></view>
          <view class="pgs-a4__week">
            <view v-for="(d, i) in WEEK" :key="d" class="pgs-a4__day" :class="{ 'pgs-a4__day--done': i < 3 }" :style="{ animationDelay: 300 + i * 160 + 'ms' }">
              <view class="pgs-a4__bubble"><PgIcon v-if="i < 3" name="check" :size="16" /></view>
              <text class="pgs-a4__dname">{{ d }}</text>
            </view>
          </view>
          <view class="pgs-a4__book"><PgIcon name="book" :size="28" /><text class="pgs-a4__booktext">证明本</text><text class="pgs-a4__stamp">∎</text></view>
          <view class="pgs-a4__mascot"><PgMascot expr="happy" :motion="['breathe', 'blink']" :size="72" /></view>
        </view>
      </view>

      <text class="pgs__title" data-testid="intro-title">{{ scene.title }}</text>
      <text class="pgs__body">{{ scene.body }}</text>
    </view>

    <view class="pgs__actions">
      <PgButton v-if="index > 0" variant="secondary" size="lg" class="pgs__back" data-testid="intro-back" aria-label="上一步" @tap="go(-1)">
        <PgIcon name="back" :size="22" />
      </PgButton>
      <PgButton v-if="!isLast" size="lg" class="pgs__next" data-testid="intro-next" @tap="go(1)">{{ INTRO_UI.next }}</PgButton>
      <PgButton v-else size="lg" class="pgs__next" data-testid="intro-done" @tap="go(1)">{{ INTRO_UI.done }}</PgButton>
    </view>
  </view>
</template>

<style scoped>
.pgs {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: calc(var(--safe-top) + var(--sp-3)) max(var(--sp-4), var(--safe-right)) calc(var(--safe-bottom) + var(--sp-4)) max(var(--sp-4), var(--safe-left));
  background: var(--paper);
  outline: none;
  overflow-y: auto;
  animation: pg-page-in var(--dur-slow) var(--ease-out) both;
}
.pgs__top { display: flex; align-items: center; justify-content: space-between; width: 100%; max-width: 420px; min-height: var(--touch); }
.pgs__dots { display: flex; gap: var(--sp-2); }
.pgs__dot { width: 10px; height: 10px; border-radius: var(--radius-pill); background: var(--rule-2); transition: width var(--dur-base) var(--ease-spring), background var(--dur-base) ease-out; }
.pgs__dot--past { background: var(--accent); }
.pgs__dot--on { width: 28px; background: var(--accent); }

.pgs__scene {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  width: 100%;
  max-width: 420px;
  padding: var(--sp-4) 0;
  text-align: center;
  animation: pgs-in-fwd var(--dur-slow) var(--ease-out) both;
}
.pgs__scene--back { animation-name: pgs-in-back; }
@keyframes pgs-in-fwd { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes pgs-in-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }

.pgs__art { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 260px; margin-bottom: var(--sp-2); }
.pgs__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pgs__body { max-width: 340px; color: var(--ink-2); font-size: var(--fs-15); line-height: var(--lh-body); }
.pgs__actions { display: flex; gap: var(--sp-3); width: 100%; max-width: 420px; padding-top: var(--sp-3); }
.pgs__next { flex: 1; }
.pgs__back { flex: none; width: 56px; padding: 0; }

/* ---- 第 1 幕 ---- */
.pgs-a1 { position: relative; width: 100%; max-width: 340px; height: 260px; }
.pgs-a1__paper {
  position: absolute;
  left: 0;
  top: 8px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-4) var(--sp-8);
  border: var(--bw) solid var(--rule);
  border-bottom-width: calc(var(--bw) + var(--lip) - 2px);
  border-radius: var(--radius-16);
  background: var(--sheet);
  text-align: left;
  transform: rotate(-2deg);
}
.pgs-a1__line {
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: var(--fs-15);
  line-height: 1.5;
  clip-path: inset(0 100% 0 0);
  animation: pgs-reveal 700ms var(--ease-out) both;
}
.pgs-a1__line--1 { animation-delay: 300ms; }
.pgs-a1__line--2 { animation-delay: 1100ms; }
.pgs-a1__line--3 { animation-delay: 1900ms; }
@keyframes pgs-reveal { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.pgs-a1__qed {
  position: absolute;
  right: var(--sp-4);
  bottom: var(--sp-3);
  color: var(--accent-text);
  font-size: var(--fs-28);
  font-weight: var(--fw-black);
  animation: pgs-stamp 520ms var(--ease-spring) 2700ms both;
}
@keyframes pgs-stamp { 0% { opacity: 0; transform: scale(2.2) rotate(-12deg); } 100% { opacity: 1; transform: scale(1) rotate(-6deg); } }
.pgs-a1__mascot { position: absolute; right: 0; bottom: 0; }

/* ---- 第 3 幕 ---- */
.pgs-a3 { position: relative; width: 100%; max-width: 340px; height: 260px; }
.pgs-a3__paper {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--rule);
  border-bottom-width: calc(var(--bw) + var(--lip) - 2px);
  border-radius: var(--radius-16);
  background: var(--sheet);
  text-align: left;
}
.pgs-a3__line { color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-15); }
.pgs-a3__empty { display: flex; align-items: center; gap: 2px; min-height: 40px; padding: 0 var(--sp-3); border: var(--bw) dashed var(--rule-2); border-radius: var(--radius-12); }
.pgs-a3__ph { color: var(--ink-3); font-size: var(--fs-13); }
.pgs-a3__caret { width: 2px; height: 18px; background: var(--accent); animation: pgs-caret 1s steps(1) infinite; }
@keyframes pgs-caret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.pgs-a3__mascot { position: absolute; left: 0; bottom: 0; }
.pgs-a3__bubble {
  position: absolute;
  left: 78px;
  bottom: 70px;
  padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--sea);
  border-radius: var(--radius-16) var(--radius-16) var(--radius-16) 4px;
  background: var(--sea-soft);
  color: var(--sea-text);
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  transform-origin: 0 100%;
  animation: pg-pop 460ms var(--ease-spring) 1200ms both;
}
.pgs-a3__quota {
  position: absolute;
  right: 0;
  bottom: 4px;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--bee);
  border-radius: var(--radius-pill);
  background: var(--bee-soft);
  animation: pg-pop 420ms var(--ease-spring) 2200ms both;
}
.pgs-a3__quotalabel { color: var(--bee-text); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pgs-a3__pips { display: flex; gap: 4px; }
.pgs-a3__pip { width: 12px; height: 12px; border-radius: 50%; background: var(--bee); }
.pgs-a3__pip--used { background: var(--bee-soft); box-shadow: inset 0 0 0 2px var(--bee); animation: pgs-pip 400ms ease-out 3000ms both; }
@keyframes pgs-pip { from { transform: scale(1.5); background: var(--bee); } to { transform: scale(1); background: var(--bee-soft); } }

/* ---- 第 4 幕 ---- */
.pgs-a4 { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--sp-4); width: 100%; max-width: 340px; padding-top: var(--sp-2); }
.pgs-a4__flame { display: flex; align-items: center; gap: var(--sp-2); animation: pg-pop 520ms var(--ease-spring) 100ms both; }
.pgs-a4__flameicon { display: flex; color: var(--fox); }
.pgs-a4__days { color: var(--fox-text); font-size: var(--fs-28); font-weight: var(--fw-black); }
.pgs-a4__week { display: flex; justify-content: space-between; width: 100%; }
.pgs-a4__day { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); }
.pgs-a4__bubble { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: var(--bw) solid var(--rule-2); border-radius: 50%; background: var(--paper-2); color: var(--on-ok); }
.pgs-a4__day--done .pgs-a4__bubble { border-color: var(--ok-lip); background: var(--ok); animation: pg-pop 380ms var(--ease-spring) both; animation-delay: inherit; }
.pgs-a4__dname { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pgs-a4__book {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  border: var(--bw) solid var(--rule);
  border-bottom-width: calc(var(--bw) + var(--lip) - 2px);
  border-radius: var(--radius-16);
  background: var(--sheet);
  color: var(--accent-text);
  animation: pgs-in-fwd var(--dur-slow) var(--ease-out) 1100ms both;
}
.pgs-a4__booktext { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); }
.pgs-a4__stamp { color: var(--accent-text); font-size: var(--fs-22); font-weight: var(--fw-black); animation: pgs-stamp 480ms var(--ease-spring) 1700ms both; }
.pgs-a4__mascot { position: absolute; right: -4px; bottom: -8px; }
</style>
