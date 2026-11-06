<script setup lang="ts">
/** 确认对话框：标题 + 正文 + 取消/确认。主按钮只有一个。 */
import PgButton from './PgButton.vue'
import PgSheet from './PgSheet.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    body?: string
    confirmText?: string
    cancelText?: string
    /** 不可撤销的操作用红色。 */
    danger?: boolean
    busy?: boolean
    confirmTestid?: string
    cancelTestid?: string
  }>(),
  { body: '', confirmText: '好', cancelText: '取消', danger: false, busy: false, confirmTestid: undefined, cancelTestid: undefined },
)
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'confirm'): void; (e: 'cancel'): void }>()

function cancel(): void {
  if (props.busy) return
  emit('update:open', false)
  emit('cancel')
}
</script>

<template>
  <PgSheet :open="open" centered :persistent="busy" :width="420" :z-index="80" :aria-label="title" v-bind="$attrs" @update:open="cancel">
    <text class="pg-dialog__title">{{ title }}</text>
    <text v-if="body" class="pg-dialog__body">{{ body }}</text>
    <slot />
    <view class="pg-dialog__actions">
      <PgButton v-if="cancelText" variant="secondary" :data-testid="cancelTestid" :disabled="busy" @tap="cancel">{{ cancelText }}</PgButton>
      <PgButton :variant="danger ? 'danger' : 'primary'" :loading="busy" :data-testid="confirmTestid" @tap="emit('confirm')">{{ confirmText }}</PgButton>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-dialog__title { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-dialog__body { color: var(--ink-2); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-dialog__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-2); }
.pg-dialog__actions > * { flex: 1; min-width: 0; }
</style>
