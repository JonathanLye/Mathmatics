<script setup lang="ts">
// #8 占位：正式求助抽屉在 #16 实现。
import type { AttemptMode, HelpIntent, HelpState } from '@/types/attempt'
const props = withDefaults(defineProps<{ open?: boolean; help?: HelpState; mode?: AttemptMode; busy?: boolean }>(), { open: false, help: () => ({ hintAvailable: false, exhausted: false, flagged: false }), mode: 'practice', busy: false })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'intent', i: HelpIntent): void; (e: 'send', t: string): void; (e: 'claim'): void; (e: 'decline'): void; (e: 'soft-landing', a: string): void }>()
</script>
<template>
  <view v-if="props.open" class="pg-helpmask" @tap="emit('update:open', false)">
    <view class="pg-help" @tap.stop>
      <text class="pg-help__title">求助 · 一个入口三种意图</text>
      <view class="pg-help__row">
        <button class="pg-help__btn" @tap="emit('intent', 'stuck')">卡住了</button>
        <button class="pg-help__btn" @tap="emit('intent', 'concept')">不懂这个</button>
        <button class="pg-help__btn" @tap="emit('intent', 'check_line')">看这一行</button>
      </view>
      <text class="pg-help__hint pg-small">正式抽屉在 #16 实现（提示预览卡、透露量、软着陆）。</text>
      <button class="pg-help__close" @tap="emit('update:open', false)">关闭</button>
    </view>
  </view>
</template>
<style scoped>
.pg-helpmask { position: fixed; inset: 0; z-index: 60; background: rgba(29,36,48,.35); display: flex; align-items: flex-end; }
.pg-help { width: 100%; background: var(--sheet); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; padding: var(--sp-3) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom)); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-help__title { font-family: var(--font-serif); font-weight: 600; }
.pg-help__row { display: flex; gap: var(--sp-2); }
.pg-help__btn { flex: 1; min-height: 44px; border: 1px solid var(--rule); border-radius: var(--radius-input); background: var(--sheet); color: var(--ink); }
.pg-help__hint { color: var(--ink-2); }
.pg-help__close { min-height: 44px; border: 0; background: var(--paper); border-radius: var(--radius-input); color: var(--ink-2); }
</style>
