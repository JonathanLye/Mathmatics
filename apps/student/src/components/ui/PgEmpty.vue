<script setup lang="ts">
/** 空状态：小方 + 标题 + 正文 + 一个动作。动作用 action 文案加 @action，或自己放 action 插槽。 */
import PgButton from './PgButton.vue'
import PgMascot from './PgMascot.vue'
import type { MascotExpr } from './icons'
import type { MascotMotion } from './uiLogic'

withDefaults(
  defineProps<{
    title: string
    body?: string
    expr?: MascotExpr
    motion?: MascotMotion | readonly MascotMotion[] | null
    size?: number
    action?: string
    actionTestid?: string
  }>(),
  { body: '', expr: 'idle', motion: () => ['breathe', 'blink'] as MascotMotion[], size: 112, action: '', actionTestid: undefined },
)
defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <view class="pg-empty">
    <PgMascot :expr="expr" :motion="motion" :size="size" />
    <text class="pg-empty__title">{{ title }}</text>
    <text v-if="body" class="pg-empty__body">{{ body }}</text>
    <slot name="action">
      <PgButton v-if="action" class="pg-empty__action" :data-testid="actionTestid" @tap="$emit('action')">{{ action }}</PgButton>
    </slot>
  </view>
</template>

<style scoped>
.pg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-8) var(--sp-4);
  text-align: center;
}
.pg-empty__title { margin-top: var(--sp-3); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-empty__body { max-width: 360px; color: var(--ink-2); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-empty__action { margin-top: var(--sp-3); }
</style>
