<script setup lang="ts">
/** 层间过场：刚做了什么 → 下一层叫什么、要做什么。一屏一件事，一个按钮。 */
import { computed } from 'vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import type { LayerStatus } from '@/types/attempt'
import type { InterstitialView } from './feedback'
import { layersProgress } from './practiceProgress'

const props = defineProps<{ view: InterstitialView | null; layers: LayerStatus[] }>()
defineEmits<{ (e: 'continue'): void }>()
const progress = computed(() => layersProgress(props.layers).value)
</script>

<template>
  <Transition name="pg-between">
    <view v-if="view" class="pg-between" role="dialog" aria-modal="true" :aria-label="'下一层：' + view.nextName" data-testid="layer-interstitial">
      <view class="pg-between__body">
        <PgProgress class="pg-between__progress" :value="progress" label="这道题的进度" />
        <PgMascot expr="happy" motion="hop" :size="120" />
        <text class="pg-between__did" data-testid="interstitial-did">{{ view.did }}</text>
        <text v-if="view.xp > 0" class="pg-between__xp" data-testid="interstitial-xp">+{{ view.xp }} 经验</text>
        <view class="pg-between__next">
          <text class="pg-between__label">下一层</text>
          <text class="pg-between__name" data-testid="interstitial-next">{{ view.nextName }}</text>
          <text class="pg-between__intro">{{ view.nextIntro }}</text>
        </view>
      </view>
      <view class="pg-between__action">
        <PgButton block size="lg" data-testid="interstitial-continue" @tap="$emit('continue')">继续</PgButton>
      </view>
    </view>
  </Transition>
</template>

<style scoped>
.pg-between {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + var(--sp-4)) max(var(--sp-4), var(--safe-right)) calc(var(--safe-bottom) + var(--sp-4)) max(var(--sp-4), var(--safe-left));
  background: var(--paper);
  overflow-y: auto;
}
.pg-between__body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); width: 100%; max-width: var(--form-max); margin: 0 auto; text-align: center; }
.pg-between__progress { position: absolute; top: calc(var(--safe-top) + var(--sp-4)); left: 50%; width: min(calc(100% - var(--sp-8)), 480px); transform: translateX(-50%); }
.pg-between__did { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-between__xp { color: var(--bee-text); font-size: var(--fs-18); font-weight: var(--fw-black); animation: pg-pop 380ms var(--ease-spring) both; }
.pg-between__next { display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: var(--sp-2); padding: var(--sp-4); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--sheet); box-shadow: 0 var(--lip) 0 var(--rule); }
.pg-between__label { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-between__name { color: var(--accent-text); font-size: var(--fs-22); font-weight: var(--fw-black); }
.pg-between__intro { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-between__action { flex: none; width: 100%; max-width: var(--form-max); margin: var(--sp-4) auto 0; }
.pg-between-enter-active { transition: opacity var(--dur-base) ease-out; }
.pg-between-enter-active .pg-between__body { transition: transform var(--dur-slow) var(--ease-spring); }
.pg-between-leave-active { transition: opacity var(--dur-base) ease-in; }
.pg-between-enter-from,
.pg-between-leave-to { opacity: 0; }
.pg-between-enter-from .pg-between__body { transform: translateY(24px) scale(0.96); }
</style>
