<script setup lang="ts">
/**
 * 底部反馈条：提交后从底部滑上来。ok=答对，sea=助教的问题（不是判错），bee=提示。
 * 没有红色形态：做题时不用红色下判决。主操作只有一个。
 */
import { computed } from 'vue'
import PgButton from './PgButton.vue'
import PgMascot from './PgMascot.vue'
import type { MascotExpr } from './icons'
import type { ButtonVariant } from './uiLogic'

const props = withDefaults(
  defineProps<{
    open: boolean
    tone?: 'ok' | 'sea' | 'bee'
    title: string
    expr?: MascotExpr | null
    actionText?: string
    actionTestid?: string
    busy?: boolean
  }>(),
  { tone: 'ok', expr: null, actionText: '', actionTestid: undefined, busy: false },
)
defineEmits<{ (e: 'action'): void }>()

const DEFAULT_EXPR: Record<'ok' | 'sea' | 'bee', MascotExpr> = { ok: 'happy', sea: 'think', bee: 'think' }
const VARIANT: Record<'ok' | 'sea' | 'bee', ButtonVariant> = { ok: 'primary', sea: 'sea', bee: 'hint' }
const mascotExpr = computed(() => props.expr ?? DEFAULT_EXPR[props.tone])
const buttonVariant = computed(() => VARIANT[props.tone])
</script>

<template>
  <Transition name="pg-feedback">
    <view v-if="open" class="pg-feedback" :class="'pg-feedback--' + tone" role="status" aria-live="polite" data-testid="feedback-panel">
      <view class="pg-feedback__inner">
        <view class="pg-feedback__head">
          <PgMascot :expr="mascotExpr" :motion="tone === 'ok' ? 'hop' : null" :size="56" />
          <view class="pg-feedback__text">
            <text class="pg-feedback__title">{{ title }}</text>
            <view class="pg-feedback__body"><slot /></view>
          </view>
        </view>
        <PgButton v-if="actionText" block size="lg" :variant="buttonVariant" :loading="busy" :data-testid="actionTestid" @tap="$emit('action')">{{ actionText }}</PgButton>
      </view>
    </view>
  </Transition>
</template>

<style scoped>
.pg-feedback {
  --_bg: var(--ok-soft);
  --_edge: var(--ok);
  --_ink: var(--ok-text);
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: var(--sp-4) max(var(--sp-4), var(--safe-left)) calc(var(--sp-4) + var(--safe-bottom)) max(var(--sp-4), var(--safe-right));
  background: var(--_bg);
  border-top: var(--bw) solid var(--_edge);
}
.pg-feedback--sea { --_bg: var(--sea-soft); --_edge: var(--sea); --_ink: var(--sea-text); }
.pg-feedback--bee { --_bg: var(--bee-soft); --_edge: var(--bee); --_ink: var(--bee-text); }
.pg-feedback__inner { display: flex; flex-direction: column; gap: var(--sp-3); width: 100%; max-width: var(--shell-main); margin: 0 auto; }
.pg-feedback__head { display: flex; align-items: flex-start; gap: var(--sp-3); }
.pg-feedback__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-feedback__title { color: var(--_ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-feedback__body { color: var(--ink); font-size: var(--fs-15); line-height: 1.5; }
.pg-feedback-enter-active { transition: transform var(--dur-slow) var(--ease-out); }
.pg-feedback-leave-active { transition: transform var(--dur-base) ease-in; }
.pg-feedback-enter-from,
.pg-feedback-leave-to { transform: translateY(100%); }
</style>
