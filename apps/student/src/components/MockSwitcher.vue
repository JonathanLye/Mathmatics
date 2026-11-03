<script setup lang="ts">
/** 开发期 mock 状态切换（issue #9 DoD：做题页能在 mock 下切换四种状态）。 */
import { ref } from 'vue'
import { MOCK_LABELS, type MockKey } from '@/mocks/attemptStates'

const props = defineProps<{ modelValue: MockKey }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: MockKey): void }>()
const open = ref(false)
const keys = Object.keys(MOCK_LABELS) as MockKey[]
// PR #87 审计：只允许开发/测试构建出现调试控件，生产构建（uni build）里 H5 学生看不到。
const isDev = import.meta.env.DEV
</script>

<template>
  <view v-if="isDev" class="pg-mock">
    <button class="pg-mock__pill pg-small" @tap="open = !open">mock: {{ MOCK_LABELS[props.modelValue] }}</button>
    <view v-if="open" class="pg-mock__menu">
      <view v-for="k in keys" :key="k" class="pg-mock__item pg-small" @tap="emit('update:modelValue', k); open = false">
        {{ MOCK_LABELS[k] }}
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-mock { position: fixed; right: var(--sp-3); bottom: calc(76px + var(--safe-bottom)); z-index: 50; }
.pg-mock__pill {
  min-height: 32px;
  padding: 0 var(--sp-2);
  border-radius: 999px;
  border: 1px dashed var(--ink-2);
  background: var(--sheet);
  color: var(--ink-2);
}
.pg-mock__menu {
  position: absolute;
  right: 0;
  bottom: 40px;
  width: 200px;
  background: var(--sheet);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sheet);
  overflow: hidden;
}
.pg-mock__item { padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--rule); }
.pg-mock__item:last-child { border-bottom: 0; }
</style>
