<script setup lang="ts">
/**
 * 全局轻提示。内容来自 useToast；由 main.ts 挂成独立小应用，页面不用放。
 * 独立应用里没有 uni 的内置组件，所以这里用原生 div，不用 view。
 */
import { useToast } from './useToast'

const { state, hide } = useToast()
function runAction(): void {
  const action = state.action
  hide()
  action?.run()
}
</script>

<template>
  <Transition name="pg-toast">
    <div v-if="state.message" class="pg-toast" :class="'pg-toast--' + state.tone" role="status" aria-live="polite" data-testid="toast">
      {{ state.message }}
      <button v-if="state.action" class="pg-toast__action" type="button" data-testid="toast-action" @click="runAction">{{ state.action.label }}</button>
    </div>
  </Transition>
</template>

<style scoped>
.pg-toast {
  position: fixed;
  left: 50%;
  bottom: calc(112px + var(--safe-bottom));
  z-index: 95;
  width: max-content;
  max-width: min(420px, calc(100vw - var(--sp-8)));
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-16);
  background: var(--toast-bg);
  color: var(--toast-ink);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
  line-height: 1.45;
  text-align: center;
  transform: translateX(-50%);
}
.pg-toast__action {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  margin-left: var(--sp-2);
  padding: 0 var(--sp-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-weight: var(--fw-black);
  cursor: pointer;
}
.pg-toast--ok { background: var(--ok-lip); color: var(--on-danger); }
.pg-toast--warn { background: var(--fox-text); color: var(--on-danger); }
.pg-toast-enter-active { transition: transform var(--dur-slow) var(--ease-spring), opacity var(--dur-base) ease-out; }
.pg-toast-leave-active { transition: transform var(--dur-base) ease-in, opacity var(--dur-base) ease-in; }
.pg-toast-enter-from,
.pg-toast-leave-to { opacity: 0; transform: translate(-50%, 16px); }
</style>
