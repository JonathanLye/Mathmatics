<script setup lang="ts">
/**
 * 离线提示条（02 §9 状态表 / #27）：
 * - 断网：顶部细条「网络断开，你写的内容已保存在本机，恢复后自动同步」；
 * - 恢复：短暂提示「网络已恢复，正在同步…」；
 * - 重试中：重试按钮变「正在重试…」（由父组件传入 retrying / @retry 触发 flush）。
 * 采用正常文档流 + sticky（不覆盖 44px 操作区）。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useNetwork } from '@/composables/useNetwork'
import PgButton from '@/components/ui/PgButton.vue'

const props = withDefaults(defineProps<{ retrying?: boolean }>(), { retrying: false })
const emit = defineEmits<{ (e: 'retry'): void }>()

const { online } = useNetwork()
const justRecovered = ref(false)
let recoveredTimer: ReturnType<typeof setTimeout> | null = null

watch(online, (isOnline) => {
  if (!isOnline) {
    justRecovered.value = false
    return
  }
  if (recoveredTimer) clearTimeout(recoveredTimer)
  justRecovered.value = true
  recoveredTimer = setTimeout(() => {
    justRecovered.value = false
  }, 3000)
})

onBeforeUnmount(() => {
  if (recoveredTimer) clearTimeout(recoveredTimer)
})
</script>

<template>
  <view
    v-if="!online || justRecovered"
    class="pg-offline"
    :class="online ? 'pg-offline--recovered' : 'pg-offline--off'"
    role="status"
    aria-live="polite"
    data-testid="offline-bar"
  >
    <text class="pg-offline__text">
      {{ online ? '网络已恢复，正在同步…' : '网络断开，你写的内容已保存在本机，恢复后自动同步' }}
    </text>
    <PgButton v-if="!online" class="pg-offline__retry" variant="ghost" size="sm" data-testid="offline-retry" :disabled="props.retrying" @tap="emit('retry')">
      {{ props.retrying ? '正在重试…' : '重试' }}
    </PgButton>
  </view>
</template>

<style scoped>
.pg-offline {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--touch);
  padding: var(--sp-1) var(--sp-4);
  color: var(--ink);
  font-size: var(--fs-13);
  line-height: 1.4;
}
.pg-offline--off { background: var(--bee-soft); border-bottom: var(--bw) solid var(--bee); }
.pg-offline--recovered { background: var(--accent-soft); border-bottom: var(--bw) solid var(--accent); }
.pg-offline__text { flex: 1; min-width: 0; }
.pg-offline__retry.pg-button { flex: none; color: var(--bee-text); }
</style>
