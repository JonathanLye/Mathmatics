<script setup lang="ts">
/**
 * 底部弹层：手机从底部滑上来，≥768px 变成居中对话框，动画只有这一套。
 * 模态语义、Esc 关闭、焦点进入和归还都在这里，业务组件不用再写。
 * data-testid、class、aria-* 透传到面板；遮罩的 class / testid 用 mask-class、mask-testid。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { canDismiss } from './uiLogic'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 不允许用遮罩或 Esc 关闭（请求在途、必须选择的卡片）。 */
    persistent?: boolean
    /** 始终居中（PgDialog 用）。 */
    centered?: boolean
    handle?: boolean
    zIndex?: number
    maskClass?: string
    maskTestid?: string
    /** 面板最大宽度（px）。 */
    width?: number
  }>(),
  { persistent: false, centered: false, handle: true, zIndex: 60, maskClass: '', maskTestid: undefined, width: 560 },
)
const emit = defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'close'): void }>()

const panelRef = ref<unknown>(null)
let previouslyFocused: HTMLElement | null = null

function panelElement(): HTMLElement | null {
  if (typeof HTMLElement === 'undefined') return null
  const value = panelRef.value as { $el?: unknown } | null
  const node = value?.$el ?? value
  return node instanceof HTMLElement ? node : null
}

function dismiss(): void {
  if (!canDismiss(props.persistent)) return
  emit('update:open', false)
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  dismiss()
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.addEventListener('keydown', onKeydown)
      void nextTick(() => panelElement()?.focus?.())
    } else {
      document.removeEventListener('keydown', onKeydown)
      try {
        previouslyFocused?.focus?.()
      } catch {
        /* 元素可能已卸载 */
      }
      previouslyFocused = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Transition name="pg-overlay">
    <view
      v-if="open"
      class="pg-overlay"
      :class="[maskClass, { 'pg-overlay--centered': centered }]"
      :style="{ zIndex }"
      :data-testid="maskTestid"
      @tap="dismiss"
    >
      <view
        ref="panelRef"
        class="pg-overlay__panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :style="{ maxWidth: width + 'px' }"
        v-bind="$attrs"
        @tap.stop
      >
        <view v-if="handle && !centered" class="pg-overlay__handle" aria-hidden="true" />
        <slot />
      </view>
    </view>
  </Transition>
</template>

<style scoped>
.pg-overlay {
  --_from: 100%;
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: var(--keyboard-inset);
  background: var(--mask);
}
.pg-overlay__panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  background: var(--sheet);
  border-radius: var(--radius-24) var(--radius-24) 0 0;
  outline: none;
}
.pg-overlay__handle {
  flex: none;
  width: 40px;
  height: 5px;
  margin: 0 auto;
  border-radius: var(--radius-pill);
  background: var(--rule-2);
}

/* 居中形态：手机上的 PgDialog，以及 ≥768px 的所有弹层 */
.pg-overlay--centered {
  --_from: 24px;
  align-items: center;
  padding: var(--sp-4);
}
.pg-overlay--centered .pg-overlay__panel {
  padding: var(--sp-6);
  border-radius: var(--radius-24);
  border: var(--bw) solid var(--rule);
}
@media (min-width: 768px) {
  .pg-overlay {
    --_from: 24px;
    align-items: center;
    padding: var(--sp-6);
  }
  .pg-overlay__panel {
    max-height: 84vh;
    padding: var(--sp-5) var(--sp-6) var(--sp-6);
    border-radius: var(--radius-24);
    border: var(--bw) solid var(--rule);
  }
  .pg-overlay__handle { display: none; }
}

/* 唯一的一套滑入动画 */
.pg-overlay-enter-active,
.pg-overlay-leave-active { transition: background-color var(--dur-base) ease-out; }
.pg-overlay-enter-active .pg-overlay__panel { transition: transform var(--dur-slow) var(--ease-out), opacity var(--dur-base) ease-out; }
.pg-overlay-leave-active .pg-overlay__panel { transition: transform var(--dur-base) ease-in, opacity var(--dur-fast) ease-in; }
.pg-overlay-enter-from,
.pg-overlay-leave-to { background-color: transparent; }
.pg-overlay-enter-from .pg-overlay__panel,
.pg-overlay-leave-to .pg-overlay__panel { transform: translateY(var(--_from)); opacity: 0; }
</style>
